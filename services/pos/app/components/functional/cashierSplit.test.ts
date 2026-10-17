import { type ItemType, MenuEntity, OrderEntity } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import {
  type CashierDraft,
  addLine,
  canEditLines,
  canGoPay,
  emptyCashierDraft,
  inputDigits,
  isDiscountLocked,
  removeLine,
  toggleSpecial,
} from "./cashierDraft";
import {
  allocateDiscount,
  beginRest,
  beginSubtotal,
  canLeavePayment,
  cancelPart,
  checkPart,
  currentSubtotal,
  displayOrder,
  dueAmount,
  leavePayment,
  paidLineKeys,
  preferDiscount,
  prepaidAmount,
  recordTender,
  removeTenders,
  setPart,
  splitOrderForSubmit,
  splitPaymentsForOrder,
  subtotalOrder,
  subtotalPreview,
  unpaidLines,
} from "./cashierSplit";

const itemType = (name: string, needsBrew: boolean): ItemType => ({
  id: name,
  name,
  display_name: name,
  makes_cup: needsBrew,
  needs_brew: needsBrew,
  senior_only: false,
  iced_brew: false,
  needs_finishing: false,
});

const hot = itemType("hot", true);
const goods = itemType("others", false);

/** 値段と、コーヒー（抽出が要る）の杯数を決めたメニュー */
const menu = (id: string, price: number, coffees: number) =>
  MenuEntity.fromMenu({
    id,
    name: id,
    abbr: id,
    price,
    key: id,
    items: [
      {
        item: { id, name: id, abbr: id, item_type: coffees > 0 ? hot : goods },
        quantity: Math.max(coffees, 1),
      },
    ],
    assignee: null,
  });

const blend = menu("blend", 500, 1);
const latte = menu("latte", 600, 1);
const pair = menu("pair", 900, 2);
const cookie = menu("cookie", 200, 0);

const withLines = (...items: (typeof blend)[]): CashierDraft =>
  items.reduce(addLine, emptyCashierDraft());

const keysOf = (draft: CashierDraft) => draft.lines.map((line) => line.key);

const cash = (amount: number, received = amount) => ({
  method: "cash" as const,
  amount,
  received,
});

describe("[unit] cashierSplit の小計", () => {
  test("一括会計はまだ払っていない商品を全部 1 つの小計にして、会計の段階に進む", () => {
    const draft = beginRest(
      removeLine(withLines(blend, latte, cookie), 2),
      0,
      100,
    );
    const subtotal = currentSubtotal(draft);
    expect(draft.step).toBe("pay");
    expect(subtotal).toMatchObject({ kind: "rest", total: 1100, amount: 1100 });
    expect(subtotal?.lineKeys).toEqual(keysOf(draft).slice(0, 2));
    expect(dueAmount(draft)).toBe(1100);
    // 商品が無ければ進まない
    expect(beginRest(emptyCashierDraft(), 0, 100).step).toBe("entry");
  });

  test("個別小計は選んだ商品の小計にし、割り振った割引を引く", () => {
    const start = withLines(blend, latte, cookie);
    const [b, l, c] = keysOf(start);
    const draft = beginSubtotal(start, "items", [c, l], 1, 100);
    // 1 杯分の割引は並び順の blend に付く。latte・cookie の小計には付かない
    expect(currentSubtotal(draft)).toMatchObject({
      kind: "items",
      lineKeys: [l, c],
      total: 800,
      discountCups: 0,
      amount: 800,
    });
    const preferred = beginSubtotal(
      preferDiscount(start, l),
      "items",
      [l],
      1,
      100,
    );
    expect(currentSubtotal(preferred)).toMatchObject({
      discountCups: 1,
      discount: 100,
      amount: 500,
    });
    // 選んでいない行は入らない
    expect(beginSubtotal(start, "items", [], 1, 100)).toBe(start);
    expect(
      currentSubtotal(beginSubtotal(start, "items", [b, 99], 0, 100))?.lineKeys,
    ).toEqual([b]);
  });

  test("会計の段階は、受け取る前ならやめられる（小計を外す）。途中まで払ったらやめられない", () => {
    const paying = beginRest(withLines(blend, latte), 0, 100);
    expect(canLeavePayment(paying)).toBe(true);
    const left = leavePayment(paying);
    expect(left.step).toBe("entry");
    expect(left.split.subtotals).toEqual([]);
    const part = setPart(paying, 300);
    const partlyPaid = recordTender(part, cash(300));
    expect(partlyPaid.step).toBe("pay");
    expect(canLeavePayment(partlyPaid)).toBe(false);
    expect(leavePayment(partlyPaid)).toBe(partlyPaid);
  });
});

