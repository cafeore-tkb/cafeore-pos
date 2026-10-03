import { describe, expect, test } from "vitest";
import {
  type MasterData,
  decodeText,
  masterDataToCsv,
  parseCsv,
  parseMasterCsv,
  parseMasterFiles,
} from "./master-csv";

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

describe("[unit] parseMasterCsv", () => {
  test("detects table by header, not file name", () => {
    const parsed = parseMasterCsv(
      "Book1 (2).csv",
      "name,abbr,item_type\nブレンド,ブ,hot\n,,\n",
    );
    expect(parsed).toEqual({
      table: "items",
      rows: 1,
      data: { items: [{ name: "ブレンド", abbr: "ブ", item_type: "hot" }] },
    });
  });

  test("accepts Japanese headers and Excel-formatted prices", () => {
    const parsed = parseMasterCsv(
      "menus.csv",
      'キー,名前,略称,価格,アイテム\nq,ブレンド,ブ,"¥1,400",ブレンド;ミルク*2\nw,セット,セ,400円,"A\nB×３"\n',
    );
    expect(parsed).toEqual({
      table: "menus",
      rows: 2,
      data: {
        menus: [
          {
            key: "q",
            name: "ブレンド",
            abbr: "ブ",
            price: 1400,
            items: [
              { item: "ブレンド", quantity: 1 },
              { item: "ミルク", quantity: 2 },
            ],
          },
          {
            key: "w",
            name: "セット",
            abbr: "セ",
            price: 400,
            items: [
              { item: "A", quantity: 1 },
              { item: "B", quantity: 3 },
            ],
          },
        ],
      },
    });
  });

  test("reads ¥ that Shift_JIS turned into a backslash", () => {
    const parsed = parseMasterCsv(
      "menus.csv",
      'key,name,abbr,price,items\nq,a,a,"\\1,000",x\n',
    );
    expect(parsed).toHaveProperty(["data", "menus", 0, "price"], 1000);
  });

  test("reports row numbers as Excel shows them", () => {
    const parsed = parseMasterCsv(
      "menus.csv",
      "key,name,abbr,price,items\nq,a,a,400,x\n\nw,b,b,四百,x\n",
    );
    expect(parsed).toEqual({
      problems: ["menus.csv 4行目: price「四百」が整数ではありません"],
    });
  });

  test("rejects unknown headers and missing columns", () => {
    expect(parseMasterCsv("x.csv", "foo,bar\n1,2\n")).toHaveProperty(
      "problems",
    );
    expect(parseMasterCsv("x.csv", "key,price\nq,1\n")).toEqual({
      problems: ["x.csv: name, abbr, items の列がありません"],
    });
  });
});

describe("[unit] parseMasterFiles", () => {
  test("merges JSON and CSV files", () => {
    const json = JSON.stringify({
      item_types: [{ name: "ice", display_name: "アイス" }],
    });
    const result = parseMasterFiles([
      { name: "types.csv", bytes: sjis("name,display_name\r\nhot,", "\r\n") },
      { name: "master.json", bytes: utf8(json) },
    ]);
    expect(result.problems).toEqual([]);
    expect(result.data.item_types).toEqual([
      { name: "hot", display_name: "ホット" },
      { name: "ice", display_name: "アイス" },
    ]);
    expect(result.files).toEqual([
      { name: "types.csv", tables: [{ table: "item_types", rows: 1 }] },
      { name: "master.json", tables: [{ table: "item_types", rows: 1 }] },
    ]);
  });

  test("reports broken JSON", () => {
    const result = parseMasterFiles([{ name: "a.json", bytes: utf8("{") }]);
    expect(result.problems[0]).toMatch(/^a\.json: JSON として読めません/);
  });
});

describe("[unit] masterDataToCsv", () => {
  test("round-trips through parseMasterFiles", () => {
    const data: MasterData = {
      item_types: [{ name: "hot", display_name: "ホット, 温" }],
      items: [{ name: 'ブレンド"A"', abbr: "ブ", item_type: "hot" }],
      menus: [
        {
          key: "q",
          name: "ブレンド",
          abbr: "ブ",
          price: 400,
          items: [
            { item: 'ブレンド"A"', quantity: 1 },
            { item: "ミルク", quantity: 2 },
          ],
        },
      ],
    };
    const csv = masterDataToCsv(data);
    const result = parseMasterFiles(
      Object.entries(csv).map(([name, text]) => ({
        name: `${name}.csv`,
        bytes: utf8(text),
      })),
    );
    expect(result.problems).toEqual([]);
    expect(result.data).toEqual(data);
  });
});
