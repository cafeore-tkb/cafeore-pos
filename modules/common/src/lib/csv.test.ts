import { describe, expect, test } from "vitest";
import { decodeText, formatCsv, parseCsv } from "./csv";

const utf8 = (text: string) => new TextEncoder().encode(text);

// 「ホット」を Shift_JIS にしたもの。Excel の「CSV (コンマ区切り)」はこの形で保存される。
const HOT_SJIS = [0x83, 0x7a, 0x83, 0x62, 0x83, 0x67];
const sjis = (prefix: string, suffix: string) =>
  new Uint8Array([...utf8(prefix), ...HOT_SJIS, ...utf8(suffix)]);

describe("[unit] parseCsv", () => {
  test("quoted fields keep commas, quotes and newlines", () => {
    expect(parseCsv('a,"b,c","d""e"\r\n"f\ng",h\n')).toEqual([
      ["a", "b,c", 'd"e'],
      ["f\ng", "h"],
    ]);
  });

  test("last line without newline is kept", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

describe("[unit] decodeText", () => {
  test("reads UTF-8 with BOM", () => {
    expect(decodeText(utf8("﻿name,display_name"))).toBe("name,display_name");
  });

  test("falls back to Shift_JIS for Excel CSV", () => {
    expect(decodeText(sjis("hot,", "\r\n"))).toBe("hot,ホット\r\n");
  });
});

describe("[unit] formatCsv", () => {
  test("escapes and round-trips through parseCsv", () => {
    const csv = formatCsv(
      ["a", "b", "c"],
      [{ a: 'x"y', b: "1,2", c: 3 }, { a: "改\n行" }],
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(parseCsv(csv.slice(1))).toEqual([
      ["a", "b", "c"],
      ['x"y', "1,2", "3"],
      ["改\n行", "", ""],
    ]);
  });
});