describe("[unit] cashierSplit の小計分割", () => {
  test("小計より少ない額だけ先に払う。同じ額・多い額は分けない", () => {
    const paying = beginRest(withLines(blend, latte), 0, 100);
    expect(checkPart(0, 1100, false)).toEqual({ ok: false, message: "" });
    expect(checkPart(1200, 1100, false).message).toBe(
      "小計より多い額は先払いにできません",
    );
    expect(checkPart(1100, 1100, false).message).toBe(
      "小計と同じ額ならそのまま会計してください",
    );
    expect(checkPart(1100, 1100, true).message).toBe(
      "残りと同じ額なら「残りを全て会計」を使ってください",
    );
    expect(setPart(paying, 1100)).toBe(paying);
    const part = setPart({ ...paying, received: "500" }, 400);
    expect(dueAmount(part)).toBe(400);
    expect(part.received).toBe("");
    expect(dueAmount(cancelPart(part))).toBe(1100);
  });

  test("受け取ったら分割をやめ、小計の残りを払う。払い終えたら商品は会計済になる", () => {
    const start = withLines(blend, latte, cookie);
    const [b, l, c] = keysOf(start);
    const paying = beginSubtotal(start, "items", [b, l], 0, 100);
    const first = recordTender(setPart(paying, 300), cash(300, 500));
    expect(first.step).toBe("pay");
    expect(first.split.part).toBeNull();
    expect(dueAmount(first)).toBe(800);
    expect(prepaidAmount(first.split)).toBe(300);
    // 先払いがあると、商品・割引を変えない
    expect(canEditLines(first)).toBe(false);
    expect(isDiscountLocked(first)).toBe(true);
    const done = recordTender(first, cash(800, 1000));
    expect(done.step).toBe("entry");
    expect(done.split.current).toBeNull();
    expect([...paidLineKeys(done)]).toEqual([b, l]);
    expect(unpaidLines(done).map((line) => line.key)).toEqual([c]);
    expect(canGoPay(done)).toBe(true);
    // 残りを会計は、まだ払っていない商品だけ
    expect(currentSubtotal(beginRest(done, 0, 100))?.lineKeys).toEqual([c]);
    expect(inputDigits(done, "1")).toBe(done);
    expect(toggleSpecial(done, false)).toBe(done);
  });
});

describe("[unit] cashierSplit の割引", () => {
  test("既定では並び順のコーヒーに 1 杯ずつ割り振り、グッズには振らない", () => {
    const draft = withLines(cookie, pair, blend);
    const [, p, b] = keysOf(draft);
    expect([...allocateDiscount(draft, 1)]).toEqual([[p, 1]]);
    expect([...allocateDiscount(draft, 3)]).toEqual([
      [p, 2],
      [b, 1],
    ]);
    expect([...allocateDiscount(draft, 5)]).toEqual([
      [p, 2],
      [b, 1],
    ]);
  });

  test("小計に割り振った杯数を除いて、残りの行に割り振る。付け替えは小計に入れていない行だけに効く", () => {
    const start = withLines(blend, latte, pair);
    const [b, l, p] = keysOf(start);
    const paid = recordTender(
      beginSubtotal(start, "items", [b], 2, 100),
      cash(400),
    );
    expect([...allocateDiscount(paid, 2)]).toEqual([[l, 1]]);
    expect([...allocateDiscount(preferDiscount(paid, p), 2)]).toEqual([[p, 1]]);
    expect(
      subtotalPreview(preferDiscount(paid, p), [l, p], 2, 100),
    ).toMatchObject({
      total: 1500,
      discount: 100,
      amount: 1400,
    });
  });
});

