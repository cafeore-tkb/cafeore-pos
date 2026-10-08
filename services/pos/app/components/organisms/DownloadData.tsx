import {
  type MasterState,
  type OrderEntity,
  formatCsv,
  getMasterState,
  orderRepository,
} from "@cafeore/common";
import dayjs from "dayjs";
import { downloadBlob } from "~/lib/download";
import { Button } from "../ui/button";

async function getSortedOrders() {
  const orders = await orderRepository.findAll();
  return orders.sort((a, b) => a.orderId - b.orderId);
}

// createdAt が空・不正な記録は末尾に寄せる
const timeOf = (value: string) => {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
};

async function getSortedMasterStates() {
  const states = await getMasterState();
  return states.sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt));
}

const formatDate = (value: Date | string | null) => {
  const date = dayjs(value);
  return date.isValid() ? date.format("YYYY/M/D HH:mm:ss") : "";
};

// 日付＋時刻をファイル名に使う
const getTimestamp = () => dayjs().format("YYYY-MM-DD_HH-mm-ss");

type CsvColumns<T> = [string, (row: T) => unknown][];

const downloadCsv = <T,>(columns: CsvColumns<T>, rows: T[], name: string) => {
  const csv = formatCsv(
    columns.map(([column]) => column),
    rows.map((row) =>
      Object.fromEntries(columns.map(([column, get]) => [column, get(row)])),
    ),
  );
  downloadBlob(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    `${name}-${getTimestamp()}.csv`,
  );
};

const downloadJson = (data: unknown, name: string) => {
  downloadBlob(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    `${name}-${getTimestamp()}.json`,
  );
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
  // サーバーが作ったカップの数（カップの無い古い注文はメニューから数える）
  ["cups", (o) => o.getCups().length],
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
  ["createdAt", (s) => formatDate(s.createdAt)],
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
