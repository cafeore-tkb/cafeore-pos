import {
  type CaosOutboxEntry,
  type CaosOutboxOp,
  type CaosServerState,
  caosDayOrders,
  createCaosOutbox,
  jstDate,
  parseCaosOutboxEntry,
  sendCaosOutboxRequest,
} from "@cafeore/common";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { cancelPendingPrint } from "~/label/pending-prints";
import { createDeviceStore } from "~/lib/device-store";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";

import { caosLog } from "../utils/log";

// CaOS の送れていない操作（@cafeore/common の lib/caos-outbox.ts）。押した操作はまずこの端末に残し（~/lib/device-store。
// 再読み込み・タブを閉じても残り、同じ端末のタブどうしで共有する）、画面はサーバーの盤面にこれを重ねて出す（useLiveBoard・CaosLanesProvider）。
// 操作の画面（/master-sheet）から、送信中だけ Web Locks で排他し、古い順に 1 つずつ送る。
const store = createDeviceStore("cafeore:caos-outbox:", parseCaosOutboxEntry);

// 旧版がページを開いている間ずっと持つロックとは分け、古いタブが残っても新しい画面から送れるようにする。
const SENDER_LOCK = "cafeore:caos-sender:v2";
const NO_ENTRIES: readonly CaosOutboxEntry[] = [];

/** 残っている操作（古い順。送れて盤面が届くのを待っているものも） */
export const useCaosOutboxEntries = () =>
  useSyncExternalStore(store.subscribe, store.read, () => NO_ENTRIES);

// 押した順に送るので、同じミリ秒に押しても順が入れ替わらないようにする
let lastAt = 0;

/** 一連の操作を永続保存してから受け付ける。保存失敗時は画面を変えない。 */
export const enqueueCaosOps = (label: string, ops: readonly CaosOutboxOp[]) => {
  const entries: CaosOutboxEntry[] = [];
  try {
    for (const op of ops) {
      lastAt = Math.max(Date.now(), lastAt + 1);
      const entry = { id: crypto.randomUUID(), at: lastAt, label, op };
      store.putPersisted(entry);
      entries.push(entry);
    }
  } catch (error) {
    for (const { id } of entries) store.remove(id);
    caosLog("outbox.storage-failed", { label, error: String(error) });
    toast.error(`「${label}」を受け付けられませんでした`, {
      description:
        "この端末に操作を保存できません。空き容量やブラウザの保存設定を確認して、もう一度操作してください。",
    });
    return null;
  }
  for (const entry of entries) caosLog("outbox.enqueued", entry);
  return entries.map(({ id }) => id);
};

/** 担当者など単独の操作。永続保存に失敗した場合は null。 */
export const enqueueCaosOp = (label: string, op: CaosOutboxOp) =>
  enqueueCaosOps(label, [op])?.[0] ?? null;

// つなぎ直して注文が届いてから、今日の担当者が届き直すのを待つ長さ（担当者は注文のすぐあとに届く。届かなくても、これを過ぎたら送る）
const LANES_WAIT_MS = 3_000;

// 押してからこの長さのうちは、送っている途中とみて「未送信」に数えない（操作のたびに出たり消えたりしないように）
const UNSENT_AFTER_MS = 2_000;

/**
 * 残っている操作を送る（操作の画面で 1 回だけ呼ぶ）。つながっていれば（共有の WebSocket が開いていて注文が届いている）古い順に送り、
 * つながらなければ間をあけて送り直す。通らなかった（ほかの端末が先に変えた・決まりに合わない）ものは捨て、何が戻ったかを通知で出す。
 * entries はまだ送れていない操作（押してから UNSENT_AFTER_MS を過ぎたものがあるときだけ。nowMs は実時間の今）、
 * sending は今送っていて返事を待っている操作の id、retry は今すぐ送り直す、discard は送らずに消す（ヘッダーの「未送信 N 件」の一覧）。
 * onRejected は捨てた操作を受け取る（「直前の操作」から忘れる）
 */
