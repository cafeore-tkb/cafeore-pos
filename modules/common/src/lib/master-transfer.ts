import addFormats from "ajv-formats";
import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020";
import type { components } from "../types/api";
import openapiSchemas from "../types/openapi-schemas.json";
import { decodeText, formatCsv, parseCsv } from "./csv";

// アイテムタイプ・アイテム・メニュー・背景色・在庫対象・使用量を、CSV / JSON と既存の API の呼び出しとで相互に変換する。
// 列名は OpenAPI のプロパティ名と同じにし、値の検証は openapi.yaml のスキーマに任せる。
// ここに書くのは、名前と ID の付け替え・送る順番・重複の確認だけ。

type Schemas = components["schemas"];
type SchemaName = keyof typeof openapiSchemas;

export const MASTER_TABLES = [
  "item_types",
  "items",
  "menus",
  "menu_items",
  "color_settings",
  "stock_resources",
  "item_stock_usages",
] as const;
export type MasterTable = (typeof MASTER_TABLES)[number];

export const MASTER_TABLE_LABELS: Record<MasterTable, string> = {
  item_types: "アイテムタイプ",
  items: "アイテム",
  menus: "メニュー",
  menu_items: "メニューの構成",
  color_settings: "背景色",
  stock_resources: "在庫対象",
  item_stock_usages: "使用量",
};

// ID の代わりに名前（メニューはキー）で書く列
const REF_COLUMNS: Record<string, string> = {
  item_type_id: "item_type",
  item_id: "item",
  target_id: "target",
  resource_id: "resource",
};

const propertiesOf = (name: SchemaName): string[] =>
  Object.keys(
    (openapiSchemas[name] as { properties?: Record<string, unknown> })
      .properties ?? {},
  );

const columnsOf = (name: SchemaName, omit: string[] = []) =>
  propertiesOf(name)
    .filter((property) => !omit.includes(property))
    .map((property) => REF_COLUMNS[property] ?? property);

export const MASTER_COLUMNS: Record<MasterTable, string[]> = {
  item_types: columnsOf("ItemTypeCreateRequest"),
  items: columnsOf("ItemCreateRequest"),
  // 構成は menu_items に1行ずつ書く
  menus: columnsOf("MenuCreateRequest", ["items"]),
  menu_items: ["menu", ...columnsOf("MenuItemRequest")],
  color_settings: columnsOf("ColorSettingUpsertRequest"),
  stock_resources: columnsOf("StockResourceRequest"),
  // アイテムごとに置き換える API なので、アイテムを1列目に足して1行ずつ書く
  item_stock_usages: ["item", ...columnsOf("ItemStockUsageRequest")],
};

// --- ファイルの読み込み ---

/** 1行分の値と、エラーで示す場所（「items.csv 4行目」など） */
export type MasterRow = { at: string; values: Record<string, unknown> };
export type MasterRows = Record<MasterTable, MasterRow[]>;

export type MasterFile = { name: string; bytes: ArrayBuffer | Uint8Array };

export type ReadMasterFilesResult = {
  rows: MasterRows;
  // 画面に「items.csv → アイテム 12件」と出すための内訳
  files: { name: string; tables: { table: MasterTable; rows: number }[] }[];
  problems: string[];
};

const emptyRows = (): MasterRows => ({
  item_types: [],
  items: [],
  menus: [],
  menu_items: [],
  color_settings: [],
  stock_resources: [],
  item_stock_usages: [],
});

const isMasterTable = (name: string): name is MasterTable =>
  (MASTER_TABLES as readonly string[]).includes(name);

// CSV は書き出したときのファイル名で表を決める。「items (1).csv」のように後ろが変わっても読める。
const tableOfFileName = (fileName: string): MasterTable | null => {
  const base = fileName.replace(/^.*[\\/]/, "");
  return MASTER_TABLES.find((table) => base.startsWith(table)) ?? null;
};

// 空のセルは「値が無い」として扱う。必須かどうかはスキーマで決まる。
const presentValues = (entries: [string, unknown][]) =>
  Object.fromEntries(
    entries.filter(([, value]) => value !== "" && value !== undefined),
  );

