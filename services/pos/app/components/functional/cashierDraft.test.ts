import { type ItemType, MenuEntity, OrderEntity } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import {
  type CashierDraft,
  activeMenus,
  addLine,
  addReceived,
  assignLine,
  canAssignByDigit,
  cashierKeyIntent,
  cashierPaymentKeyIntent,
  clearDigits,
  couponStatus,
  cyclePayment,
  deleteDigit,
  emptyCashierDraft,
  focusCoupon,
  focusMemo,
  hasDraftInput,
  inputDigits,
  inputPadDigits,
  isAssigningByDigits,
  moveCursor,
  removeAllLines,
  removeLine,
  selectLine,
  setExactReceived,
  toggleSpecial,
} from "./cashierDraft";
import { beginRest } from "./cashierSplit";

/** 一括会計（割引なし）で会計の段階に進む */
const goPay = (draft: CashierDraft) => beginRest(draft, 0, 100);

const itemType = (name: string, needsBrew: boolean): ItemType => ({
  id: name,
  name,
  display_name: name,
  makes_cup: needsBrew,
  needs_brew: needsBrew,
  senior_only: false,
  iced_brew: false,
});

const menu = (id: string, key: string, type: ItemType) =>
  MenuEntity.fromMenu({
    id,
    name: id,
    abbr: id,
    price: 300,
    key,
    items: [{ item: { id, name: id, abbr: id, item_type: type }, quantity: 1 }],
    assignee: null,
  });

const blend = menu("blend", "^", itemType("brend", true));
const coaster = menu("coaster", ",", itemType("others", false));
const menus = [blend, coaster];
const payments = ["cash", "CARD_PRESENT", "FELICA_ALL", "QR_CODE"] as const;

const withLines = (...items: (typeof blend)[]): CashierDraft =>
  items.reduce(addLine, emptyCashierDraft());

// 過去の注文は、提供済みの No.42 だけ（042 は割引でき、ほかの 3 桁は割引できない）
const orders = [
  OrderEntity.fromOrder({
    ...OrderEntity.createNew({ orderId: 42 }).toOrder(),
    id: "order-42",
    servedAt: new Date("2026-11-07T10:23:45+09:00"),
  }),
];
const checkCoupon = (coupon: string) => couponStatus(coupon, orders);

const keys = (draft: CashierDraft, ...pressed: string[]) =>
  pressed.reduce((current, key) => {
    const intent = cashierKeyIntent(current, key, {
      menus,
      payments,
      checkCoupon,
    });
    return intent.type === "update" ? intent.draft : current;
  }, draft);

