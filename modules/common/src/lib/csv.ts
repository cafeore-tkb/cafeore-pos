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

const escapeCsv = (value: unknown): string => {
  const str = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

// Excel で開いたときに日本語が化けないよう BOM を付ける
const BOM = "﻿";

/**
 * 見出しと行から CSV を作る。行に無い列は空にする。
 */
export const formatCsv = (
  header: readonly string[],
  rows: Record<string, unknown>[],
): string => {
  const lines = [
    header.map(escapeCsv).join(","),
    ...rows.map((row) =>
      header.map((column) => escapeCsv(row[column])).join(","),
    ),
  ];
  return `${BOM}${lines.join("\r\n")}\r\n`;
};