const isBlank = (row: string[]) => row.every((cell) => cell.trim() === "");

// 見出しやキーの打ち間違いを黙って捨てると、任意の列（背景色など）が「値なし」で登録されてしまう
const unknownColumnsProblem = (
  where: string,
  table: MasterTable,
  columns: Iterable<string>,
): string | null => {
  const unknown = [...new Set(columns)].filter(
    (column) => !MASTER_COLUMNS[table].includes(column),
  );
  if (unknown.length === 0) return null;
  return `${where}: ${unknown.map((column) => `「${column}」`).join("")}という列はありません（${MASTER_COLUMNS[table].join(" / ")}）`;
};

const readCsvRows = (
  fileName: string,
  table: MasterTable,
  text: string,
  problems: string[],
): MasterRow[] => {
  const lines = parseCsv(text);
  const headerIndex = lines.findIndex((line) => !isBlank(line));
  if (headerIndex < 0) return [];
  const headers = lines[headerIndex].map((header) => header.trim());
  // Excel が足す見出しの無い列は、値が入っていなければ無視する
  const problem = unknownColumnsProblem(
    fileName,
    table,
    headers.filter((header) => header !== ""),
  );
  if (problem) problems.push(problem);

  const rows: MasterRow[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (isBlank(lines[i])) continue;
    rows.push({
      // Excel の行番号と合わせる
      at: `${fileName} ${i + 1}行目`,
      values: presentValues(
        headers.map((header, column) => [
          header,
          (lines[i][column] ?? "").trim(),
        ]),
      ),
    });
  }
  if (rows.some((row) => "" in row.values)) {
    problems.push(`${fileName}: 見出しの無い列に値があります`);
  }
  return rows;
};

const readJsonRows = (
  fileName: string,
  text: string,
  problems: string[],
): Partial<MasterRows> | string => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return `JSON として読めません（${e instanceof Error ? e.message : e}）`;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return `${MASTER_TABLES.join(" / ")} を持つオブジェクトにしてください`;
  }

  const result: Partial<MasterRows> = {};
  for (const [table, rows] of Object.entries(json)) {
    if (!isMasterTable(table)) {
      return `「${table}」という表はありません（${MASTER_TABLES.join(" / ")}）`;
    }
    if (!Array.isArray(rows)) return `${table} は配列にしてください`;
    const problem = unknownColumnsProblem(
      `${fileName} ${table}`,
      table,
      rows.flatMap((row) =>
        typeof row === "object" && row !== null ? Object.keys(row) : [],
      ),
    );
    if (problem) problems.push(problem);
    result[table] = rows.map((row, i) => ({
      at: `${fileName} ${table}[${i}]`,
      values:
        typeof row === "object" && row !== null
          ? presentValues(Object.entries(row))
          : {},
    }));
  }
  return result;
};

/**
 * JSON と CSV を混ぜて受け取り、表ごとの行にまとめる。
 * 値の中身はまだ見ない（planMasterImport でスキーマに当てる）。
 */
export const readMasterFiles = (files: MasterFile[]): ReadMasterFilesResult => {
  const result: ReadMasterFilesResult = {
    rows: emptyRows(),
    files: [],
    problems: [],
  };

  for (const file of files) {
    const text = decodeText(file.bytes);
    let tables: Partial<MasterRows>;
    if (/\.json$/i.test(file.name)) {
      const parsed = readJsonRows(file.name, text, result.problems);
      if (typeof parsed === "string") {
        result.problems.push(`${file.name}: ${parsed}`);
        continue;
      }
      tables = parsed;
    } else {
      const table = tableOfFileName(file.name);
      if (!table) {
        result.problems.push(
          `${file.name}: ファイル名からどの表か決められません。${MASTER_TABLES.join(" / ")} のどれかで始まる名前にしてください`,
        );
        continue;
      }
      tables = {
        [table]: readCsvRows(file.name, table, text, result.problems),
      };
    }

    const summary: ReadMasterFilesResult["files"][number] = {
      name: file.name,
      tables: [],
    };
    for (const table of MASTER_TABLES) {
      const rows = tables[table];
      if (!rows) continue;
      result.rows[table].push(...rows);
      summary.tables.push({ table, rows: rows.length });
    }
    result.files.push(summary);
  }
  return result;
};