describe("[unit] cashierDraft の商品", () => {
  test("削除した行は一覧から消し、送る商品からも外す。次の行を選ぶ", () => {
    const draft = removeLine(withLines(blend, coaster, blend), 1);
    expect(activeMenus(draft)).toEqual([blend, blend]);
    expect(draft.selected).toBe(1);
    expect(removeLine(withLines(blend, coaster), 0).selected).toBe(0);
  });

  test("一番下の行を削除したら、行を選ばず引換券番号の欄に移る", () => {
    const last = removeLine(withLines(blend, coaster), 1);
    expect(activeMenus(last)).toEqual([blend]);
    expect(last.selected).toBeNull();
    expect(last.zone).toBe("coupon");
    const only = removeLine(withLines(blend), 0);
    expect(only.lines).toEqual([]);
    expect(only.selected).toBeNull();
    expect(only.zone).toBe("coupon");
  });

  test("全削除はすべての行を消す", () => {
    const draft = removeAllLines(withLines(blend, coaster));
    expect(draft.lines).toEqual([]);
    expect(activeMenus(draft)).toEqual([]);
  });

  test("会計の段階では商品を足さず、削除・選択・指名もしない（会計取消で戻ってから変える）", () => {
    const draft = goPay(withLines(blend));
    expect(addLine(draft, coaster)).toBe(draft);
    expect(removeLine(draft, 0)).toBe(draft);
    expect(removeAllLines(draft)).toBe(draft);
    expect(selectLine(draft, 0)).toBe(draft);
    expect(assignLine(draft, 0, 1, "たなか")).toBe(draft);
  });

  test("足した行を選ぶ。同じ行を選び直すと選択を外す", () => {
    const draft = withLines(blend, coaster);
    expect(draft.selected).toBe(1);
    expect(selectLine(draft, 1).selected).toBeNull();
    expect(selectLine(draft, 0).selected).toBe(0);
  });

  test("指名は番号が無ければ自由記述も消す", () => {
    const draft = withLines(blend);
    const assigned = assignLine(draft, 0, 2, " たなか ");
    expect(assigned.lines[0].menu.dripper).toBe(2);
    expect(assigned.lines[0].menu.assignee).toBe("たなか");
    expect(draft.lines[0].menu.dripper).toBeNull();
    const cleared = assignLine(assigned, 0, null, "たなか");
    expect(cleared.lines[0].menu.dripper).toBeNull();
    expect(cleared.lines[0].menu.assignee).toBeNull();
  });

  test("↑↓ は 商品 → 割引 → 備考 の順に動く", () => {
    // 足した最後の行（1）を選んでいる
    const draft = withLines(blend, coaster);
    const up = moveCursor(draft, -1);
    expect(up.selected).toBe(0);
    expect(moveCursor(up, -1).selected).toBe(0);
    const down = moveCursor(draft, 1);
    expect(down.selected).toBeNull();
    expect(down.zone).toBe("coupon");
    expect(moveCursor(down, 1).zone).toBe("memo");
    expect(moveCursor(moveCursor(down, 1), -1).zone).toBe("coupon");
    expect(moveCursor(down, -1).selected).toBe(1);
  });
});

