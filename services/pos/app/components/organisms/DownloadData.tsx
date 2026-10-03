import {
  type MasterState,
  type OrderEntity,
  getMasterState,
  orderRepository,
} from "@cafeore/common";
import { Button } from "../ui/button";

async function getSortedOrders() {
  const orders = await orderRepository.findAll();
  return orders.sort((a, b) => a.orderId - b.orderId);
}

async function getSortedMasterStates() {
  const states = await getMasterState();
  return states.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

// CSV用に文字列をエスケープ
const escapeCSV = (value: unknown): string => {
  if (value == null) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const formatDate = (value: Date | null) => {
  if (!value) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${value.getFullYear()}/${value.getMonth() + 1}/${value.getDate()} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
};

// 日付＋時刻をファイル名に使う
const getTimestamp = (): string => {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${date}_${time}`;
};

type CsvColumns<T> = [string, (row: T) => unknown][];

// Excel で開いたときに日本語が化けないよう BOM を付ける
const BOM = "\uFEFF";

const downloadCsv = <T,>(columns: CsvColumns<T>, rows: T[], name: string) => {
  const header = columns.map(([column]) => column).join(",");
  const lines = rows.map((row) =>
    columns.map(([, get]) => escapeCSV(get(row))).join(","),
  );
  downloadBlob(
    new Blob([BOM + [header, ...lines].join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    }),
    `${name}-${getTimestamp()}.csv`,
  );
};

const downloadJson = (data: unknown, name: string) => {
  downloadBlob(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    `${name}-${getTimestamp()}.json`,
  );
};

const downloadBlob = (blob: Blob, filename: string) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
};

// API が返す注文の項目を 1 注文 1 行で書き出す
const ORDER_CSV_COLUMNS: CsvColumns<OrderEntity> = [
  ["id", (o) => o.id],
  ["orderId", (o) => o.orderId],
  ["createdAt", (o) => formatDate(o.createdAt)],
  ["readyAt", (o) => formatDate(o.readyAt)],
  ["servedAt", (o) => formatDate(o.servedAt)],
  [
    "menus",
    (o) => o.menus.map((m) => `${m.name}(${m.assignee ?? "なし"})`).join("; "),
  ],
  ["cups", (o) => o.getDrinkCups().length],
  ["total", (o) => o.total],
  ["discount", (o) => o.discount],
  ["billingAmount", (o) => o.billingAmount],
  ["received", (o) => o.received],
  ["discountOrderId", (o) => o.discountOrderId],
  ["discountOrderCups", (o) => o.discountOrderCups],
  [
    "comments",
    (o) => o.comments.map((c) => `${c.author}: ${c.text}`).join("; "),
  ],
];

const MASTER_STATE_LABELS: Record<string, string> = {
  stop: "中止",
  operational: "再開",
};

// オーダーストップ・再開の切り替えを 1 回 1 行で書き出す
const MASTER_STATE_CSV_COLUMNS: CsvColumns<MasterState> = [
  ["createdAt", (s) => formatDate(new Date(s.createdAt))],
  ["type", (s) => s.type],
  ["label", (s) => MASTER_STATE_LABELS[s.type] ?? ""],
];

export function DownloadButton() {
  const downloadOrdersCsv = async () => {
    downloadCsv(ORDER_CSV_COLUMNS, await getSortedOrders(), "orders");
  };

  // ダッシュボードの「過去のデータを読み込む」で読める形式で書き出す
  const downloadOrdersJson = async () => {
    const orders = await getSortedOrders();
    downloadJson({ orders: orders.map((order) => order.toOrder()) }, "orders");
  };

  return (
    <>
      <Button className="m-2" onClick={downloadOrdersJson}>
        JSONファイル
      </Button>
      <Button className="m-2" onClick={downloadOrdersCsv}>
        CSVファイル
      </Button>
    </>
  );
}

export function DownloadMasterStateButton() {
  const downloadCsvFile = async () => {
    downloadCsv(
      MASTER_STATE_CSV_COLUMNS,
      await getSortedMasterStates(),
      "order-stops",
    );
  };

  const downloadJsonFile = async () => {
    downloadJson(
      { masterStates: await getSortedMasterStates() },
      "order-stops",
    );
  };

  return (
    <>
      <Button className="m-2" onClick={downloadJsonFile}>
        JSONファイル
      </Button>
      <Button className="m-2" onClick={downloadCsvFile}>
        CSVファイル
      </Button>
    </>
  );
}
