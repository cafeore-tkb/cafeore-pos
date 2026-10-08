import { describe, expect, test } from "vitest";
import { itemTypeSchema } from "../models/item";
import { readOpenapiSchemas } from "../scripts/generate-openapi-schemas";
import openapiSchemas from "../types/openapi-schemas.json";
import {
  MASTER_COLUMNS,
  type MasterRows,
  type MasterSnapshot,
  planMasterImport,
  readMasterFiles,
  resolveCallBody,
  snapshotToTables,
  tablesToCsv,
} from "./master-transfer";

const utf8 = (text: string) => new TextEncoder().encode(text);

const TYPE_HOT = "11111111-1111-4111-8111-111111111111";
const ITEM_MILK = "22222222-2222-4222-8222-222222222222";
const MENU_OLD = "33333333-3333-4333-8333-333333333333";

const hotType = {
  ...itemTypeSchema.parse({ name: "hot", display_name: "ホット" }),
  id: TYPE_HOT,
};

const emptySnapshot: MasterSnapshot = {
  item_types: [],
  items: [],
  menus: [],
  color_settings: [],
};

const snapshot: MasterSnapshot = {
  item_types: [hotType],
  items: [
    {
      id: ITEM_MILK,
      name: "ミルク",
      abbr: "ミ",
      item_type: hotType,
    },
  ],
  menus: [
    {
      id: MENU_OLD,
      name: "旧ブレンド",
      abbr: "旧",
      price: 400,
      key: "old",
      items: [],
    },
  ],
  color_settings: [],
};

// CSV と同じく値は文字列で渡す
const rowsOf = (tables: Partial<Record<keyof MasterRows, object[]>>) => {
  const rows: MasterRows = {
    item_types: [],
    items: [],
    menus: [],
    menu_items: [],
    color_settings: [],
  };
  for (const [table, list] of Object.entries(tables)) {
    rows[table as keyof MasterRows] = list.map((values, i) => ({
      at: `${table}.csv ${i + 2}行目`,
      values: values as Record<string, unknown>,
    }));
  }
  return rows;
};

describe("[unit] openapi-schemas.json", () => {
  test("matches openapi.yaml (run pnpm common generate:schemas)", () => {
    expect(openapiSchemas).toEqual(readOpenapiSchemas());
  });

  test("columns follow the request schemas", () => {
    expect(MASTER_COLUMNS).toEqual({
      item_types: [
        "name",
        "display_name",
        "makes_cup",
        "needs_brew",
        "senior_only",
        "iced_brew",
      ],
      items: ["name", "abbr", "item_type"],
      menus: ["name", "abbr", "price", "key"],
      menu_items: ["menu", "item", "quantity"],
      color_settings: ["target_type", "target", "screen", "color"],
    });
  });
});

describe("[unit] readMasterFiles", () => {
  test("picks the table from the CSV file name and reads JSON tables", () => {
    const result = readMasterFiles([
      {
        name: "items (1).csv",
        bytes: utf8("name,abbr,item_type\nブレンド,ブ,hot\n,,\n"),
      },
      { name: "item_types.csv", bytes: utf8("name,display_name\nice,\n") },
      {
        name: "master.json",
        bytes: utf8(JSON.stringify({ menus: [{ key: "q", price: 400 }] })),
      },
    ]);
    expect(result.problems).toEqual([]);
    expect(result.rows.items).toEqual([
      {
        at: "items (1).csv 2行目",
        values: { name: "ブレンド", abbr: "ブ", item_type: "hot" },
      },
    ]);
    // 空のセルは値が無い扱い
    expect(result.rows.item_types[0].values).toEqual({ name: "ice" });
    expect(result.rows.menus[0]).toEqual({
      at: "master.json menus[0]",
      values: { key: "q", price: 400 },
    });
    expect(result.files.map((file) => file.tables)).toEqual([
      [{ table: "items", rows: 1 }],
      [{ table: "item_types", rows: 1 }],
      [{ table: "menus", rows: 1 }],
    ]);
  });

  test("reports unknown file names and broken JSON", () => {
    const result = readMasterFiles([
      { name: "Book1.csv", bytes: utf8("a\n1\n") },
      { name: "a.json", bytes: utf8("{") },
      { name: "b.json", bytes: utf8('{"foods": []}') },
    ]);
    expect(result.problems).toHaveLength(3);
    expect(result.problems[0]).toMatch(/^Book1\.csv: ファイル名から/);
    expect(result.problems[1]).toMatch(/^a\.json: JSON として読めません/);
    expect(result.problems[2]).toMatch(/「foods」という表はありません/);
  });

  test("reports columns and keys that are not in the schema", () => {
    const result = readMasterFiles([
      {
        name: "items.csv",
        // 見出しの無い列は、Excel が足すことがあるので無視する
        bytes: utf8("name,abbr,item_type,prise,\nブレンド,ブ,hot,400,\n"),
      },
      {
        name: "master.json",
        bytes: utf8(
          JSON.stringify({
            color_settings: [
              { target_type: "Item", target: "ミルク", master_colour: "#fff" },
            ],
          }),
        ),
      },
    ]);
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toMatch(
      /^items\.csv: 「prise」という列はありません/,
    );
    expect(result.problems[1]).toMatch(
      /^master\.json color_settings: 「master_colour」という列はありません/,
    );
  });
});