// --- 取り込みの計画 ---

/** 今の DB の内容。名前と ID の付け替えと、重複の確認に使う */
export type MasterSnapshot = {
  item_types: Schemas["ItemTypeResponse"][];
  items: Schemas["ItemResponse"][];
  menus: Schemas["MenuResponse"][];
  color_settings: Schemas["ColorSettingResponse"][];
  stock_resources: Schemas["StockResourceResponse"][];
  item_stock_usages: Schemas["StockUsage"][];
};

type JsonPointer = (string | number)[];

/** 既存の API への1回の呼び出し */
export type MasterCall = {
  table:
    | "item_types"
    | "items"
    | "menus"
    | "color_settings"
    | "stock_resources"
    | "item_stock_usages";
  method: "POST" | "PUT";
  // 使用量はパスにアイテムの ID を入れる。本文の item_id をパスに、usages を本文にして送る
  path:
    | "/api/item-types"
    | "/api/items"
    | "/api/menus"
    | "/api/color-settings"
    | "/api/inventory/resources"
    | "/api/inventory/usages/{item_id}";
  // 画面に出す名前
  label: string;
  body: Record<string, unknown>;
  // ファイル内で作る行への参照。送る直前に、作ったときに返ってきた ID を入れる
  refs: { pointer: JsonPointer; key: string }[];
  // 作った行の ID を、この名前で後の呼び出しから参照する
  creates?: string;
};

export type MasterPlan = { calls: MasterCall[]; problems: string[] };

// 作る前の行を指す ID。スキーマの format: uuid を通すために入れておき、送る前に差し替える
const PENDING_ID = "00000000-0000-0000-0000-000000000000";

const refKey = (table: MasterTable, name: string) => `${table}:${name}`;

// ポインターはこのファイルの中で組み立てるが、念のためプロトタイプを書き換えるキーは通さない。
// CodeQL がガードと認めるよう、キーごとにその場で比べる
const setAt = (
  target: Record<string, unknown>,
  pointer: JsonPointer,
  value: unknown,
) => {
  let node = target as Record<string | number, unknown>;
  for (const key of pointer.slice(0, -1)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new Error(`${key} には書き込めません`);
    }
    node = node[key] as Record<string | number, unknown>;
  }
  const last = pointer[pointer.length - 1];
  if (last === "__proto__" || last === "constructor" || last === "prototype") {
    throw new Error(`${last} には書き込めません`);
  }
  node[last] = value;
};

const getAt = (target: unknown, pointer: string[]) =>
  pointer.reduce<unknown>(
    (node, key) =>
      typeof node === "object" && node !== null
        ? (node as Record<string, unknown>)[key]
        : undefined,
    target,
  );

// スキーマのプロパティのうち、行にあるものだけを取り出す。参照の列は別に入れる。
const bodyOf = (
  row: MasterRow,
  schema: SchemaName,
  omit: string[] = [],
): Record<string, unknown> =>
  Object.fromEntries(
    propertiesOf(schema)
      .filter(
        (property) =>
          !omit.includes(property) &&
          !(property in REF_COLUMNS) &&
          row.values[property] !== undefined,
      )
      .map((property) => [property, row.values[property]]),
  );

let ajv: Ajv2020 | null = null;

// ajv はスキーマをコードに変換するので、最初に使うときに一度だけ作る
const validatorOf = (name: SchemaName): ValidateFunction => {
  if (!ajv) {
    // OpenAPI 独自のキーワード（example, nullable など）は無視する
    ajv = new Ajv2020({ allErrors: true, strict: false, coerceTypes: true });
    addFormats(ajv);
    ajv.addSchema({ $id: "openapi", components: { schemas: openapiSchemas } });
  }
  const validate = ajv.getSchema(`openapi#/components/schemas/${name}`);
  if (!validate) throw new Error(`${name} というスキーマがありません`);
  return validate;
};