describe("[unit] cashierDraft の数字", () => {
  test("入れる段階は引換券番号に 3 桁まで入れ、3 桁そろったら備考に移る", () => {
    const partial = inputDigits(withLines(blend), "04");
    expect(partial.zone).toBe("coupon");
    const draft = inputDigits(partial, "29");
    expect(draft.coupon).toBe("042");
    expect(draft.zone).toBe("memo");
    // 備考に移ってからも、消すと引換券番号の欄に戻る
    const deleted = deleteDigit(draft);
    expect(deleted.coupon).toBe("04");
    expect(deleted.zone).toBe("coupon");
    expect(clearDigits(draft).coupon).toBe("");
  });

  test("3 桁で割引できなければ引換券番号の欄に残り、次の数字で消して 1 桁目から打ち直す", () => {
    const rejected = inputDigits(withLines(blend), "123", checkCoupon);
    expect(rejected.coupon).toBe("123");
    expect(rejected.zone).toBe("coupon");
    const retyped = inputDigits(rejected, "0", checkCoupon);
    expect(retyped.coupon).toBe("0");
    expect(retyped.zone).toBe("coupon");
    const applied = inputDigits(retyped, "42", checkCoupon);
    expect(applied.coupon).toBe("042");
    expect(applied.zone).toBe("memo");
    // 割引できている 3 桁は、数字を打っても変えない
    expect(inputDigits(applied, "9", checkCoupon).coupon).toBe("042");
  });

  test("割引できない 3 桁のまま備考に移っても、数字を打てば引換券番号の欄に戻って打ち直す", () => {
    const onMemo = focusMemo(inputDigits(withLines(blend), "123", checkCoupon));
    const retyped = inputDigits(onMemo, "4", checkCoupon);
    expect(retyped.coupon).toBe("4");
    expect(retyped.zone).toBe("coupon");
  });

  test("行・備考を選んでいても、数字は引換券番号に入れ、引換券番号の欄に移る", () => {
    const onLine = inputDigits(withLines(blend), "1");
    expect(onLine.coupon).toBe("1");
    expect(onLine.selected).toBeNull();
    expect(onLine.zone).toBe("coupon");
    const onMemo = inputDigits(focusMemo(withLines(blend)), "1");
    expect(onMemo.coupon).toBe("1");
    expect(onMemo.zone).toBe("coupon");
    expect(deleteDigit(withLines(blend)).selected).toBeNull();
  });

  test("テンキーの数字は、キーボードの数字と同じく行を選んでいれば指名し、行は選んだまま", () => {
    const draft = withLines(blend);
    const second = inputPadDigits(draft, "2", checkCoupon);
    expect(second.lines[0].menu.dripper).toBe(2);
    expect(second.selected).toBe(0);
    expect(second.coupon).toBe("");
    expect(inputPadDigits(second, "0").lines[0].menu.dripper).toBeNull();
    // 7〜9・00 では指名せず、引換券番号にも入れない
    expect(inputPadDigits(draft, "7")).toBe(draft);
    expect(inputPadDigits(draft, "00")).toBe(draft);
    expect(canAssignByDigit(draft, "6")).toBe(true);
    expect(canAssignByDigit(draft, "0")).toBe(true);
    expect(canAssignByDigit(draft, "7")).toBe(false);
    expect(canAssignByDigit(draft, "00")).toBe(false);
  });

  test("テンキーの数字は、指名できない行を選んでいれば何もせず、行を選んでいなければ引換券番号に入れる", () => {
    const onCoaster = withLines(coaster);
    expect(isAssigningByDigits(onCoaster)).toBe(true);
    expect(canAssignByDigit(onCoaster, "1")).toBe(false);
    expect(inputPadDigits(onCoaster, "1")).toBe(onCoaster);
    const onCoupon = focusCoupon(withLines(blend));
    expect(isAssigningByDigits(onCoupon)).toBe(false);
    expect(inputPadDigits(onCoupon, "1").coupon).toBe("1");
  });

  test("特殊な割引のときも、行を選べばテンキーの数字で指名できる", () => {
    const special = selectLine(toggleSpecial(withLines(blend), false), 0);
    expect(inputPadDigits(special, "3").lines[0].menu.dripper).toBe(3);
  });

  test("会計の段階では、テンキーの数字は受取金額に入れる", () => {
    const draft = goPay(withLines(blend));
    expect(isAssigningByDigits(draft)).toBe(false);
    expect(inputPadDigits(draft, "00").received).toBe("");
    expect(inputPadDigits(draft, "5").received).toBe("5");
  });

  test("特殊な割引のときは、引換券番号を打てない", () => {
    const special = toggleSpecial(withLines(blend), false);
    expect(inputDigits(special, "1").coupon).toBe("");
  });

  test("特殊な割引を付けたら備考に、外したら引換券番号の欄に移る", () => {
    const special = toggleSpecial(withLines(blend), false);
    expect(special.selected).toBeNull();
    expect(special.zone).toBe("memo");
    expect(toggleSpecial(special, false).zone).toBe("coupon");
  });

  test("引換券で割引できているときは特殊な割引を付けない。付けると引換券番号を消す", () => {
    const draft = inputDigits(withLines(blend), "042");
    expect(toggleSpecial(draft, true)).toBe(draft);
    const special = toggleSpecial(draft, false);
    expect(special.special).toBe(true);
    expect(special.coupon).toBe("");
  });

  test("会計の段階は受取金額に入れ、先頭の 0 は落とし、7 桁目は入れない", () => {
    const draft = goPay(withLines(blend));
    expect(inputDigits(draft, "0").received).toBe("");
    const received = inputDigits(inputDigits(draft, "1"), "00");
    expect(received.received).toBe("100");
    expect(inputDigits(inputDigits(received, "000"), "0").received).toBe(
      "100000",
    );
  });

  test("数字を打つと決済手段は現金に戻る", () => {
    const draft = { ...goPay(withLines(blend)), payment: "QR_CODE" as const };
    expect(inputDigits(draft, "5").payment).toBe("cash");
  });

  test("+1千 などは足し、ちょうどは請求額にする", () => {
    const draft = goPay(withLines(blend));
    expect(addReceived(addReceived(draft, 1000), 5000).received).toBe("6000");
    expect(addReceived(draft, 2_000_000).received).toBe("999999");
    expect(setExactReceived(draft, 600).received).toBe("600");
    expect(addReceived(withLines(blend), 1000).received).toBe("");
  });
});