describe("[unit] planMasterImport", () => {
  test("orders calls by dependency and links new rows by name", () => {
    const plan = planMasterImport(
      rowsOf({
        menus: [{ name: "ラテ", abbr: "ラ", price: "500", key: "w" }],
        menu_items: [
          { menu: "w", item: "エスプレッソ", quantity: "1" },
          { menu: "w", item: "ミルク", quantity: "2" },
        ],
        items: [{ name: "エスプレッソ", abbr: "エ", item_type: "ice" }],
        item_types: [{ name: "ice", display_name: "アイス" }],
        color_settings: [
          {
            target_type: "ItemType",
            target: "ice",
            screen: "serve",
            color: "#0ebbf0",
          },
          {
            target_type: "Item",
            target: "ミルク",
            screen: "master",
            color: "#F74316",
          },
        ],
      }),
      snapshot,
    );
    expect(plan.problems).toEqual([]);
    expect(plan.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/item-types",
      "POST /api/items",
      "POST /api/menus",
      "PUT /api/color-settings",
      "PUT /api/color-settings",
    ]);

    const [type, item, menu, typeColor, itemColor] = plan.calls;
    expect(type.creates).toBe("item_types:ice");
    expect(item.refs).toEqual([
      { pointer: ["item_type_id"], key: "item_types:ice" },
    ]);
    // スキーマの型に合わせて数値になる。既存のアイテムは ID がそのまま入る
    expect(menu.body).toMatchObject({
      price: 500,
      key: "w",
      items: [{ quantity: 1 }, { item_id: ITEM_MILK, quantity: 2 }],
    });
    expect(menu.refs).toEqual([
      { pointer: ["items", 0, "item_id"], key: "items:エスプレッソ" },
    ]);
    expect(typeColor.refs).toEqual([
      { pointer: ["target_id"], key: "item_types:ice" },
    ]);
    // 背景色は既存の対象にも付けられる
    expect(itemColor.body).toEqual({
      target_type: "Item",
      target_id: ITEM_MILK,
      screen: "master",
      color: "#F74316",
    });

    const ids = new Map([
      ["item_types:ice", "44444444-4444-4444-8444-444444444444"],
      ["items:エスプレッソ", "55555555-5555-4555-8555-555555555555"],
    ]);
    expect(resolveCallBody(menu, ids).items).toEqual([
      { item_id: "55555555-5555-4555-8555-555555555555", quantity: 1 },
      { item_id: ITEM_MILK, quantity: 2 },
    ]);
    // 計画そのものは書き換えない
    expect(menu.body.items).toMatchObject([
      { item_id: expect.any(String) },
      {},
    ]);
    expect(() => resolveCallBody(item, new Map())).toThrow();
  });

  test("rejects names that already exist or repeat in the file", () => {
    const plan = planMasterImport(
      rowsOf({
        item_types: [
          { name: "hot", display_name: "ホット" },
          { name: "ice", display_name: "アイス" },
          { name: "ice", display_name: "アイス2" },
        ],
        menus: [{ name: "旧", abbr: "旧", price: "400", key: "old" }],
        menu_items: [{ menu: "old", item: "ミルク", quantity: "1" }],
      }),
      snapshot,
    );
    expect(plan.problems).toEqual([
      "item_types.csv 2行目・name: 「hot」は既にあります（取り込みは作成のみ）",
      "item_types.csv 4行目・name: 「ice」がファイル内で重複しています",
      "menus.csv 2行目・key: 「old」は既にあります（取り込みは作成のみ）",
      "menu_items.csv 2行目・menu: 「old」は既にあるメニューです。構成は、同じファイルで作るメニューにだけ付けられます",
      "menus.csv 2行目・menu_items: 1件以上必要です",
    ]);
  });

  test("reports schema errors at the original row and column", () => {
    const plan = planMasterImport(
      rowsOf({
        items: [{ name: "x", item_type: "nothing" }],
        menus: [{ name: "a", abbr: "a", price: "-1", key: "q" }],
        menu_items: [{ menu: "q", item: "ミルク", quantity: "0" }],
        color_settings: [
          { target_type: "Menu", target: "q", screen: "master", color: "red" },
        ],
      }),
      snapshot,
    );
    expect(plan.problems).toEqual([
      "items.csv 2行目・item_type: 「nothing」というアイテムタイプがありません",
      "items.csv 2行目・abbr: 値がありません",
      "menus.csv 2行目・price: -1 は使えません（>= 0）",
      "menu_items.csv 2行目・quantity: 0 は使えません（>= 1）",
      "color_settings.csv 2行目・target_type: 「Menu」は使えません（Item / ItemType のどれか）",
      "color_settings.csv 2行目・color: 「red」が決まった形（^#[0-9a-fA-F]{6}$）になっていません",
    ]);
  });

  test("refuses ambiguous references to existing rows", () => {
    const plan = planMasterImport(
      rowsOf({ items: [{ name: "x", abbr: "x", item_type: "hot" }] }),
      {
        ...snapshot,
        item_types: [
          ...snapshot.item_types,
          { ...hotType, id: MENU_OLD, display_name: "ホット2" },
        ],
      },
    );
    expect(plan.problems).toEqual([
      "items.csv 2行目・item_type: 「hot」というアイテムタイプが複数あり、どれか決められません",
    ]);
  });
});

