import type { components } from "../types/api";

// アイテムタイプ・アイテム・メニューを Excel で編集できる CSV と相互に変換する。
// API は JSON（MasterData）しか受け付けないので、CSV はここで JSON に直してから送る。

export type MasterData = components["schemas"]["MasterData"];
type MasterMenuItem = components["schemas"]["MasterMenuItem"];

export type MasterTable = "item_types" | "items" | "menus";

export const MASTER_TABLE_LABELS: Record<MasterTable, string> = {
  item_types: "アイテムタイプ",
  items: "アイテム",
  menus: "メニュー",
};

const COLUMNS = {
  item_types: ["name", "display_name"],
  items: ["name", "abbr", "item_type"],
  menus: ["key", "name", "abbr", "price", "items"],
} as const satisfies Record<MasterTable, readonly string[]>;

// Excel で日本語の見出しを付けても読めるようにする。
const HEADER_ALIASES: Record<string, string> = {
  名前: "name",
  名称: "name",
  表示名: "display_name",
  略称: "abbr",
  タイプ: "item_type",
  アイテムタイプ: "item_type",
  種類: "item_type",
  キー: "key",
  価格: "price",
  値段: "price",
  アイテム: "items",
  構成: "items",
};

const HEADER_HELP =
  "item_types は name,display_name、items は name,abbr,item_type、menus は key,name,abbr,price,items を1行目に入れてください";

// 中身でどの表かを決める。ファイル名は Excel や OS で変わりやすいので見ない。
const detectTable = (headers: string[]): MasterTable | null => {
  const has = (column: string) => headers.includes(column);
  if (has("key") && has("price")) return "menus";
  if (has("item_type")) return "items";
  if (has("display_name")) return "item_types";
  return null;
};

/**
 * RFC 4180 の CSV を行の配列にする。引用符の中の改行・カンマ・"" に対応する。
 */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
};

/**
 * ファイルの中身を文字列にする。Excel の「CSV (コンマ区切り)」は Shift_JIS、
 * 「CSV UTF-8」は BOM 付き UTF-8 で保存されるので、どちらも読めるようにする。
 */
export const decodeText = (bytes: ArrayBuffer | Uint8Array): string => {
  try {
    // UTF-8 の BOM は TextDecoder が取り除く。
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
};

// 「ブレンド;ミルク*2」→ [{item: ブレンド, quantity: 1}, {item: ミルク, quantity: 2}]
const parseMenuItems = (cell: string): MasterMenuItem[] | string => {
  const parts = cell
    .split(/[;；、\r\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const items: MasterMenuItem[] = [];
  for (const part of parts) {
    const match = part.match(/^(.*?)\s*[*＊×]\s*([0-9０-９]+)$/);
    if (!match) {
      items.push({ item: part, quantity: 1 });
      continue;
    }
    const quantity = Number(toHalfWidthDigits(match[2]));
    if (match[1] === "") return `「${part}」のアイテム名が空です`;
    items.push({ item: match[1], quantity });
  }
  return items;
};

const formatMenuItems = (items: MasterMenuItem[]): string =>
  items
    .map(({ item, quantity }) =>
      quantity === 1 ? item : `${item}*${quantity}`,
    )
    .join(";");

const toHalfWidthDigits = (s: string) =>
  s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));

// Excel で書式を付けると「¥1,400」「400円」のようになるので、記号を外して読む。
// Shift_JIS では ¥ がバックスラッシュと同じバイトなので、「\1,400」としても届く。
const parsePrice = (cell: string): number | null => {
  const normalized = toHalfWidthDigits(cell).replace(/[¥￥\\,，円\s]/g, "");
  if (!/^-?\d+$/.test(normalized)) return null;
  return Number(normalized);
};

export type ParsedCsv =
  | { table: MasterTable; data: MasterData; rows: number }
  | { problems: string[] };

/**
 * CSV 1ファイルを MasterData にする。どの表かは見出し行で判定する。
 * 問題は「ファイル名 n行目: …」の形でまとめて返す（Excel の行番号と合わせる）。
 */
export const parseMasterCsv = (fileName: string, text: string): ParsedCsv => {
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex((row) => !isBlank(row));
  if (headerIndex < 0) return { problems: [`${fileName}: 中身が空です`] };

  const headers = rows[headerIndex].map((h) => {
    const trimmed = h.trim();
    return HEADER_ALIASES[trimmed] ?? trimmed.toLowerCase();
  });
  const table = detectTable(headers);
  if (!table) {
    return {
      problems: [
        `${fileName}: 見出し行からどの表か判定できません（${rows[headerIndex].join(", ")}）。${HEADER_HELP}`,
      ],
    };
  }

  const missing = COLUMNS[table].filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    return {
      problems: [`${fileName}: ${missing.join(", ")} の列がありません`],
    };
  }

  const problems: string[] = [];
  const records: Record<string, string>[] = [];
  const lineNumbers: number[] = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    if (isBlank(rows[i])) continue;
    const record: Record<string, string> = {};
    headers.forEach((header, column) => {
      record[header] = (rows[i][column] ?? "").trim();
    });
    records.push(record);
    lineNumbers.push(i + 1);
  }

  const data: MasterData = {};
  switch (table) {
    case "item_types":
      data.item_types = records.map((r) => ({
        name: r.name,
        display_name: r.display_name,
      }));
      break;
    case "items":
      data.items = records.map((r) => ({
        name: r.name,
        abbr: r.abbr,
        item_type: r.item_type,
      }));
      break;
    case "menus":
      data.menus = [];
      records.forEach((r, i) => {
        const at = `${fileName} ${lineNumbers[i]}行目`;
        const price = parsePrice(r.price);
        if (price === null) {
          problems.push(`${at}: price「${r.price}」が整数ではありません`);
        }
        const items = parseMenuItems(r.items);
        if (typeof items === "string") {
          problems.push(`${at}: ${items}`);
        }
        if (price !== null && typeof items !== "string") {
          data.menus?.push({
            key: r.key,
            name: r.name,
            abbr: r.abbr,
            price,
            items,
          });
        }
      });
      break;
  }

  if (problems.length > 0) return { problems };
  return { table, data, rows: records.length };
};

