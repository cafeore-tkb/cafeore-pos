import { dripperLabel } from "@cafeore/common";

// 指名はレジで選んだドリッパーの番号（注文の明細の dripper。1st〜6th は 1〜6）。
// 番号の付いたカードはその番号のドリッパーにだけ置ける（preferredBaristaId）。番号の無い自由記述だけの古い明細は指名なし。
// カードに出す指名の文字は、マスターの画面と同じく assignmentDisplay（@cafeore/common の models/dripper.ts）で作る
// （番号は「2nd」、番号の無い古い明細は自由記述）。live/board.ts の describe を参照。

/** カードの指名の表示。盤面のカードは nominee（マスターと同じ表示）、練習のカードは番号から作る */
export const nominationText = (card: {
  nominee?: string;
  preferredBaristaId?: number;
}) =>
  card.nominee ??
  (card.preferredBaristaId ? dripperLabel(card.preferredBaristaId) : undefined);
