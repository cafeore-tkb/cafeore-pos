import { type CaosCard, caosNextLocked } from "@cafeore/common";
import type { Lane } from "./lanes";

// ドリッパーのカード（管制盤 A・C・D）を押すとカードの上に出る操作（アイコン）。1 回目で出し、2 回目でアイコンを押して決める（誤操作を防ぐ）。
// カードの段階は今の列（抽出の開始・終了の時刻と順番）で決める（DB に段階の列は足さない）：
//   - 未着手（ready）：抽出中の無い列の待機の先頭（前のカードが終わって、まだ始めていない）。▶ で始める
//   - 待機（queued）：ほかの待機（前が抽出中か、前にほかの待機がある）。移す・統合はドラッグ
//   - 抽出中（brewing）：始めた時刻がある（「着手」と「ドリップ開始」は分けない）。✓ で終えて待機の先頭を始め、✋ で終えて次は未着手のまま、
//     ↻ で未着手に戻す（統合・ほかの人に振り直すのは、戻してからドラッグ）、🚨 で入れ直し
//   - 終わり（done。管制盤 A のタイムラインだけ）：🚨 で入れ直し

/** カードの段階（未着手は、抽出中の無い列の待機の先頭） */
type CardStage = "ready" | CaosCard["status"];

/** カードの段階。lane はカードのある列 */
export const cardStage = (
  card: CaosCard,
  lane: Pick<Lane, "brewing" | "queued">,
): CardStage =>
  card.status === "queued" && !lane.brewing && lane.queued[0]?.key === card.key
    ? "ready"
    : card.status;

/** カードの上に出す操作。close はいつも最後 */
export type CardAction =
  | "start"
  | "finish"
  | "hold"
  | "unstart"
  | "emergency"
  | "comment"
  | "close";

/** 盤面を書き換えるカードの操作（hooks/useCaosSession の runCardAction） */
export type CardBoardAction = Exclude<
  CardAction,
  "emergency" | "comment" | "close"
>;

/**
 * 段階ごとに出す操作（出す順）と、押せないか（終える操作は、始めてから @cafeore/common の CAOS_NEXT_COOLDOWN_SEC 秒は押せない）。
 * ✋（終えて次は始めない）は、待機のある列だけ（無ければ ✓ と同じ）。💬 はコメントのある注文だけ
 */
export const cardActions = (
  card: CaosCard,
  lane: Pick<Lane, "brewing" | "queued">,
  { nowMs, comments }: { nowMs: number; comments: boolean },
): { action: CardAction; disabled: boolean }[] => {
  const stage = cardStage(card, lane);
  const locked = caosNextLocked(lane.brewing, nowMs);
  const own: CardAction[] =
    stage === "ready"
      ? ["start"]
      : stage === "brewing"
        ? [
            "emergency",
            "unstart",
            ...(lane.queued.length > 0 ? ["hold" as const] : []),
            "finish",
          ]
        : stage === "done"
          ? ["emergency"]
          : [];
  return [
    ...own,
    ...(comments ? ["comment" as const] : []),
    "close" as const,
  ].map((action) => ({
    action,
    disabled: locked && (action === "finish" || action === "hold"),
  }));
};