describe("[unit] hasDraftInput", () => {
  test("商品を全部削除したら、消しても失うものは無い", () => {
    expect(hasDraftInput(emptyCashierDraft())).toBe(false);
    expect(hasDraftInput(removeAllLines(withLines(blend)))).toBe(false);
    expect(hasDraftInput(withLines(blend))).toBe(true);
  });

  test("引換券番号・特記事項・受取金額だけでも失うものがある", () => {
    const draft = emptyCashierDraft();
    expect(hasDraftInput({ ...draft, coupon: "1" })).toBe(true);
    expect(hasDraftInput({ ...draft, special: true })).toBe(true);
    expect(hasDraftInput({ ...draft, memo: "氷少なめ" })).toBe(true);
    expect(hasDraftInput({ ...draft, received: "1000" })).toBe(true);
  });
});

describe("[unit] cashierDraft の段階", () => {
  test("商品が無ければ一括会計に進まない（全部削除したときも進まない）", () => {
    expect(goPay(emptyCashierDraft()).step).toBe("entry");
    expect(goPay(removeLine(withLines(blend), 0)).step).toBe("entry");
    expect(goPay(withLines(blend)).step).toBe("pay");
  });

  test("決済手段は ↑↓ で一周する", () => {
    const draft = goPay(withLines(blend));
    expect(cyclePayment(draft, payments, -1).payment).toBe("QR_CODE");
    expect(cyclePayment(draft, payments, 1).payment).toBe("CARD_PRESENT");
    expect(cyclePayment(draft, ["cash"], 1).payment).toBe("cash");
  });
});

