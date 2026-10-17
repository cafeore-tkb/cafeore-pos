import { type ItemType, MenuEntity } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import {
  type CashierDraft,
  addLine,
  assignLine,
  emptyCashierDraft,
} from "./cashierDraft";
import { parsePrepay, prepaySnapshot, restorePrepay } from "./cashierPrepay";
import {
  beginRest,
  beginSubtotal,
  currentSubtotal,
  dueAmount,
  recordTender,
  setPart,
  splitPaymentsForOrder,
  unpaidLines,
} from "./cashierSplit";

const hot: ItemType = {
  id: "hot",
  name: "hot",
  display_name: "ホット",
  makes_cup: true,
  needs_brew: true,
  senior_only: false,
  iced_brew: false,
};

/** サーバーに送る形（menuSchema.required({ id })）に合うよう、ID は UUID にする */
const menu = (n: number, price: number) =>
  MenuEntity.fromMenu({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    name: `menu${n}`,
    abbr: `m${n}`,
    price,
    key: `${n}`,
    items: [
      {
        item: {
          id: `00000000-0000-4000-8000-00000000010${n}`,
          name: `item${n}`,
          abbr: `i${n}`,
          item_type: hot,
        },
        quantity: 1,
      },
    ],
    assignee: null,
  });

const blend = menu(1, 500);
const latte = menu(2, 600);

const withLines = (...items: (typeof blend)[]): CashierDraft =>
  items.reduce(addLine, emptyCashierDraft());

/** サーバーを通したのと同じく、JSON にして読み直す */
const roundTrip = (draft: CashierDraft, orderId: number) =>
  parsePrepay(JSON.parse(JSON.stringify(prepaySnapshot(draft, orderId))));

/** blend・latte のうち blend を個別小計で現金で払い（番号を固定）、残りの latte を金額で分けた途中 */
const prepaying = (): CashierDraft => {
  const start = assignLine(withLines(blend, latte), 1, 2, "山田");
  const [b] = start.lines.map((line) => line.key);
  const paid = recordTender(beginSubtotal(start, "items", [b], 1, 100), {
    method: "cash",
    amount: 400,
    received: 1000,
  });
  const rest = setPart(beginRest(paid, 1, 100), 200);
  return {
    ...rest,
    coupon: "012",
    memo: "氷少なめ",
    received: "300",
    fixedOrderId: 12,
  };
};

describe("[unit] cashierPrepay の先払いの途中の状態", () => {
  test("先払いが無ければ送らない（サーバーの記録を消す）", () => {
    expect(prepaySnapshot(emptyCashierDraft(), 1)).toBeNull();
    // 会計の段階に進んだだけ（まだ受け取っていない）
    expect(prepaySnapshot(beginRest(withLines(blend), 0, 100), 1)).toBeNull();
  });

  test("番号はレシートに載せた番号。手で付け直して固定を外したら今の番号", () => {
    expect(prepaySnapshot(prepaying(), 30)?.orderId).toBe(12);
    expect(
      prepaySnapshot({ ...prepaying(), fixedOrderId: null }, 30)?.orderId,
    ).toBe(30);
  });

  test("サーバーを通して戻すと、受け取った支払いと会計中の小計の途中から続けられる", () => {
    const draft = prepaying();
    const saved = roundTrip(draft, 30);
    if (saved === null) throw new Error("読めなかった");
    const restored = restorePrepay(saved);

    expect(restored.fixedOrderId).toBe(12);
    expect(restored.step).toBe("pay");
    expect(restored.split).toEqual(draft.split);
    expect(restored.lines.map((line) => line.key)).toEqual(
      draft.lines.map((line) => line.key),
    );
    expect(restored.lines.map((line) => line.menu.toMenu())).toEqual(
      draft.lines.map((line) => line.menu.toMenu()),
    );
    expect(restored.lines[1].menu).toMatchObject({
      dripper: 2,
      assignee: "山田",
    });
    expect(restored).toMatchObject({
      nextKey: draft.nextKey,
      coupon: "012",
      special: false,
      memo: "氷少なめ",
    });
    // 今の操作だけのもの（受取金額・選んでいる行）は戻さない
    expect(restored).toMatchObject({
      received: "",
      payment: "cash",
      selected: null,
    });
    expect(currentSubtotal(restored)?.kind).toBe("rest");
    expect(dueAmount(restored)).toBe(200);
    expect(splitPaymentsForOrder(restored)).toEqual(
      splitPaymentsForOrder(draft),
    );
  });

  test("小計を払い終えた後（会計の段階でない）なら、入れる段階に戻る", () => {
    const start = withLines(blend, latte);
    const [b] = start.lines.map((line) => line.key);
    const paid = recordTender(beginSubtotal(start, "items", [b], 0, 100), {
      method: "square",
      amount: 500,
      received: 500,
      squareCheckoutId: "00000000-0000-4000-8000-000000000201",
      squarePaymentType: "QR_CODE",
    });
    const saved = roundTrip({ ...paid, fixedOrderId: 5 }, 5);
    if (saved === null) throw new Error("読めなかった");
    const restored = restorePrepay(saved);

    expect(restored.step).toBe("entry");
    expect(restored.split.tenders[0]).toMatchObject({
      squareCheckoutId: "00000000-0000-4000-8000-000000000201",
      squarePaymentType: "QR_CODE",
    });
    expect(unpaidLines(restored).map((line) => line.key)).toEqual(
      unpaidLines(paid).map((line) => line.key),
    );
  });

  test("形が違えば読まない", () => {
    const snapshot = prepaySnapshot(prepaying(), 30);
    expect(parsePrepay({ ...snapshot, lines: [] })).toBeNull();
    expect(
      parsePrepay({
        ...snapshot,
        split: { ...snapshot?.split, tenders: [] },
      }),
    ).toBeNull();
    expect(parsePrepay({ orderId: 12 })).toBeNull();
  });
});
