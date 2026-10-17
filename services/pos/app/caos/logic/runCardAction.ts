import {
  type CaosCard,
  type CaosWritesResult,
  assignWrites,
  caosLane,
  dripperLabel,
  unassignWrites,
  unstartWrites,
} from "@cafeore/common";
import { type CardBoardAction, cardActions } from "./cardActions";
import { orderLabel } from "./cards";

/** 押したカードを最新の盤面で引き直し、許可された操作だけを既存の送信経路へ渡す。 */
export const runCardAction = (
  cards: readonly CaosCard[],
  pressed: CaosCard,
  action: CardBoardAction,
  nowMs: number,
  ops: {
    write: (result: CaosWritesResult, label: string) => boolean;
    fail: (message: string) => boolean;
    newId: () => string;
    onAssigned: (card: CaosCard, bayId: number) => void;
    start: (bayId: number, key: string) => unknown;
    finish: (bayId: number) => unknown;
  },
) => {
  const card = cards.find((item) => item.key === pressed.key);
  if (!card?.dripper) return ops.fail("カードが見つかりません");
  const lane = caosLane(cards, card.dripper);
  if (
    !cardActions(card, lane, { nowMs, comments: false }).some(
      (item) => item.action === action && !item.disabled,
    )
  )
    return ops.fail("カードの状態が変わりました。もう一度確認してください");
  if (action.startsWith("assign:")) {
    const bayId = Number(action.slice(7));
    const ok = ops.write(
      assignWrites(cards, card, bayId, { newId: ops.newId }),
      `移動 ${orderLabel(card)} → ${dripperLabel(bayId)}`,
    );
    if (ok) ops.onAssigned(card, bayId);
    return ok;
  }
  if (action === "unassign")
    return ops.write(unassignWrites(card), `未割当に戻す ${orderLabel(card)}`);
  if (action === "unstart")
    return ops.write(
      unstartWrites(cards, card),
      `未着手に戻す ${orderLabel(card)}`,
    );
  if (action === "start") return ops.start(card.dripper, card.key);
  return ops.finish(card.dripper);
};