describe("[unit] cashierKeyIntent", () => {
  test("商品キーで足し、Enter で一括会計する", () => {
    const draft = keys(emptyCashierDraft(), "^", "^", ",");
    expect(activeMenus(draft)).toEqual([blend, blend, coaster]);
    expect(cashierKeyIntent(draft, "Enter", { menus, payments }).type).toBe(
      "goPay",
    );
    expect(
      cashierKeyIntent(removeAllLines(draft), "Enter", { menus, payments })
        .type,
    ).toBe("none");
  });

  test("入れる段階の → は一括会計する（商品が無ければ何もしない）。会計の段階では何もしない", () => {
    const draft = keys(emptyCashierDraft(), "^");
    expect(
      cashierKeyIntent(draft, "ArrowRight", { menus, payments }).type,
    ).toBe("goPay");
    expect(
      cashierKeyIntent(emptyCashierDraft(), "ArrowRight", { menus, payments })
        .type,
    ).toBe("none");
    expect(
      cashierKeyIntent(goPay(draft), "ArrowRight", { menus, payments }).type,
    ).toBe("none");
  });

  test("商品キーで足すと足した行を選び、続けて Space で指名できる", () => {
    const draft = keys(emptyCashierDraft(), "^");
    expect(draft.selected).toBe(0);
    expect(cashierKeyIntent(draft, " ", { menus, payments }).type).toBe(
      "openAssign",
    );
  });

  test("Backspace は選んでいる行を削除し、選んでいなければ 1 桁消す", () => {
    // 足した最後の行を選んでいるので、そのまま Backspace で消せる
    const removed = keys(withLines(blend, coaster), "Backspace");
    expect(activeMenus(removed)).toEqual([blend]);
    expect(removed.selected).toBeNull();
    const onCoupon = focusCoupon(withLines(blend));
    expect(keys(onCoupon, "1", "2", "Backspace").coupon).toBe("1");
  });

  test("Backspace で行を削除すると次の行を選ぶので、続けて Backspace で消せる", () => {
    const draft = selectLine(withLines(blend, coaster, blend), 0);
    const once = keys(draft, "Backspace");
    expect(activeMenus(once)).toEqual([coaster, blend]);
    expect(once.selected).toBe(0);
    const twice = keys(once, "Backspace");
    expect(activeMenus(twice)).toEqual([blend]);
    expect(twice.selected).toBe(0);
  });

  test("Backspace を押したままの繰り返しでは行を消さない。行を選んでいなければ 1 桁消す", () => {
    const draft = selectLine(withLines(blend, coaster), 0);
    expect(
      cashierKeyIntent(draft, "Backspace", { menus, payments, repeat: true })
        .type,
    ).toBe("none");
    const onCoupon = inputDigits(focusCoupon(withLines(blend)), "12");
    const intent = cashierKeyIntent(onCoupon, "Backspace", {
      menus,
      payments,
      repeat: true,
    });
    expect(intent.type === "update" && intent.draft.coupon).toBe("1");
  });

  test("数字のキーも、割引できない 3 桁なら備考に移らず、次の数字で打ち直す", () => {
    const rejected = keys(focusCoupon(withLines(blend)), "1", "2", "3");
    expect(rejected.coupon).toBe("123");
    expect(rejected.zone).toBe("coupon");
    const applied = keys(rejected, "0", "4", "2");
    expect(applied.coupon).toBe("042");
    expect(applied.zone).toBe("memo");
  });

  test("行を選んでいる間の数字は指名（1〜6 は 1st〜6th、0 は指名なし）で、行は選んだまま", () => {
    const draft = withLines(blend);
    const second = keys(draft, "2");
    expect(second.lines[0].menu.dripper).toBe(2);
    expect(second.selected).toBe(0);
    expect(second.coupon).toBe("");
    expect(keys(second, "0").lines[0].menu.dripper).toBeNull();
    expect(cashierKeyIntent(draft, "7", { menus, payments }).type).toBe("none");
  });

  test("数字の指名では自由記述を残し、指名なしにしたら消す", () => {
    const assigned = selectLine(
      assignLine(withLines(blend), 0, 1, "たなか"),
      0,
    );
    const third = keys(assigned, "3");
    expect(third.lines[0].menu.dripper).toBe(3);
    expect(third.lines[0].menu.assignee).toBe("たなか");
    expect(keys(third, "0").lines[0].menu.assignee).toBeNull();
  });

  test("指名できない行を選んでいるときの数字は何もしない", () => {
    const draft = withLines(coaster);
    expect(cashierKeyIntent(draft, "1", { menus, payments }).type).toBe("none");
  });

  test("Space は指名できる行を選んでいるときだけ指名を開く", () => {
    // 足した最後の行（コースター）を選んでいる
    const onCoaster = withLines(blend, coaster);
    const onBlend = selectLine(onCoaster, 0);
    expect(cashierKeyIntent(onBlend, " ", { menus, payments }).type).toBe(
      "openAssign",
    );
    expect(cashierKeyIntent(onCoaster, " ", { menus, payments }).type).toBe(
      "none",
    );
  });

  test("備考を選んでいるときの Space は備考を開き、Enter は一括会計する", () => {
    // 足した行 → 割引 → 備考
    const draft = keys(withLines(blend), "ArrowDown", "ArrowDown");
    expect(cashierKeyIntent(draft, " ", { menus, payments }).type).toBe(
      "openMemo",
    );
    expect(cashierKeyIntent(draft, "Enter", { menus, payments }).type).toBe(
      "goPay",
    );
  });

  test("会計の段階の Enter は、現金なら確定し、Square なら決済を始める", () => {
    const draft = goPay(withLines(blend));
    expect(
      cashierKeyIntent(inputDigits(draft, "500"), "Enter", {
        menus,
        payments,
      }),
    ).toEqual({ type: "submitCash" });
    const card = keys(draft, "ArrowDown");
    expect(cashierKeyIntent(card, "Enter", { menus, payments })).toEqual({
      type: "startSquare",
      paymentType: "CARD_PRESENT",
    });
  });

  test("現金で受取金額が空なら、Enter はちょうどにする", () => {
    const draft = goPay(withLines(blend));
    expect(cashierKeyIntent(draft, "Enter", { menus, payments })).toEqual({
      type: "exactReceived",
    });
  });

  test("会計の段階では商品キーで足さない", () => {
    const draft = goPay(withLines(blend));
    expect(cashierKeyIntent(draft, "^", { menus, payments }).type).toBe("none");
  });

  test("Esc は入れる段階なら消し、会計の段階なら会計をやめる。扱わないキーはそのまま", () => {
    const draft = withLines(blend);
    expect(cashierKeyIntent(draft, "Escape", { menus, payments }).type).toBe(
      "reset",
    );
    expect(
      cashierKeyIntent(goPay(draft), "Escape", { menus, payments }).type,
    ).toBe("leavePay");
    expect(cashierKeyIntent(draft, "a", { menus, payments }).type).toBe(
      "ignore",
    );
  });
});