const TYPE_LABELS: Record<string, string> = {
  integer: "整数",
  number: "数",
  string: "文字列",
  boolean: "true / false",
  array: "配列",
  object: "オブジェクト",
};

const describeError = (error: ErrorObject, value: unknown): string => {
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case "required":
      return "値がありません";
    case "type":
      return `「${value}」は${TYPE_LABELS[String(params.type)] ?? params.type}ではありません`;
    case "minimum":
    case "exclusiveMinimum":
    case "maximum":
    case "exclusiveMaximum":
      return `${value} は使えません（${params.comparison} ${params.limit}）`;
    case "minItems":
      return `${params.limit}件以上必要です`;
    case "maxItems":
      return `${params.limit}件までです`;
    case "minLength":
      return `${params.limit}文字以上必要です`;
    case "maxLength":
      return `${params.limit}文字までです`;
    case "pattern":
      return `「${value}」が決まった形（${params.pattern}）になっていません`;
    case "format":
      return `「${value}」が ${params.format} の形になっていません`;
    case "not":
      // openapi.yaml では「0 より大きい」を minimum: 0 と not: { enum: [0] } で書いている
      return `${value} は使えません（> 0）`;
    case "enum":
      return `「${value}」は使えません（${(params.allowedValues as unknown[]).join(" / ")} のどれか）`;
    default:
      return error.message ?? error.keyword;
  }
};

/**
 * 読み込んだ行を、既存の API の呼び出しの列にする。
 * 作成だけを行い、名前（メニューはキー）が既にあればエラーにする。背景色は既存の対象にも付けられる。
 * 使用量は既存のアイテムにも付けられ、そのアイテムの使用量をファイルの内容に置き換える。
 * problems が空でなければ、何も送ってはいけない。
 */