describe("[unit] export", () => {
  test("exported CSV imports cleanly into an empty DB", () => {
    const tables = snapshotToTables({
      ...snapshot,
      menus: [
        {
          ...snapshot.menus[0],
          items: [{ item: snapshot.items[0], quantity: 2 }],
        },
      ],
      color_settings: [
        {
          id: MENU_OLD,
          target_type: "Item",
          target_id: ITEM_MILK,
          screen: "serve",
          color: "#0ebbf0",
        },
        {
          // 消えたアイテムの設定は出さない
          id: TYPE_HOT,
          target_type: "Item",
          target_id: MENU_OLD,
          screen: "serve",
          color: "#0ebbf0",
        },
      ],
    });
    expect(tables.menu_items).toEqual([
      { menu: "old", item: "ミルク", quantity: 2 },
    ]);
    expect(tables.color_settings).toEqual([
      {
        target_type: "Item",
        target: "ミルク",
        screen: "serve",
        color: "#0ebbf0",
      },
    ]);

    const files = Object.entries(tablesToCsv(tables)).map(([table, csv]) => ({
      name: `${table}.csv`,
      bytes: utf8(csv),
    }));
    const read = readMasterFiles(files);
    expect(read.problems).toEqual([]);
    const plan = planMasterImport(read.rows, emptySnapshot);
    expect(plan.problems).toEqual([]);
    expect(plan.calls.map((call) => call.table)).toEqual([
      "item_types",
      "items",
      "menus",
      "color_settings",
    ]);
  });
});