describe("[unit] cashierPaymentKeyIntent", () => {
  test("入れる段階は一括会計に進み、進んだらその決済手段を選ぶ（Alt+T・Q は決済を始める）", () => {
    const draft = withLines(blend);
    expect(cashierPaymentKeyIntent(draft, "KeyC", { payments })).toEqual({
      type: "goPay",
      payment: "cash",
    });
    expect(cashierPaymentKeyIntent(draft, "KeyT", { payments })).toEqual({
      type: "goPay",
      payment: "CARD_PRESENT",
    });
    expect(cashierPaymentKeyIntent(draft, "KeyQ", { payments })).toEqual({
      type: "goPay",
      payment: "QR_CODE",
    });
  });

  test("商品が無ければ何もしない", () => {
    expect(
      cashierPaymentKeyIntent(emptyCashierDraft(), "KeyT", { payments }).type,
    ).toBe("none");
  });

  test("会計の段階の Alt+C は現金を選ぶだけ、Alt+T・Q は決済を始める", () => {
    const draft = { ...goPay(withLines(blend)), payment: "QR_CODE" as const };
    const cash = cashierPaymentKeyIntent(draft, "KeyC", { payments });
    expect(cash.type === "update" && cash.draft.payment).toBe("cash");
    expect(cashierPaymentKeyIntent(draft, "KeyT", { payments })).toEqual({
      type: "startSquare",
      paymentType: "CARD_PRESENT",
    });
  });

  test("今使えない Square の決済手段は知らせ、決済手段のキーでなければ扱わない", () => {
    const draft = goPay(withLines(blend));
    expect(
      cashierPaymentKeyIntent(draft, "KeyQ", { payments: ["cash"] }),
    ).toEqual({ type: "paymentUnavailable", paymentType: "QR_CODE" });
    expect(cashierPaymentKeyIntent(draft, "KeyX", { payments }).type).toBe(
      "ignore",
    );
  });

  test("押しっぱなしの繰り返し（repeat）は、どの段階でも決済を始めない", () => {
    const repeat = { payments, repeat: true };
    const entry = withLines(blend);
    const pay = goPay(entry);
    for (const code of ["KeyC", "KeyT", "KeyQ"]) {
      expect(cashierPaymentKeyIntent(entry, code, repeat).type).toBe("none");
      expect(cashierPaymentKeyIntent(pay, code, repeat).type).toBe("none");
    }
    // 決済手段のキーでなければ、今までどおり扱わない
    expect(cashierPaymentKeyIntent(pay, "KeyX", repeat).type).toBe("ignore");
  });
});
