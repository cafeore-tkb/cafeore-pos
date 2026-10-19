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
  beginRest,
  canLeavePayment,
  canSplitPart,
  cancelPart,
  checkPart,
  currentSubtotal,
  displayOrder,
  dueAmount,
  leavePayment,
  prepaidAmount,
  recordTender,
  removeTenders,
  setPart,
  splitOrderForSubmit,
  splitPaymentsForOrder,
  subtotalOrder,
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
    expect(subtotal).toMatchObject({ total: 1100, amount: 1100 });
    expect(subtotal?.lineKeys).toEqual(keysOf(draft).slice(0, 2));
    expect(dueAmount(draft)).toBe(1100);
    // 商品が無ければ進まない
    expect(beginRest(emptyCashierDraft(), 0, 100).step).toBe("entry");
  });

  test("割引は注文全体で割り引く杯数を、小計のコーヒーの杯数まで引く", () => {
    const start = withLines(cookie, pair, blend);
    expect(currentSubtotal(beginRest(start, 1, 100))).toMatchObject({
      total: 1600,
      discountCups: 1,
      discount: 100,
      amount: 1500,
    });
    // グッズ（cookie）には引かない
    expect(currentSubtotal(beginRest(start, 5, 100))).toMatchObject({
      discountCups: 3,
      discount: 300,
      amount: 1300,
    });
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

  test("受け取ったら分割をやめ、小計の残りを払う。払い終えたら払っていない商品は無い", () => {
    const paying = beginRest(withLines(blend, latte), 0, 100);
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
    expect(unpaidLines(done)).toEqual([]);
    expect(canGoPay(done)).toBe(false);
    expect(inputDigits(done, "1")).toBe(done);
    expect(toggleSpecial(done, false)).toBe(done);
  });

  test("会計の段階で、残りが 2 円以上なら分けられる。Square で決済中は分けられない", () => {
    expect(canSplitPart(withLines(blend, latte), false)).toBe(false);
    const paying = beginRest(withLines(blend, latte), 0, 100);
    expect(canSplitPart(paying, false)).toBe(true);
    expect(canSplitPart(paying, true)).toBe(false);
    // 途中まで払っても、続けて分けられる
    expect(
      canSplitPart(recordTender(setPart(paying, 300), cash(300)), false),
    ).toBe(true);
    expect(
      canSplitPart(recordTender(setPart(paying, 1099), cash(1099)), false),
    ).toBe(false);
  });
});

describe("[unit] cashierSplit の返金", () => {
  test("先払いを全部返金すると、入れる段階に戻り、商品を変えられる", () => {
    const paying = beginRest(withLines(blend, latte), 0, 100);
    const first = recordTender(setPart(paying, 300), cash(300));
    const draft = recordTender(setPart(first, 300), {
      method: "square" as const,
      amount: 300,
      received: 300,
      squareCheckoutId: "c-1",
      squarePaymentType: "CARD_PRESENT" as const,
    });
    expect(prepaidAmount(draft.split)).toBe(600);
    const refunded = removeTenders(
      draft,
      draft.split.tenders.map((t) => t.id),
      draft.split.subtotals.map((s) => s.id),
    );
    expect(refunded.step).toBe("entry");
    expect(refunded.split.subtotals).toEqual([]);
    expect(prepaidAmount(refunded.split)).toBe(0);
    expect(unpaidLines(refunded)).toHaveLength(2);
    expect(canEditLines(refunded)).toBe(true);
  });
});

describe("[unit] cashierSplit の送る注文", () => {
  test("支払いは小計の行を指し、小計の割引はその小計を払い終えた支払いに付ける", () => {
    const start = removeLine(withLines(blend, cookie, latte, pair), 1);
    const paying = setPart(beginRest(start, 1, 100), 600);
    const first = recordTender(paying, {
      method: "square",
      amount: 600,
      received: 600,
      squareCheckoutId: "c-1",
      squarePaymentType: "QR_CODE",
    });
    const second = recordTender(setPart(first, 500), cash(500, 1000));
    const done = recordTender(second, cash(800));
    expect(done.split.current).toBeNull();
    expect(splitPaymentsForOrder(done)).toEqual([
      {
        method: "square",
        amount: 600,
        received: 600,
        discount: 0,
        menuIndexes: [0, 1, 2],
        squareCheckoutId: "c-1",
      },
      {
        method: "cash",
        amount: 500,
        received: 1000,
        discount: 0,
        menuIndexes: [0, 1, 2],
      },
      {
        method: "cash",
        amount: 800,
        received: 800,
        discount: 100,
        menuIndexes: [0, 1, 2],
      },
    ]);
  });

  test("送る注文は、お預かりを合計にし、割引を小計で引いた分にそろえる", () => {
    const paying = beginRest(withLines(blend, latte), 1, 100);
    const first = recordTender(setPart(paying, 400), cash(400, 1000));
    const done = recordTender(first, cash(600));
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
    const whole = beginRest(withLines(blend, latte, cookie), 1, 100);
    const subtotal = currentSubtotal(whole);
    if (subtotal === null) throw new Error("no subtotal");
    const receiptOrder = subtotalOrder(order, whole, subtotal, 1500);
    expect(receiptOrder.orderId).toBe(42);
    expect(receiptOrder.menus.map((m) => m.id)).toEqual([
      "blend",
      "latte",
      "cookie",
    ]);
    expect(receiptOrder.billingAmount).toBe(1200);
    expect(receiptOrder.getCharge()).toBe(300);
    // 先払いが無ければそのまま
    expect(displayOrder(order, whole)).toBe(order);
    expect(displayOrder(order, setPart(whole, 300))).toBe(order);
    // 先払いがあれば、注文全体を受取金額なしで出す
    const partlyPaid = recordTender(setPart(whole, 300), cash(300));
    expect(displayOrder(order, partlyPaid).billingAmount).toBe(
      order.billingAmount,
    );
    expect(displayOrder(order, partlyPaid).received).toBe(0);
  });
});
