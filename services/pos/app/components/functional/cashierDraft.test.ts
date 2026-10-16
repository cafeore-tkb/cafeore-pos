import { type ItemType, MenuEntity } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import {
  type CashierDraft,
  activeMenus,
  addLine,
  addReceived,
  assignLine,
  cashierKeyIntent,
  clearDigits,
  cyclePayment,
  deleteDigit,
  emptyCashierDraft,
  focusCoupon,
  focusMemo,
  goPay,
  hasDraftInput,
  inputDigits,
  moveCursor,
  selectLine,
  setExactReceived,
  toggleSpecial,
  toggleVoid,
  voidAll,
} from "./cashierDraft";

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

const keys = (draft: CashierDraft, ...pressed: string[]) =>
  pressed.reduce((current, key) => {
    const intent = cashierKeyIntent(current, key, { menus, payments });
    return intent.type === "update" ? intent.draft : current;
  }, draft);

describe("[unit] cashierDraft の商品", () => {
  test("削除した行は一覧に残し、送る商品からは外す。もう一度で戻す", () => {
    const draft = toggleVoid(withLines(blend, coaster), 0);
    expect(draft.lines).toHaveLength(2);
    expect(draft.lines[0].voided).toBe(true);
    expect(activeMenus(draft)).toEqual([coaster]);
    expect(activeMenus(toggleVoid(draft, 0))).toEqual([blend, coaster]);
  });

  test("全削除はすべての行を削除する", () => {
    const draft = voidAll(withLines(blend, coaster));
    expect(activeMenus(draft)).toEqual([]);
    expect(draft.lines.every((line) => line.voided)).toBe(true);
  });

  test("会計の段階では商品を足さず、削除・選択・指名もしない（シールを先に刷っている）", () => {
    const draft = goPay(withLines(blend));
    expect(addLine(draft, coaster)).toBe(draft);
    expect(toggleVoid(draft, 0)).toBe(draft);
    expect(voidAll(draft)).toBe(draft);
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
  test("削除した商品しか無ければ、消しても失うものは無い", () => {
    expect(hasDraftInput(emptyCashierDraft())).toBe(false);
    expect(hasDraftInput(voidAll(withLines(blend)))).toBe(false);
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
  test("商品が無ければ一括会計に進まない（削除した行だけでも進まない）", () => {
    expect(goPay(emptyCashierDraft()).step).toBe("entry");
    expect(goPay(toggleVoid(withLines(blend), 0)).step).toBe("entry");
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
      cashierKeyIntent(voidAll(draft), "Enter", { menus, payments }).type,
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
    const voided = keys(withLines(blend, coaster), "Backspace");
    expect(voided.lines[1].voided).toBe(true);
    expect(voided.selected).toBeNull();
    const onCoupon = focusCoupon(withLines(blend));
    expect(keys(onCoupon, "1", "2", "Backspace").coupon).toBe("1");
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

  test("Esc は消す。扱わないキーはそのまま", () => {
    const draft = withLines(blend);
    expect(cashierKeyIntent(draft, "Escape", { menus, payments }).type).toBe(
      "reset",
    );
    expect(cashierKeyIntent(draft, "a", { menus, payments }).type).toBe(
      "ignore",
    );
  });
});