export const planMasterImport = (
  rows: MasterRows,
  snapshot: MasterSnapshot,
): MasterPlan => {
  const problems: string[] = [];
  const calls: MasterCall[] = [];
  // 呼び出しごとの、エラーを示す元の行（メニューは構成の行も）
  const sources = new Map<MasterCall, { row: MasterRow; items: MasterRow[] }>();

  const report = (row: MasterRow, column: string | null, message: string) =>
    problems.push(`${row.at}${column ? `・${column}` : ""}: ${message}`);

  // 名前 → 既存の ID。同じ名前が複数あると決められないので null にする
  const existingIds = (list: { id: string; name: string }[]) => {
    const map = new Map<string, string | null>();
    for (const { id, name } of list) map.set(name, map.has(name) ? null : id);
    return map;
  };
  const existing = {
    item_types: existingIds(snapshot.item_types),
    items: existingIds(snapshot.items),
    stock_resources: existingIds(snapshot.stock_resources),
  };
  const existingMenuKeys = new Set(snapshot.menus.map((menu) => menu.key));
  const creating = {
    item_types: new Set<string>(),
    items: new Set<string>(),
    menus: new Map<string, MasterCall>(),
    stock_resources: new Set<string>(),
  };

  // 作る行の名前が、ファイル内や既存と重ならないか
  const isNew = (
    row: MasterRow,
    column: string,
    taken: { has: (name: string) => boolean },
    exists: (name: string) => boolean,
  ): string | null => {
    const value = row.values[column];
    // 空ならスキーマの required で出る
    if (value === undefined) return null;
    const name = String(value);
    if (taken.has(name)) {
      report(row, column, `「${name}」がファイル内で重複しています`);
      return null;
    }
    if (exists(name)) {
      report(row, column, `「${name}」は既にあります（取り込みは作成のみ）`);
      return null;
    }
    return name;
  };

  // 名前を ID にする。ファイル内で作るものは、送るときに入れる
  const resolve = (
    table: "item_types" | "items" | "stock_resources",
    row: MasterRow,
    column: string,
    call: MasterCall,
    pointer: JsonPointer,
  ) => {
    const value = row.values[column];
    if (value === undefined) return;
    const name = String(value);
    if (creating[table].has(name)) {
      setAt(call.body, pointer, PENDING_ID);
      call.refs.push({ pointer, key: refKey(table, name) });
      return;
    }
    const id = existing[table].get(name);
    if (id) {
      setAt(call.body, pointer, id);
      return;
    }
    report(
      row,
      column,
      id === null
        ? `「${name}」という${MASTER_TABLE_LABELS[table]}が複数あり、どれか決められません`
        : `「${name}」という${MASTER_TABLE_LABELS[table]}がありません`,
    );
    // 同じことをスキーマの側で重ねて出さない
    setAt(call.body, pointer, PENDING_ID);
  };

  const addCall = (
    call: Omit<MasterCall, "refs">,
    row: MasterRow,
  ): MasterCall => {
    const full = { ...call, refs: [] };
    calls.push(full);
    sources.set(full, { row, items: [] });
    return full;
  };

  for (const row of rows.item_types) {
    const name = isNew(row, "name", creating.item_types, (n) =>
      existing.item_types.has(n),
    );
    if (name !== null) creating.item_types.add(name);
    addCall(
      {
        table: "item_types",
        method: "POST",
        path: "/api/item-types",
        label: String(row.values.name ?? ""),
        body: bodyOf(row, "ItemTypeCreateRequest"),
        creates: name !== null ? refKey("item_types", name) : undefined,
      },
      row,
    );
  }

  // アイテムどうしの参照は無いので、先に名前をそろえてから参照を解く
  const itemCalls = rows.items.map((row) => {
    const name = isNew(row, "name", creating.items, (n) =>
      existing.items.has(n),
    );
    if (name !== null) creating.items.add(name);
    return {
      row,
      call: addCall(
        {
          table: "items",
          method: "POST",
          path: "/api/items",
          label: String(row.values.name ?? ""),
          body: bodyOf(row, "ItemCreateRequest"),
          creates: name !== null ? refKey("items", name) : undefined,
        },
        row,
      ),
    };
  });
  for (const { row, call } of itemCalls) {
    resolve("item_types", row, "item_type", call, ["item_type_id"]);
  }

  for (const row of rows.menus) {
    const key = isNew(row, "key", creating.menus, (k) =>
      existingMenuKeys.has(k),
    );
    const call = addCall(
      {
        table: "menus",
        method: "POST",
        path: "/api/menus",
        label: String(row.values.name ?? row.values.key ?? ""),
        body: { ...bodyOf(row, "MenuCreateRequest", ["items"]), items: [] },
      },
      row,
    );
    if (key !== null) creating.menus.set(key, call);
  }

  const menuItemPairs = new Set<string>();
  for (const row of rows.menu_items) {
    const menuKey = row.values.menu;
    if (menuKey === undefined) {
      report(row, "menu", "値がありません");
      continue;
    }
    const call = creating.menus.get(String(menuKey));
    if (!call) {
      report(
        row,
        "menu",
        existingMenuKeys.has(String(menuKey))
          ? `「${menuKey}」は既にあるメニューです。構成は、同じファイルで作るメニューにだけ付けられます`
          : `「${menuKey}」というキーのメニューがファイル内にありません`,
      );
      continue;
    }
    const pair = `${menuKey}\u0000${row.values.item}`;
    if (row.values.item !== undefined && menuItemPairs.has(pair)) {
      report(
        row,
        "item",
        `「${row.values.item}」がこのメニューに重複しています`,
      );
    }
    menuItemPairs.add(pair);

    const items = call.body.items as Record<string, unknown>[];
    items.push(bodyOf(row, "MenuItemRequest"));
    sources.get(call)?.items.push(row);
    resolve("items", row, "item", call, ["items", items.length - 1, "item_id"]);
  }

  const colorTargets = new Set<string>();
  for (const row of rows.color_settings) {
    const { target_type, target, screen } = row.values;
    const target_key = `${target_type}\u0000${target}\u0000${screen}`;
    if (colorTargets.has(target_key)) {
      report(
        row,
        null,
        `${target_type}「${target}」の ${screen} がファイル内で重複しています`,
      );
    }
    colorTargets.add(target_key);

    const call = addCall(
      {
        table: "color_settings",
        // 対象と画面の組が既にあれば上書きされる
        method: "PUT",
        path: "/api/color-settings",
        label: `${target ?? ""}（${screen ?? ""}）`,
        body: bodyOf(row, "ColorSettingUpsertRequest"),
      },
      row,
    );
    const table =
      target_type === "Item"
        ? "items"
        : target_type === "ItemType"
          ? "item_types"
          : null;
    if (table) {
      resolve(table, row, "target", call, ["target_id"]);
    } else if (target !== undefined) {
      // 種類が不正なときは、スキーマの enum のエラーだけを出す
      call.body.target_id = PENDING_ID;
    }
  }

  for (const row of rows.stock_resources) {
    const name = isNew(row, "name", creating.stock_resources, (n) =>
      existing.stock_resources.has(n),
    );
    if (name !== null) creating.stock_resources.add(name);
    addCall(
      {
        table: "stock_resources",
        method: "POST",
        path: "/api/inventory/resources",
        label: String(row.values.name ?? ""),
        body: bodyOf(row, "StockResourceRequest"),
        creates: name !== null ? refKey("stock_resources", name) : undefined,
      },
      row,
    );
  }

  // 使用量はアイテムごとに1回の呼び出しにまとめる
  const usageCalls = new Map<string, MasterCall>();
  const usagePairs = new Set<string>();
  for (const row of rows.item_stock_usages) {
    const itemName = row.values.item;
    if (itemName === undefined) {
      report(row, "item", "値がありません");
      continue;
    }
    let call = usageCalls.get(String(itemName));
    if (!call) {
      call = addCall(
        {
          table: "item_stock_usages",
          method: "PUT",
          path: "/api/inventory/usages/{item_id}",
          label: String(itemName),
          body: { item_id: PENDING_ID, usages: [] },
        },
        row,
      );
      usageCalls.set(String(itemName), call);
      resolve("items", row, "item", call, ["item_id"]);
    }
    const pair = `${itemName}\u0000${row.values.resource}`;
    if (row.values.resource !== undefined && usagePairs.has(pair)) {
      report(
        row,
        "resource",
        `「${row.values.resource}」がこのアイテムに重複しています`,
      );
    }
    usagePairs.add(pair);

    const usages = call.body.usages as Record<string, unknown>[];
    usages.push(bodyOf(row, "ItemStockUsageRequest"));
    sources.get(call)?.items.push(row);
    resolve("stock_resources", row, "resource", call, [
      "usages",
      usages.length - 1,
      "resource_id",
    ]);
  }

  const SCHEMAS: Record<
    Exclude<MasterCall["table"], "item_stock_usages">,
    SchemaName
  > = {
    item_types: "ItemTypeCreateRequest",
    items: "ItemCreateRequest",
    menus: "MenuCreateRequest",
    color_settings: "ColorSettingUpsertRequest",
    stock_resources: "StockResourceRequest",
  };
  for (const call of calls) {
    if (call.table === "item_stock_usages") {
      // 本文は配列なので1件ずつ当て、エラーはその行で示す
      const validate = validatorOf("ItemStockUsageRequest");
      const source = sources.get(call);
      for (const [i, usage] of (
        call.body.usages as Record<string, unknown>[]
      ).entries()) {
        const row = source?.items[i];
        if (validate(usage) || !row) continue;
        for (const error of validate.errors ?? []) {
          const path = error.instancePath.split("/").slice(1);
          const property =
            path[0] ??
            (error.keyword === "required"
              ? String(
                  (error.params as { missingProperty: string }).missingProperty,
                )
              : null);
          report(
            row,
            property && (REF_COLUMNS[property] ?? property),
            describeError(error, getAt(usage, path)),
          );
        }
      }
      continue;
    }
    const validate = validatorOf(SCHEMAS[call.table]);
    // coerceTypes で CSV の文字列（"400" など）がスキーマの型に直る
    if (validate(call.body)) continue;
    const source = sources.get(call);
    if (!source) continue;
    for (const error of validate.errors ?? []) {
      const path = error.instancePath.split("/").slice(1);
      const value = getAt(call.body, path);
      let row = source.row;
      let rest = path;
      // メニューの構成のエラーは、menu_items の行で示す
      if (call.table === "menus" && path[0] === "items" && path.length >= 2) {
        row = source.items[Number(path[1])] ?? row;
        rest = path.slice(2);
      }
      const property =
        rest[0] ??
        (error.keyword === "required"
          ? String(
              (error.params as { missingProperty: string }).missingProperty,
            )
          : null);
      const column =
        call.table === "menus" && property === "items" && rest.length <= 1
          ? "menu_items"
          : property && (REF_COLUMNS[property] ?? property);
      report(row, column, describeError(error, value));
    }
  }

  return { calls, problems };
};

