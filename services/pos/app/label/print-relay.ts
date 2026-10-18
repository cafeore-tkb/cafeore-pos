import {
  type LabelPrintClaim,
  type LabelPrintRequest,
  claimLabelPrint,
  getLabelPrintRequests,
  markLabelPrinted,
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
 */

/** 刷れなかった・ほかのレジが刷っている頼みを、もう一度引き受けにいくまでの間（ミリ秒） */
export const PROXY_RETRY_MS = 10_000;

/** 頼みの一覧を読み直す間隔（ミリ秒）。配信を受け損ねたとき（ほかのインスタンスの知らせが届かないなど）のため */
const QUEUE_REFRESH_MS = 30_000;

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
    // キューへのアクセス成功と共有セッションの接続を確認（レジでの印刷完了とは別）。
    relayAvailable: enabled && status === "open" && queueAvailable,
  };
};

/**
 * 代理印刷（レジ）。enabled のあいだ、まだ刷れていない頼みを引き受けて、このレジのラベル用のプリンター（printer）で刷る。
 * 頼まれたとき・プリンターがつながったときと、残っているあいだは一定の間隔で回す。刷れたら toast で知らせる
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

  return { waiting: requests.length };
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
