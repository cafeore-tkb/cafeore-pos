import {
  type LabelPrintClaim,
  type LabelPrintProxy,
  type LabelPrintRequest,
  type LabelPrintRequestResult,
  claimLabelPrint,
  deleteLabelPrintProxy,
  getLabelPrintProxies,
  getLabelPrintRequests,
  markLabelPrinted,
  putLabelPrintProxy,
  releaseLabelPrint,
} from "@cafeore/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type LabelPrintEvent,
  useLabelPrintEvents,
  useOrdersWSContext,
} from "~/routes/context/OrdersWSContext";
import { type PrintJob, toPrintJob } from "./document";
import type { PrinterConnectionStatus } from "./infra/printer";

/**
 * 代理印刷
 *
 * 端末（CaOS・マスターの緊急）がラベル用のプリンターに直接刷れなかったシールを、サーバー（POST /api/label-print-requests）に頼み、
 * 代理印刷をオンにしたレジが刷る。頼むのは print-util の usePrinter（relay）、刷るのはレジの useLabelPrintProxy。
 * レジは刷る前に引き受け（claim）、引き受けたレジだけが刷る（代理印刷のレジが何台あっても 1 枚だけ刷る）。
 * 頼めなければ、頼む端末は未印刷に残して間をあけて頼み直す（relayRetryDelay）。淹れ直しが消えていたら（410）、そのシールは捨てる。
 * 代理印刷をしている（オンで、ラベル用のプリンターがつながっている）レジは、そうとサーバーに知らせ続け（PROXY_HEARTBEAT_MS）、
 * 開いたレジは、ほかに代理印刷をしているレジが無ければ代理印刷をオンにする（useLabelPrintProxyAutoEnable）。
 */

/** 刷れなかった・ほかのレジが刷っている頼みを、もう一度引き受けにいくまでの間（ミリ秒） */
export const PROXY_RETRY_MS = 10_000;

/**
 * 代理印刷をしているレジが、そうとサーバーに知らせる間隔（ミリ秒）。
 * サーバーは 60 秒知らせが無ければ数えない（api の labelPrintProxyTTL）ので、2 回取りこぼしても数えられる
 */
export const PROXY_HEARTBEAT_MS = 20_000;

/** 頼みの一覧を読み直す間隔（ミリ秒）。配信を受け損ねたとき（ほかのインスタンスの知らせが届かないなど）のため */
const QUEUE_REFRESH_MS = 30_000;

/** 頼めなかった（つながらない・断られた）シールを、もう一度頼むまでの間（ミリ秒）。頼めないたびに倍にし、最長で RELAY_RETRY_MAX_MS */
export const RELAY_RETRY_MIN_MS = 10_000;
export const RELAY_RETRY_MAX_MS = 5 * 60_000;

/** failures 回続けて頼めなかったあと、次に頼むまでの間（ミリ秒） */
export const relayRetryDelay = (failures: number) =>
  Math.min(
    RELAY_RETRY_MIN_MS * 2 ** Math.max(0, failures - 1),
    RELAY_RETRY_MAX_MS,
  );

/**
 * 頼む端末（print-util の usePrinter）が、頼めなかったシール（id）ごとに覚えておく、続けて頼めなかった回数と、次に頼んでよい時刻。
 * このタブのメモリだけに持つ（開き直したら、すぐ頼み直してよい）
 */
export type RelayBackoff = Map<string, { failures: number; retryAt: number }>;

/** 今そのシールを頼んでよいか（頼めなかった後、間をあけている間は false） */
export const canRelayNow = (backoff: RelayBackoff, id: string, now: number) =>
  (backoff.get(id)?.retryAt ?? 0) <= now;

/** 頼んだ結果を覚える。頼めなければ次に頼む時刻を延ばし、受け取ってもらえた・もう頼めない（gone）なら忘れる */
export const recordRelayResult = (
  backoff: RelayBackoff,
  id: string,
  result: LabelPrintRequestResult,
  now: number,
) => {
  if (result !== "retry") {
    backoff.delete(id);
    return;
  }
  const failures = (backoff.get(id)?.failures ?? 0) + 1;
  backoff.set(id, { failures, retryAt: now + relayRetryDelay(failures) });
};

