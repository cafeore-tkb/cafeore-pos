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

// CaOS の送れていない操作（@cafeore/common の lib/caos-outbox.ts）。押した操作はまずこの端末に残し（~/lib/device-store。
// 再読み込み・タブを閉じても残り、同じ端末のタブどうしで共有する）、画面はサーバーの盤面にこれを重ねて出す（useLiveBoard・CaosLanesProvider）。
// 送るのは操作の画面（/master-sheet）の 1 つのタブだけ（Web Locks で決める。閉じたらほかのタブが引き継ぐ）で、古い順に 1 つずつ。
const store = createDeviceStore("cafeore:caos-outbox:", parseCaosOutboxEntry);

const NO_ENTRIES: readonly CaosOutboxEntry[] = [];

/** 残っている操作（古い順。送れて盤面が届くのを待っているものも） */
export const useCaosOutboxEntries = () =>
  useSyncExternalStore(store.subscribe, store.read, () => NO_ENTRIES);

// 押した順に送るので、同じミリ秒に押しても順が入れ替わらないようにする
let lastAt = 0;

/** 操作を端末に残す（後ろで送る）。label は「1つ戻す」と同じ操作の名前（通らなかったときの知らせに出す） */
export const enqueueCaosOp = (label: string, op: CaosOutboxOp) => {
  lastAt = Math.max(Date.now(), lastAt + 1);
  store.put({ id: crypto.randomUUID(), at: lastAt, label, op });
};

// 押してからこの長さのうちは、送っている途中とみて「未送信」に数えない（操作のたびに出たり消えたりしないように）
const UNSENT_AFTER_MS = 2_000;

/**
 * 残っている操作を送る（操作の画面で 1 回だけ呼ぶ）。つながっていれば（共有の WebSocket が開いていて注文が届いている）古い順に送り、
 * つながらなければ間をあけて送り直す。通らなかった（ほかの端末が先に変えた・決まりに合わない）ものは捨て、何が戻ったかを通知で出す。
 * count はまだ送れていない数（押してから UNSENT_AFTER_MS を過ぎたものがあるときだけ。nowMs は実時間の今）、
 * retry は今すぐ送り直す（ヘッダーの「未送信 N 件」）。onRejected は捨てた操作の名前を受け取る（「1つ戻す」から忘れる）
 */
export const useCaosOutboxSender = (
  nowMs: number,
  onRejected: (label: string) => void,
) => {
  const { orders, caosLanes, isOrdersLoaded, status } = useOrdersWSContext();
  const entries = useCaosOutboxEntries();
  const today = jstDate(nowMs);
  const todays = useMemo(() => caosDayOrders(orders, today), [orders, today]);
  // 切れていたあいだの注文。つなぎ直すとサーバーが全部の注文を送り直すので、それが届く（注文が新しくなる）までは古い盤面とみて送らない
  const stale = useRef<typeof orders | null>(null);
  if (status !== "open") stale.current = orders;
  const server = useRef<CaosServerState | null>(null);
  server.current =
    status === "open" && isOrdersLoaded && orders !== stale.current
      ? {
          orders: todays,
          // 前の日の担当者は、今日の担当者とみない（今日の担当者がまだ無ければサーバーは何も送らないので、前の日のものが残っている）
          lanes: caosLanes?.day === today ? caosLanes : null,
        }
      : null;
  const rejected = useRef(onRejected);
  rejected.current = onRejected;
  const [outbox] = useState(() =>
    createCaosOutbox({
      store,
      server: () => server.current,
      send: sendCaosOutboxRequest,
      // 取り消せた緊急の、この端末に残っているシールを消す
      onSent: ({ op }) => {
        if (op.kind === "cancel-emergency") cancelPendingPrint(op.id);
      },
      onRejected: ({ label }, reason) => {
        toast.error(`「${label}」は通らなかったので、盤面を戻しました`, {
          description: reason,
        });
        rejected.current(label);
      },
    }),
  );
  // 同じ端末で送るのは 1 つのタブだけ。開いているあいだロックを持ち、閉じたら次のタブが送る
  const [leader, setLeader] = useState(false);
  useEffect(() => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = true;
    void store.withLock(async () => {
      if (!active) return;
      setLeader(true);
      await held;
    });
    return () => {
      active = false;
      release();
      setLeader(false);
      outbox.stop();
    };
  }, [outbox]);

  // 描き直すたび（残りが変わった・サーバーの盤面が届いた・つながった・時計が進んだ）に、送れるものがあれば送る
  useEffect(() => {
    if (leader && entries.length > 0) void outbox.kick();
  });
  // 端末がネットワークに戻ったら、送り直しの間隔を待たずに送る
  useEffect(() => {
    if (!leader) return;
    const retry = () => void outbox.retryNow();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [leader, outbox]);

  const unsent = entries.filter((entry) => !entry.sent);
  return {
    count: unsent.some((entry) => nowMs - entry.at >= UNSENT_AFTER_MS)
      ? unsent.length
      : 0,
    retry: () => {
      if (leader) void outbox.retryNow();
    },
  };
};