const isBlank = (row: string[]) => row.every((cell) => cell.trim() === "");

export type MasterFile = { name: string; bytes: ArrayBuffer | Uint8Array };

export type ParsedMasterFiles = {
  data: MasterData;
  // 画面に「items.csv → アイテム 12件」と出すための内訳
  files: { name: string; tables: { table: MasterTable; rows: number }[] }[];
  problems: string[];
};

/**
 * JSON と CSV を混ぜて受け取り、1つの MasterData にまとめる。
 */
export const parseMasterFiles = (files: MasterFile[]): ParsedMasterFiles => {
  const result: ParsedMasterFiles = { data: {}, files: [], problems: [] };
  const append = (data: MasterData) => {
    for (const table of ["item_types", "items", "menus"] as const) {
      const rows = data[table];
      if (!rows) continue;
      // 型の上では表ごとに要素の型が違うので、表ごとにつなぐ。
      result.data[table] = [...(result.data[table] ?? []), ...rows] as never;
    }
  };

  for (const file of files) {
    const text = decodeText(file.bytes);
    if (/\.json$/i.test(file.name)) {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (e) {
        result.problems.push(
          `${file.name}: JSON として読めません（${e instanceof Error ? e.message : e}）`,
        );
        continue;
      }
      if (typeof json !== "object" || json === null || Array.isArray(json)) {
        result.problems.push(
          `${file.name}: item_types / items / menus を持つオブジェクトにしてください`,
        );
        continue;
      }
      const data = json as MasterData;
      append(data);
      result.files.push({
        name: file.name,
        tables: (["item_types", "items", "menus"] as const)
          .filter((table) => Array.isArray(data[table]))
          .map((table) => ({ table, rows: data[table]?.length ?? 0 })),
      });
      continue;
    }

    const parsed = parseMasterCsv(file.name, text);
    if ("problems" in parsed) {
      result.problems.push(...parsed.problems);
      continue;
    }
    append(parsed.data);
    result.files.push({
      name: file.name,
      tables: [{ table: parsed.table, rows: parsed.rows }],
    });
  }
  return result;
};

const escapeCsv = (value: string | number): string => {
  const str = String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

// Excel で開いたときに日本語が化けないよう BOM を付ける
const BOM = "﻿";

/**
 * 表ごとの CSV にする。そのまま Excel で直して取り込めるよう、取り込みと同じ見出しで書く。
 */
export const masterDataToCsv = (
  data: MasterData,
): Record<MasterTable, string> => {
  const toCsv = (header: readonly string[], rows: (string | number)[][]) => {
    const lines = [header, ...rows].map((row) => row.map(escapeCsv).join(","));
    return `${BOM}${lines.join("\r\n")}\r\n`;
  };

  return {
    item_types: toCsv(
      COLUMNS.item_types,
      (data.item_types ?? []).map((t) => [t.name, t.display_name]),
    ),
    items: toCsv(
      COLUMNS.items,
      (data.items ?? []).map((i) => [i.name, i.abbr, i.item_type]),
    ),
    menus: toCsv(
      COLUMNS.menus,
      (data.menus ?? []).map((m) => [
        m.key,
        m.name,
        m.abbr,
        m.price,
        formatMenuItems(m.items),
      ]),
    ),
  };
};