export type ProxyDeps = {
  /** 刷るレジ（ページを開くたびに作る id） */
  deviceId: string;
  claim: (id: string, deviceId: string) => Promise<LabelPrintClaim>;
  /** プリンターで刷る。刷れたら true */
  print: (job: PrintJob) => Promise<boolean>;
  markPrinted: (id: string, deviceId: string) => Promise<boolean>;
  release: (id: string, deviceId: string) => Promise<boolean>;
  /** プリンターにつながっているか。つながっていなければ引き受けない（刷れないのに引き受けて、ほかのレジを待たせない） */
  canPrint: () => boolean;
  now: () => number;
};

/** 代理印刷のレジが覚えておくもの（回すたびに引き継ぐ） */
export type ProxyState = {
  /** この時刻までは引き受けにいかない（刷れなかった・ほかのレジが刷っている・つながらなかった） */
  retryAt: Map<string, number>;
  /** 刷れたが、まだサーバーに知らせられていないもの（もう一度は刷らず、知らせるだけにする） */
  printed: Set<string>;
};

export const createProxyState = (): ProxyState => ({
  retryAt: new Map(),
  printed: new Set(),
});

/**
 * 代理印刷を 1 回回す。requests を古い順に引き受けて刷り、片付いた（刷れた・ほかのレジが刷った・頼みが無い）id と、
 * このレジが刷った id を返す。刷れなかったら、プリンターの具合が悪いので後ろは引き受けない（次に回したときに試す）
 */
export const runLabelPrintProxy = async (
  requests: readonly Pick<LabelPrintRequest, "id">[],
  deps: ProxyDeps,
  state: ProxyState,
) => {
  const settled: string[] = [];
  const printed: string[] = [];
  // 一覧から消えたもの（ほかの端末で片付いた）は覚えておかない
  const ids = new Set(requests.map((request) => request.id));
  for (const id of state.retryAt.keys())
    if (!ids.has(id)) state.retryAt.delete(id);
  for (const id of state.printed) if (!ids.has(id)) state.printed.delete(id);

  const settle = (id: string) => {
    state.retryAt.delete(id);
    state.printed.delete(id);
    settled.push(id);
  };
  const later = (id: string) =>
    state.retryAt.set(id, deps.now() + PROXY_RETRY_MS);
  // 刷れたことを知らせる。知らせられなければ、刷ったことを覚えて後で知らせ直す
  const report = async (id: string) => {
    if (await deps.markPrinted(id, deps.deviceId)) settle(id);
    else {
      state.printed.add(id);
      later(id);
    }
  };

  for (const { id } of requests) {
    if (!deps.canPrint()) break;
    if ((state.retryAt.get(id) ?? 0) > deps.now()) continue;
    if (state.printed.has(id)) {
      await report(id);
      continue;
    }
    const claim = await deps.claim(id, deps.deviceId);
    if (claim.status === "printed" || claim.status === "missing") {
      settle(id);
      continue;
    }
    if (claim.status !== "claimed") {
      later(id);
      continue;
    }
    const job = toPrintJob(claim.job);
    if (job && (await deps.print(job))) {
      printed.push(id);
      await report(id);
      continue;
    }
    // ほかの代理印刷のレジが引き受けられるよう、すぐやめる（やめられなくても、引き受けは切れる）
    await deps.release(id, deps.deviceId);
    later(id);
    break;
  }
  return { settled, printed };
};

const EMPTY: readonly LabelPrintRequest[] = [];

// 頼まれた順（created_at は小数の桁がそろっていないので、時刻にして比べる）
const byCreatedAt = (a: LabelPrintRequest, b: LabelPrintRequest) =>
  Date.parse(a.created_at) - Date.parse(b.created_at);

/** 届いた頼みを一覧に足す（同じ id はそのまま。頼まれた順） */
export const addLabelPrintRequest = (
  requests: readonly LabelPrintRequest[],
  request: LabelPrintRequest,
) =>
  requests.some((r) => r.id === request.id)
    ? requests
    : [...requests, request].sort(byCreatedAt);

/**
 * 読み直した一覧（list）に置き換える。読み直している間に配信で届いたもの（arrived）は、list より新しいかもしれないので残す。
 * 刷れた・取り消したと知ったもの（gone）は、list に入っていても外す
 */
