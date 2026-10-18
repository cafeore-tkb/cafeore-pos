/** 続いた番号のまとまり（start から end まで。1 つだけなら start と end が同じ） */
export type OrderIdRange = { start: number; end: number };

/**
 * from より大きく to 以下の番号のうち、どの注文にも使われていない番号を、続いた番号ごとにまとめて小さい順に返す
 *
 * 番号を手で付け間違えて大きく飛んでも、番号を 1 つずつ数えずに求める
 */
export const missingOrderIdRanges = (
  orderIds: Iterable<number>,
  from: number,
  to: number,
): OrderIdRange[] => {
  const used = [...new Set(orderIds)]
    .filter((id) => id > from && id <= to)
    .sort((a, b) => a - b);
  const ranges: OrderIdRange[] = [];
  let prev = from;
  for (const id of [...used, to + 1]) {
    if (id > prev + 1) {
      ranges.push({ start: prev + 1, end: id - 1 });
    }
    prev = id;
  }
  return ranges;
};

/** まとまりに入っている番号の数 */
export const countOrderIds = (ranges: readonly OrderIdRange[]): number =>
  ranges.reduce((acc, range) => acc + range.end - range.start + 1, 0);

/** 「No.12」「No.11〜14」 */
export const formatOrderIdRange = ({ start, end }: OrderIdRange): string =>
  start === end ? `No.${start}` : `No.${start}〜${end}`;
