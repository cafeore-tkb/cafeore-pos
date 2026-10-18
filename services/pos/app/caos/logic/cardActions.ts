import {
  type CaosCard,
  caosCardServed,
  caosDripperAllowed,
} from "@cafeore/common";
import { type Lane, moveTargets } from "./lanes";

// カードの操作は列の順番と開始時刻から決める。着手後60秒未満は取り消し、以降は緊急・完了。

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

/** 再割当は既存の割当と同じ制約・書き込み経路を使う。 */
export type CardAction =
  | `assign:${number}`
  | "start"
  | "finish"
  | "unstart"
  | "unassign"
  | "emergency"
  | "comment";

export type CardBoardAction = Exclude<CardAction, "emergency" | "comment">;

/** 60秒ちょうどから完了できる。コメントはあるときだけ。 */
export const cardActions = (
  card: CaosCard,
  lane: Pick<Lane, "brewing" | "queued">,
  { nowMs, comments }: { nowMs: number; comments: boolean },
): { action: CardAction; disabled: boolean }[] => {
  const stage = cardStage(card, lane);
  const served = caosCardServed(card);
  const own: CardAction[] = [];
  if (stage === "queued" || stage === "ready") {
    own.push(
      ...moveTargets(card, card.dripper)
        .filter(({ current }) => !current)
        .map(({ bayId }) => `assign:${bayId}` as const),
    );
    if (stage === "ready") own.push("start");
    own.push("unassign");
  } else if (stage === "brewing") {
    if (!card.startedAt || nowMs - card.startedAt.getTime() < 60_000)
      own.push("unstart");
    else own.push("emergency");
  } else if (stage === "done") own.push("emergency");
  if (comments) own.push("comment");
  if (
    stage === "brewing" &&
    (served || (card.startedAt && nowMs - card.startedAt.getTime() >= 60_000))
  )
    own.push("finish");
  return own.map((action) => ({
    action,
    disabled:
      action.startsWith("assign:") &&
      !caosDripperAllowed(card, Number(action.slice(7))),
  }));
};