export const replaceLabelPrintRequests = (
  list: readonly LabelPrintRequest[],
  prev: readonly LabelPrintRequest[],
  arrived: ReadonlySet<string>,
  gone: ReadonlySet<string>,
) =>
  prev
    .filter((r) => arrived.has(r.id))
    .reduce(addLabelPrintRequest, [...list].sort(byCreatedAt))
    .filter((r) => !gone.has(r.id));

/** 1 分以上印刷待ちなら、キューに届いていても代理印刷が利用可能とは扱わない。 */
export const RELAY_STALL_MS = 60_000;

export const isLabelPrintQueueStalled = (
  requests: readonly Pick<LabelPrintRequest, "created_at">[],
  now: number,
) =>
  requests.some((request) => {
    const createdAt = Date.parse(request.created_at);
    return !Number.isFinite(createdAt) || now - createdAt >= RELAY_STALL_MS;
  });

/**
 * まだ刷れていない代理印刷の頼み（今日の分。古い順）
 *
 * 共有の WebSocket がつながったとき・一定の間隔で GET /api/label-print-requests を読み直し、
 * あいだは配信（頼まれた・刷れた・緊急が取り消された）で足し消しする。enabled でなければ読まず、空を返す
 */
export const useLabelPrintQueue = (enabled = true) => {
  const { status } = useOrdersWSContext();
  const [requests, setRequests] = useState(EMPTY);
  const [queueAvailable, setQueueAvailable] = useState(false);
  const [now, setNow] = useState(Date.now);
  // API の応答がなくても、待ち時間が閾値を超えたら判定し直す。
  useEffect(() => {
    if (!enabled || requests.length === 0) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [enabled, requests.length]);
  // 刷れた・取り消したと知ったもの。読み直した一覧が知らせより古くても足さない
  const gone = useRef(new Set<string>());
  // 読み直している間に配信で届いた頼み。読み直した一覧に無くても消さない
  const arrived = useRef(new Set<string>());

  const refresh = useCallback(async (isActive: () => boolean) => {
    arrived.current.clear();
    const list = await getLabelPrintRequests();
    if (!isActive()) return;
    setQueueAvailable(list !== null);
    if (list)
      setRequests((prev) =>
        replaceLabelPrintRequests(list, prev, arrived.current, gone.current),
      );
  }, []);

  useEffect(() => {
    setQueueAvailable(false);
    if (!enabled || status !== "open") return;
    let active = true;
    const reload = () => refresh(() => active);
    void reload();
    const timer = setInterval(reload, QUEUE_REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [enabled, status, refresh]);

  const remove = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return;
    for (const id of ids) gone.current.add(id);
    setRequests((prev) => prev.filter((r) => !ids.includes(r.id)));
  }, []);

  useLabelPrintEvents(
    useCallback(
      (event: LabelPrintEvent) => {
        if (event.type !== "requested") {
          remove([event.id]);
          return;
        }
        const { request } = event;
        if (gone.current.has(request.id)) return;
        arrived.current.add(request.id);
        setRequests((prev) => addLabelPrintRequest(prev, request));
      },
      [remove],
    ),
  );

  return {
    requests: enabled ? requests : EMPTY,
    remove,
    // 接続だけでなく、印刷待ちが滞留していないことも確認する。
    relayAvailable:
      enabled &&
      status === "open" &&
      queueAvailable &&
      !isLabelPrintQueueStalled(requests, now),
  };
};

/**
 * active（代理印刷がオンで、ラベル用のプリンターがつながっている）のあいだ、このレジが代理印刷をしているとサーバーに知らせ続ける。
 * active でなくなった・ページを閉じたら、やめたと知らせる（知らせられなくても、サーバーは 60 秒で数えなくなる）
 */
const useLabelPrintProxyPresence = (active: boolean, deviceId: string) => {
  useEffect(() => {
    if (!active) return;
    let last = putLabelPrintProxy(deviceId);
    const timer = setInterval(() => {
      last = putLabelPrintProxy(deviceId);
    }, PROXY_HEARTBEAT_MS);
    const leave = () => void deleteLabelPrintProxy(deviceId, true);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      // 知らせ終えてから、やめたと知らせる（入れ違って、やめたのに代理印刷をしているレジに残らないように）
      void last.then(() => deleteLabelPrintProxy(deviceId));
    };
  }, [active, deviceId]);
};