/**
 * 送る直前の本文。ファイル内で作った行の ID（ids）を参照に入れる。
 */
export const resolveCallBody = (
  call: MasterCall,
  ids: Map<string, string>,
): Record<string, unknown> => {
  const body = structuredClone(call.body);
  for (const { pointer, key } of call.refs) {
    const id = ids.get(key);
    if (!id) throw new Error(`${key} がまだ作られていません`);
    setAt(body, pointer, id);
  }
  return body;
};

// --- 書き出し ---

// 列の順に並べる（JSON でも CSV と同じ順にする）
const pick = (source: object, columns: string[]) =>
  Object.fromEntries(
    columns
      .filter((column) => column in source)
      .map((column) => [column, (source as Record<string, unknown>)[column]]),
  );

/**
 * 今の DB の内容を、取り込みと同じ形の表にする。参照は名前（メニューはキー）で書く。
 */
export const snapshotToTables = (
  snapshot: MasterSnapshot,
): Record<MasterTable, Record<string, unknown>[]> => {
  const names = {
    Item: new Map(snapshot.items.map((item) => [item.id, item.name])),
    ItemType: new Map(snapshot.item_types.map((type) => [type.id, type.name])),
  };
  const resourceNames = new Map(
    snapshot.stock_resources.map((resource) => [resource.id, resource.name]),
  );
  return {
    item_types: snapshot.item_types.map((type) =>
      pick(type, MASTER_COLUMNS.item_types),
    ),
    items: snapshot.items.map((item) =>
      pick({ ...item, item_type: item.item_type.name }, MASTER_COLUMNS.items),
    ),
    menus: snapshot.menus.map((menu) => pick(menu, MASTER_COLUMNS.menus)),
    menu_items: snapshot.menus.flatMap((menu) =>
      menu.items.map((menuItem) =>
        pick(
          { ...menuItem, menu: menu.key, item: menuItem.item.name },
          MASTER_COLUMNS.menu_items,
        ),
      ),
    ),
    // 対象が消えている設定は取り込み直せないので出さない
    color_settings: snapshot.color_settings.flatMap((setting) => {
      const target = names[setting.target_type].get(setting.target_id);
      return target === undefined
        ? []
        : [pick({ ...setting, target }, MASTER_COLUMNS.color_settings)];
    }),
    stock_resources: snapshot.stock_resources.map((resource) =>
      pick(resource, MASTER_COLUMNS.stock_resources),
    ),
    // アイテムか在庫対象が消えている使用量は出さない
    item_stock_usages: snapshot.item_stock_usages.flatMap((usage) => {
      const item = names.Item.get(usage.item_id);
      const resource = resourceNames.get(usage.resource_id);
      return item === undefined || resource === undefined
        ? []
        : [
            pick(
              { ...usage, item, resource },
              MASTER_COLUMNS.item_stock_usages,
            ),
          ];
    }),
  };
};

/** 表ごとの CSV。ファイル名は表の名前にする（取り込みはファイル名で表を決める） */
export const tablesToCsv = (
  tables: Record<MasterTable, Record<string, unknown>[]>,
): Record<MasterTable, string> =>
  Object.fromEntries(
    MASTER_TABLES.map((table) => [
      table,
      formatCsv(MASTER_COLUMNS[table], tables[table]),
    ]),
  ) as Record<MasterTable, string>;