describe("[unit] cashierSplit の返金", () => {
  const twoSubtotals = () => {
    const start = withLines(blend, latte, cookie);
    const [b] = keysOf(start);
    const first = recordTender(
      beginSubtotal(start, "items", [b], 0, 100),
      cash(500),
    );
    const paying = beginRest(first, 0, 100);
    return recordTender(setPart(paying, 300), {
      method: "square" as const,
      amount: 300,
      received: 300,
      squareCheckoutId: "c-1",
      squarePaymentType: "CARD_PRESENT" as const,
    });
  };

  test("小計の分を返金すると、その商品はまた払っていないことになる", () => {
    const draft = twoSubtotals();
    const [first, second] = draft.split.subtotals;
    const refunded = removeTenders(
      draft,
      draft.split.tenders
        .filter((t) => t.subtotalId === first.id)
        .map((t) => t.id),
      [first.id],
    );
    expect(refunded.step).toBe("pay");
    expect(refunded.split.current).toBe(second.id);
    expect(unpaidLines(refunded)).toHaveLength(3);
    expect(prepaidAmount(refunded.split)).toBe(300);
  });

  test("会計中の小計の分か全部を返金すると、入れる段階に戻る", () => {
    const draft = twoSubtotals();
    const [first, second] = draft.split.subtotals;
    const current = removeTenders(
      draft,
      draft.split.tenders
        .filter((t) => t.subtotalId === second.id)
        .map((t) => t.id),
      [second.id],
    );
    expect(current.step).toBe("entry");
    expect(current.split.subtotals.map((s) => s.id)).toEqual([first.id]);
    const all = removeTenders(
      draft,
      draft.split.tenders.map((t) => t.id),
      draft.split.subtotals.map((s) => s.id),
    );
    expect(all.step).toBe("entry");
    expect(all.split.subtotals).toEqual([]);
    expect(canEditLines(all)).toBe(true);
  });
});

describe("[unit] cashierSplit の送る注文", () => {
  test("支払いは小計の行を指し、小計の割引はその小計を払い終えた支払いに付ける", () => {
    const start = removeLine(withLines(blend, cookie, latte, pair), 1);
    const [, l] = keysOf(start);
    const first = recordTender(
      beginSubtotal(preferDiscount(start, l), "items", [l], 1, 100),
      cash(500, 1000),
    );
    const paying = setPart(beginRest(first, 1, 100), 600);
    const second = recordTender(paying, {
      method: "square",
      amount: 600,
      received: 600,
      squareCheckoutId: "c-1",
      squarePaymentType: "QR_CODE",
    });
    const done = recordTender(second, cash(800));
    expect(done.split.current).toBeNull();
    expect(splitPaymentsForOrder(done)).toEqual([
      {
        method: "cash",
        amount: 500,
        received: 1000,
        discount: 100,
        menuIndexes: [1],
      },
      {
        method: "square",
        amount: 600,
        received: 600,
        discount: 0,
        menuIndexes: [0, 2],
        squareCheckoutId: "c-1",
      },
      {
        method: "cash",
        amount: 800,
        received: 800,
        discount: 0,
        menuIndexes: [0, 2],
      },
    ]);
  });

  test("送る注文は、お預かりを合計にし、割引を小計で引いた分にそろえる", () => {
    const start = withLines(blend, latte);
    const [b, l] = keysOf(start);
    const first = recordTender(
      beginSubtotal(start, "items", [b], 1, 100),
      cash(400, 1000),
    );
    const done = recordTender(
      beginSubtotal(first, "items", [l], 1, 100),
      cash(600),
    );
    const order = OrderEntity.createNew({ orderId: 3 });
    order.menus = [blend, latte];
    order.applyServiceOneCupDiscount();
    const submitted = splitOrderForSubmit(order, done);
    expect(submitted.payments.map((p) => p.amount)).toEqual([400, 600]);
    expect(submitted.received).toBe(1600);
    expect(submitted.billingAmount).toBe(1000);
    expect(submitted.getCharge()).toBe(600);
    // 払い始めてから割引が外れても、小計で引いた分で送る
    order.removeDiscount();
    expect(splitOrderForSubmit(order, done).billingAmount).toBe(1000);
  });

  test("小計だけの注文とお客さん向けの表示", () => {
    const order = OrderEntity.createNew({ orderId: 42 });
    order.menus = [blend, latte, cookie];
    order.applyServiceOneCupDiscount();
    const start = withLines(blend, latte, cookie);
    const [, l, c] = keysOf(start);
    // 一括会計はそのまま
    const whole = beginRest(start, 1, 100);
    expect(displayOrder(order, whole)).toBe(order);
    const paying = {
      ...beginSubtotal(preferDiscount(start, l), "items", [l, c], 1, 100),
      received: "1000",
    };
    const subtotal = currentSubtotal(paying);
    if (subtotal === null) throw new Error("no subtotal");
    const part = subtotalOrder(order, paying, subtotal, 1000);
    expect(part.orderId).toBe(42);
    expect(part.menus.map((m) => m.id)).toEqual(["latte", "cookie"]);
    expect(part.billingAmount).toBe(700);
    expect(part.getCharge()).toBe(300);
    expect(displayOrder(order, paying).billingAmount).toBe(700);
    // 小計分割の間は、注文全体を受取金額なしで出す
    const split = setPart(paying, 300);
    expect(displayOrder(order, split).billingAmount).toBe(order.billingAmount);
    expect(displayOrder(order, split).received).toBe(0);
  });
});