/**
 * 代理印刷（レジ）。enabled のあいだ、まだ刷れていない頼みを引き受けて、このレジのラベル用のプリンター（printer）で刷る。
 * 頼まれたとき・プリンターがつながったときと、残っているあいだは一定の間隔で回す。刷れたら toast で知らせる。
 * プリンターがつながっているあいだは、代理印刷をしているとサーバーに知らせる。deviceId はこのレジ（ページを開くたびに作る id）
 */
export const useLabelPrintProxy = (
  enabled: boolean,
  printer: {
    status: "init" | PrinterConnectionStatus;
    print: (job: PrintJob) => Promise<boolean>;
  },
) => {
  const { requests, remove } = useLabelPrintQueue(enabled);
  const [deviceId] = useState(() => crypto.randomUUID());
  const state = useRef(createProxyState());
  // 回している途中に変わっても、最新のものを読む
  const latest = useRef({ enabled, printer, requests });
  latest.current = { enabled, printer, requests };
  const running = useRef(false);
  const again = useRef(false);

  const run = useCallback(async () => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        again.current = false;
        const { settled, printed } = await runLabelPrintProxy(
          latest.current.requests,
          {
            deviceId,
            claim: claimLabelPrint,
            print: (job) => latest.current.printer.print(job),
            markPrinted: markLabelPrinted,
            release: releaseLabelPrint,
            canPrint: () =>
              latest.current.enabled &&
              latest.current.printer.status === "connected",
            now: Date.now,
          },
          state.current,
        );
        remove(settled);
        if (printed.length > 0)
          toast(`代理印刷：緊急のシールを ${printed.length} 枚刷りました`);
      } while (again.current);
    } finally {
      running.current = false;
    }
  }, [deviceId, remove]);

  const active =
    enabled && printer.status === "connected" && requests.length > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 頼みが届くたびに回す（run は最新の一覧を ref から読む）
  useEffect(() => {
    if (active) void run();
  }, [active, run, requests]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(run, PROXY_RETRY_MS);
    return () => clearInterval(timer);
  }, [active, run]);
  useLabelPrintProxyPresence(
    enabled && printer.status === "connected",
    deviceId,
  );

  return { waiting: requests.length, deviceId };
};

/** 自分（deviceId）のほかに、代理印刷をしているレジがあるか */
export const hasOtherLabelPrintProxy = (
  proxies: readonly Pick<LabelPrintProxy, "device_id">[],
  deviceId: string,
) => proxies.some((proxy) => proxy.device_id !== deviceId);

/**
 * ページを開いて最初に共有の WebSocket がつながったとき、このレジの代理印刷がオフ（enabled でない）で、
 * ほかに代理印刷をしているレジ（オンで、ラベル用のプリンターがつながっている）が 1 台も無ければ、代理印刷をオンにする（enable）。
 * 見るのは 1 回だけで、つなぎ直したときは見ない（開いている間に手でオフにしたら、そのまま）。一覧を読めなければオンにしない
 */
export const useLabelPrintProxyAutoEnable = (
  enabled: boolean,
  enable: (next: boolean) => void,
  deviceId: string,
) => {
  const { status } = useOrdersWSContext();
  const checked = useRef(false);
  // 一覧を読んでいる間に変わっても、最新のものを読む
  const latest = useRef(enabled);
  latest.current = enabled;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (status !== "open" || checked.current) return;
    checked.current = true;
    if (latest.current) return;
    void getLabelPrintProxies().then((proxies) => {
      // 読んでいる間に手でオンにした・ページを離れたなら何もしない
      if (!proxies || !mounted.current || latest.current) return;
      if (hasOtherLabelPrintProxy(proxies, deviceId)) return;
      enable(true);
      toast(
        "ほかに代理印刷をしているレジが無いので、このレジの代理印刷をオンにしました",
      );
    });
  }, [status, deviceId, enable]);
};

const PROXY_SETTING_KEY = "cafeore:label-print-proxy";

/** このレジで代理印刷をするか。この端末に覚える（開き直してもそのまま） */
export const useLabelPrintProxySetting = () => {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(PROXY_SETTING_KEY) === "on";
    } catch {
      return false;
    }
  });
  const save = useCallback((next: boolean) => {
    setEnabled(next);
    try {
      if (next) localStorage.setItem(PROXY_SETTING_KEY, "on");
      else localStorage.removeItem(PROXY_SETTING_KEY);
    } catch {
      // 覚えられなくても、開いている間は使える
    }
  }, []);
  return [enabled, save] as const;
};