export const useCaosOutboxSender = (
  nowMs: number,
  onRejected: (entry: CaosOutboxEntry) => void,
) => {
  const { orders, caosLanes, isOrdersLoaded, status } = useOrdersWSContext();
  const entries = useCaosOutboxEntries();
  const today = jstDate(nowMs);
  const todays = useMemo(() => caosDayOrders(orders, today), [orders, today]);
  // 前の日の担当者は、今日の担当者とみない（今日の担当者がまだ無ければサーバーは何も送らないので、前の日のものが残っている）
  const lanes = caosLanes?.day === today ? caosLanes : null;
  // 切れていたあいだの注文と担当者。つなぎ直すとサーバーが全部の注文と今日の担当者を送り直すので、それが届く（新しくなる）までは古い盤面とみて送らない。
  // 担当者は注文のあとに届くので、注文が届いてから（ordersAt）LANES_WAIT_MS までは担当者も待つ
  // （古い担当者で交代・入れ替えを確かめると、ほかの端末が替えた担当者を上書きしてしまう）
  const stale = useRef<{
    orders: typeof orders;
    lanes: typeof lanes;
    ordersAt?: number;
  } | null>(null);
  if (status !== "open") stale.current = { orders, lanes };
  const ordersFresh =
    status === "open" && isOrdersLoaded && orders !== stale.current?.orders;
  if (ordersFresh && stale.current) stale.current.ordersAt ??= nowMs;
  // 今日の担当者がまだ無ければサーバーは何も送らないので、そのときも LANES_WAIT_MS で待つのをやめる
  const lanesFresh =
    lanes !== stale.current?.lanes ||
    nowMs - (stale.current?.ordersAt ?? nowMs) >= LANES_WAIT_MS;
  const server = useRef<CaosServerState | null>(null);
  server.current = ordersFresh
    ? { orders: todays, lanes, lanesReady: lanesFresh }
    : null;
  const rejected = useRef(onRejected);
  rejected.current = onRejected;
  const [failure, setFailure] = useState<{ id: string; reason: string } | null>(
    null,
  );
  const [outbox] = useState(() =>
    createCaosOutbox({
      store,
      withLock: async (run) => {
        await store.withLock(async () => {
          store.reload();
          await run();
        }, SENDER_LOCK);
      },
      server: () => server.current,
      send: async (request, pressedAt) => {
        const started = performance.now();
        caosLog("outbox.send", { request, pressedAt });
        try {
          const result = await sendCaosOutboxRequest(request, pressedAt);
          caosLog("outbox.response", {
            request,
            pressedAt,
            result,
            durationMs: performance.now() - started,
          });
          return result;
        } catch (error) {
          caosLog("outbox.error", {
            request,
            pressedAt,
            error: String(error),
            durationMs: performance.now() - started,
          });
          throw error;
        }
      },
      onRetry: (entry, result) =>
        setFailure({
          id: entry.id,
          reason: `${result.error ?? "保存できませんでした"}${result.status ? `（HTTP ${result.status}）` : ""}`,
        }),
      // 取り消せた緊急の、この端末に残っているシールを消す
      onSent: ({ op, id }) => {
        caosLog("outbox.sent", { id, op });
        if (op.kind === "cancel-emergency") cancelPendingPrint(op.id);
      },
      onRejected: (entry, reason) => {
        caosLog("outbox.rejected", { entry, reason });
        const { label } = entry;
        toast.error(`「${label}」は通らなかったので、盤面を戻しました`, {
          description: reason,
        });
        rejected.current(entry);
      },
    }),
  );
  // 操作を送る間だけ排他する。別タブを開いたまま・停止中でも送信権を占有しない。
  useEffect(() => () => outbox.stop(), [outbox]);
  useEffect(() => {
    if (entries.length > 0) void outbox.kick();
  });
  useEffect(() => {
    const retry = () => void outbox.retryNow();
    const visible = () => {
      if (document.visibilityState === "visible") retry();
    };
    window.addEventListener("online", retry);
    window.addEventListener("pageshow", retry);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("pageshow", retry);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [outbox]);

  const unsent = entries.filter((entry) => !entry.sent);
  return {
    pendingCount: unsent.length,
    failure:
      failure && unsent.some((entry) => entry.id === failure.id)
        ? failure.reason
        : null,
    entries: unsent.some((entry) => nowMs - entry.at >= UNSENT_AFTER_MS)
      ? unsent
      : NO_ENTRIES,
    sending: outbox.inFlight(),
    retry: () => {
      caosLog("outbox.retry");
      void outbox.retryNow();
    },
    /**
     * 送らずに消す（盤面はサーバーの今に戻る。同じ端末のほかのタブからも消える）。消した操作は onRejected にも渡す（「直前の操作」から忘れる）。
     * 送っている途中のもの（sending。もうサーバーに届いているかもしれない）は消さない
     */
    discard: (ids: readonly string[]) => {
      void store.withLock(async () => {
        store.reload();
        // 送信中の別タブがロックを解放してから確認する。保存済みになった操作は消さない。
        for (const entry of store.read()) {
          if (entry.sent || !ids.includes(entry.id)) continue;
          caosLog("outbox.discard", { entry });
          store.remove(entry.id);
          rejected.current(entry);
        }
      }, SENDER_LOCK);
    },
  };
};
