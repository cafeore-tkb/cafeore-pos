import { describe, expect, test } from "vitest";
import {
  checkMenuKey,
  isSameMenuKey,
  menuKeyChord,
  menuKeyError,
  menuKeyParts,
  normalizeMenuKey,
} from "./menuKey";

describe("[unit] menuKey", () => {
  test("+ でつないだキーを分け、+ そのものもキーにできる", () => {
    expect(menuKeyParts("^")).toEqual(["^"]);
    expect(menuKeyParts("F1")).toEqual(["F1"]);
    expect(menuKeyParts("a+s")).toEqual(["a", "s"]);
    expect(menuKeyParts("a+s+d")).toEqual(["a", "s", "d"]);
    expect(menuKeyParts("+")).toEqual(["+"]);
    expect(menuKeyParts("a++")).toEqual(["a", "+"]);
    expect(menuKeyParts("++a")).toEqual(["+", "a"]);
  });

  test("つなぎ方がおかしいときは分けない", () => {
    expect(menuKeyParts("")).toBeNull();
    expect(menuKeyParts("a+")).toBeNull();
    expect(menuKeyParts("+a")).toBeNull();
  });

  test("同時押しは 2 つ以上のときだけ", () => {
    expect(menuKeyChord("a")).toBeNull();
    expect(menuKeyChord("+")).toBeNull();
    expect(menuKeyChord("a+s")).toEqual(["a", "s"]);
  });

  test("同時押しは押す順に関わらず同じキー", () => {
    expect(isSameMenuKey("a+s", "s+a")).toBe(true);
    expect(isSameMenuKey("a+s", "a+s+d")).toBe(false);
    expect(isSameMenuKey("a", "a")).toBe(true);
    expect(isSameMenuKey("a", "a+s")).toBe(false);
    expect(isSameMenuKey("A", "a")).toBe(false);
  });

  test("同時押しの + のまわりの空白は消し、1 文字のキーはそのまま", () => {
    expect(normalizeMenuKey("a + s")).toBe("a+s");
    expect(normalizeMenuKey(" a+s ")).toBe("a+s");
    expect(normalizeMenuKey("+")).toBe("+");
    expect(normalizeMenuKey("^")).toBe("^");
  });

  test("同時押しに同じキー・数字や Enter など・修飾キーは使えない。1 つだけなら今までどおり", () => {
    expect(menuKeyError("a+s")).toBeNull();
    expect(menuKeyError("^")).toBeNull();
    expect(menuKeyError("1")).toBeNull();
    expect(menuKeyError("a+")).not.toBeNull();
    expect(menuKeyError("a+a")).not.toBeNull();
    expect(menuKeyError("a+1")).not.toBeNull();
    expect(menuKeyError("a+Enter")).not.toBeNull();
    expect(menuKeyError("a+Shift")).not.toBeNull();
  });
});

describe("[unit] checkMenuKey", () => {
  const otherMenus = [
    { name: "ブレンド", key: "a" },
    { name: "アイス", key: "s+d" },
  ];

  test("他のメニューで使っていなければ使える", () => {
    expect(checkMenuKey("q", otherMenus)).toEqual({ ok: true, warning: null });
    expect(checkMenuKey("a+q", otherMenus)).toEqual({
      ok: true,
      warning: null,
    });
  });

  test("他のメニューのキーは、同時押しの順が違っても使えない", () => {
    const check = checkMenuKey("d+s", otherMenus);
    expect(check.ok).toBe(false);
    expect(!check.ok && check.message).toContain("アイス");
    expect(checkMenuKey("a", otherMenus).ok).toBe(false);
  });

  test("同時押しに使えないキーは使えない", () => {
    expect(checkMenuKey("q+1", otherMenus).ok).toBe(false);
    expect(checkMenuKey("q+Enter", otherMenus).ok).toBe(false);
  });

  test("レジの操作に使うキーは 1 つだけなら使えるが、知らせる", () => {
    for (const key of ["1", "Enter", " ", "Backspace", "ArrowUp"]) {
      const check = checkMenuKey(key, otherMenus);
      expect(check.ok).toBe(true);
      expect(check.ok && check.warning).not.toBeNull();
    }
  });
});
