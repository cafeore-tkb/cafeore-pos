import { type ItemType, MenuEntity, OrderEntity } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import {
  type CashierDraft,
  addLine,
  canEditLines,
  cashierKeyIntent,
  emptyCashierDraft,
  goPay,
  inputDigits,
  toggleSpecial,
  toggleVoid,
} from "./cashierDraft";
import {
  allocateDiscount,
  canStartSplit,
  cancelSplit,
  pickAllSplitLines,
  preferDiscount,
  recordSplitPayment,
  splitBill,
  splitLowerLines,
  splitOrderForSubmit,
  splitPaidLines,
  splitPaymentOrder,
  splitPaymentsForOrder,
  splitUpperLines,
  startSplit,
  toggleSplitLine,
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
const menu = (id: string, price: number, coffees: number, key = id) =>
  MenuEntity.fromMenu({
    id,
    name: id,
    abbr: id,
    price,
    key,
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
const menus = [blend, latte, pair, cookie];
const payments = ["cash", "CARD_PRESENT"] as const;

const withLines = (...items: (typeof blend)[]): CashierDraft =>
  items.reduce(addLine, emptyCashierDraft());

const keys = (draft: CashierDraft, ...pressed: string[]) =>
  pressed.reduce((current, key) => {
    const intent = cashierKeyIntent(current, key, { menus, payments });
    return intent.type === "update" ? intent.draft : current;
  }, draft);

const cash = (amount: number, received = amount) => ({
  method: "cash" as const,
  amount,
  received,
  discountCups: 0,
  discount: 0,
});

describe("[unit] cashierSplit の上下の枠", () => {
  test("始めると商品は全部上の枠に出て、先頭を選ぶ。2 点より少なければ始めない", () => {
    expect(canStartSplit(withLines(blend))).toBe(false);
    expect(canStartSplit(toggleVoid(withLines(blend, latte), 0))).toBe(false);
    const draft = startSplit(withLines(blend, latte, cookie));
    expect(splitUpperLines(draft).map((line) => line.menu.id)).toEqual([
      "blend",
      "latte",
      "cookie",
    ]);
    expect(splitLowerLines(draft)).toEqual([]);
    expect(draft.split?.cursor).toBe(draft.lines[0].key);
    // 個別会計の間は商品を変えない
    expect(canEditLines(draft)).toBe(false);
    expect(addLine(draft, blend)).toBe(draft);
  });

  test("押した行を下の枠に入れ（入れた順）、もう一度押すと上に戻す", () => {
    const start = startSplit(withLines(blend, latte, cookie));
    const [b, l, c] = start.lines.map((line) => line.key);
    const draft = toggleSplitLine(toggleSplitLine(start, c), b);
    expect(splitLowerLines(draft).map((line) => line.key)).toEqual([c, b]);
    expect(splitUpperLines(draft).map((line) => line.key)).toEqual([l]);
    expect(
      splitUpperLines(toggleSplitLine(draft, c)).map((line) => line.key),
    ).toEqual([l, c]);
    expect(
      splitLowerLines(pickAllSplitLines(draft)).map((line) => line.key),
    ).toEqual([c, b, l]);
  });

  test("↑↓ で上の枠、続けて下の枠の行を選び、Space で上下を動かし、Enter で下の枠を会計する", () => {
    const start = startSplit(withLines(blend, latte, cookie));
    const [b, l, c] = start.lines.map((line) => line.key);
    // 下の枠が空なら Enter では進まない
    expect(cashierKeyIntent(start, "Enter", { menus, payments }).type).toBe(
      "none",
    );
    const draft = keys(start, "ArrowDown", " ", "ArrowDown");
    expect(splitLowerLines(draft).map((line) => line.key)).toEqual([l]);
    // 上の枠（blend, cookie）、続けて下の枠（latte）の順に動く
    expect(draft.split?.cursor).toBe(l);
    expect(keys(draft, "ArrowUp").split?.cursor).toBe(c);
    expect(keys(draft, "ArrowUp", "ArrowUp", "ArrowUp").split?.cursor).toBe(b);
    expect(cashierKeyIntent(draft, "Enter", { menus, payments }).type).toBe(
      "goPay",
    );
    expect(goPay(draft).step).toBe("pay");
    // 商品キーでは足さない
    expect(keys(draft, "blend").lines).toHaveLength(3);
  });

  test("払い始めるまではやめられる。払ったらやめられない", () => {
    const draft = toggleSplitLine(startSplit(withLines(blend, latte)), 0);
    expect(cancelSplit(draft).split).toBeNull();
    const paid = recordSplitPayment(goPay(draft), cash(500));
    expect(cancelSplit(paid)).toBe(paid);
  });
});

describe("[unit] cashierSplit の会計", () => {
  test("払い終えた行は上下の枠から外れ、受取金額を空にして選ぶ段階に戻る", () => {
    const start = startSplit(withLines(blend, latte, cookie));
    const [b, l, c] = start.lines.map((line) => line.key);
    const paying = { ...goPay(toggleSplitLine(start, l)), received: "1000" };
    const paid = recordSplitPayment(paying, cash(600, 1000));
    expect(paid.step).toBe("entry");
    expect(paid.received).toBe("");
    expect(paid.split?.payments).toEqual([
      { ...cash(600, 1000), lineKeys: [l] },
    ]);
    expect(splitPaidLines(paid).map((line) => line.key)).toEqual([l]);
    expect(splitUpperLines(paid).map((line) => line.key)).toEqual([b, c]);
    expect(splitLowerLines(paid)).toEqual([]);
    expect(paid.split?.cursor).toBe(b);
    // 払った行は下の枠に入れられない
    expect(toggleSplitLine(paid, l)).toBe(paid);
  });

  test("残りを全部下の枠に入れたら最後の会計。先に払った額も分かる", () => {
    const start = startSplit(withLines(blend, latte, cookie));
    const [b, l, c] = start.lines.map((line) => line.key);
    const first = recordSplitPayment(
      goPay(toggleSplitLine(start, l)),
      cash(600),
    );
    expect(splitBill(toggleSplitLine(first, b), 0, 100)).toMatchObject({
      total: 500,
      amount: 500,
      last: false,
      paidAmount: 600,
    });
    const last = splitBill(pickAllSplitLines(first), 0, 100);
    expect(last.lines.map((line) => line.key)).toEqual([b, c]);
    expect(last).toMatchObject({ total: 700, amount: 700, last: true });
  });

  test("注文に付ける支払いは、削除していない行の並びの位置で行を指す", () => {
    const lines = toggleVoid(withLines(blend, cookie, latte, pair), 1);
    const start = startSplit(lines);
    const [b, , l, p] = start.lines.map((line) => line.key);
    const first = recordSplitPayment(goPay(toggleSplitLine(start, l)), {
      ...cash(600, 1000),
    });
    const second = recordSplitPayment(
      goPay(toggleSplitLine(toggleSplitLine(first, p), b)),
      {
        method: "square",
        amount: 1300,
        received: 1300,
        discountCups: 1,
        discount: 100,
        squareCheckoutId: "checkout-1",
        squarePaymentType: "CARD_PRESENT",
      },
    );
    expect(splitPaymentsForOrder(second)).toEqual([
      {
        method: "cash",
        amount: 600,
        received: 1000,
        discount: 0,
        menuIndexes: [1],
      },
      {
        method: "square",
        amount: 1300,
        received: 1300,
        discount: 100,
        menuIndexes: [2, 0],
        squareCheckoutId: "checkout-1",
      },
    ]);
  });
});

describe("[unit] cashierSplit の割引", () => {
  test("既定では並び順のコーヒーに 1 杯ずつ割り振り、グッズには振らない", () => {
    const draft = startSplit(withLines(cookie, pair, blend));
    const [c, p, b] = draft.lines.map((line) => line.key);
    expect([...allocateDiscount(draft, 1)]).toEqual([[p, 1]]);
    expect([...allocateDiscount(draft, 3)]).toEqual([
      [p, 2],
      [b, 1],
    ]);
    // 割引の対象より多くは振らない
    expect([...allocateDiscount(draft, 5)]).toEqual([
      [p, 2],
      [b, 1],
    ]);
    expect(allocateDiscount(draft, 0).size).toBe(0);
    expect(allocateDiscount(draft, 1).has(c)).toBe(false);
  });

  test("「割引をここに」で付ける行を選び直せる。割引はその行を含む会計で引く", () => {
    const start = startSplit(withLines(blend, latte, cookie));
    const [b, l] = start.lines.map((line) => line.key);
    expect([...allocateDiscount(start, 1)]).toEqual([[b, 1]]);
    const moved = preferDiscount(start, l);
    expect([...allocateDiscount(moved, 1)]).toEqual([[l, 1]]);
    // latte だけの会計に割引が付き、blend だけの会計には付かない
    expect(splitBill(toggleSplitLine(moved, l), 1, 100)).toMatchObject({
      total: 600,
      discountCups: 1,
      discount: 100,
      amount: 500,
    });
    expect(splitBill(toggleSplitLine(moved, b), 1, 100)).toMatchObject({
      total: 500,
      discount: 0,
      amount: 500,
    });
    // 戻すと並び順に戻る
    expect([...allocateDiscount(preferDiscount(moved, b), 1)]).toEqual([
      [b, 1],
    ]);
  });

  test("払い終えた会計で引いた杯数を除いて、残りの行に割り振る", () => {
    const start = startSplit(withLines(blend, latte, pair));
    const [b, l, p] = start.lines.map((line) => line.key);
    // 2 杯分の割引のうち、1 杯を blend の会計で引いた
    const paid = recordSplitPayment(goPay(toggleSplitLine(start, b)), {
      ...cash(400),
      discountCups: 1,
      discount: 100,
    });
    expect([...allocateDiscount(paid, 2)]).toEqual([[l, 1]]);
    expect([...allocateDiscount(preferDiscount(paid, p), 2)]).toEqual([[p, 1]]);
  });

  test("払い始めたら引換券番号・特殊な割引は変えない", () => {
    const start = startSplit(withLines(blend, latte));
    // 払う前は打てる
    expect(inputDigits(start, "1").coupon).toBe("1");
    expect(keys(start, "4", "2").coupon).toBe("42");
    const paid = recordSplitPayment(
      goPay(toggleSplitLine(start, 0)),
      cash(500),
    );
    expect(inputDigits(paid, "1")).toBe(paid);
    expect(toggleSpecial(paid, false)).toBe(paid);
  });

  test("下の枠だけの注文を作る（割引は下の枠に割り振った分、お預かりは受取金額）", () => {
    const order = OrderEntity.createNew({ orderId: 42 });
    order.menus = [blend, latte, cookie];
    order.applyDiscount(
      (() => {
        const previous = OrderEntity.createNew({ orderId: 7 });
        previous.menus = [pair];
        return previous;
      })(),
    );
    expect(order.discount).toBe(200);
    const start = startSplit(withLines(blend, latte, cookie));
    const [, l, c] = start.lines.map((line) => line.key);
    const draft = {
      ...goPay(toggleSplitLine(toggleSplitLine(start, l), c)),
      received: "1000",
    };
    const payment = splitPaymentOrder(order, draft);
    expect(payment.orderId).toBe(42);
    expect(payment.discountOrderId).toBe(7);
    expect(payment.menus.map((m) => m.id)).toEqual(["latte", "cookie"]);
    expect(payment.total).toBe(800);
    // 2 杯分の割引は blend・latte に 1 杯ずつ。この会計は latte の 1 杯分
    expect(payment.discount).toBe(100);
    expect(payment.billingAmount).toBe(700);
    expect(payment.getCharge()).toBe(300);
    expect(payment.payments).toEqual([]);
  });

  test("送る注文は、払った分を payments に、お預かりをその合計にし、割引を払った分にそろえる", () => {
    const start = startSplit(withLines(blend, latte));
    const [b, l] = start.lines.map((line) => line.key);
    const first = recordSplitPayment(goPay(toggleSplitLine(start, b)), {
      ...cash(400, 1000),
      discountCups: 1,
      discount: 100,
    });
    const done = recordSplitPayment(
      goPay(toggleSplitLine(first, l)),
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
    // 払い始めてから割引が外れても、払った分の割引で送る
    order.removeDiscount();
    expect(splitOrderForSubmit(order, done).billingAmount).toBe(1000);
  });
});
