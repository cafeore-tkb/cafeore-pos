import { type Order, orderRepository } from "@cafeore/common";
import { Button } from "../ui/button";

export async function getOrders() {
  const orderEntities = await orderRepository.findAll();
  return orderEntities.map((order) => order.toOrder());
}

export function DownloadButton() {
  // CSV用に文字列をエスケープ
  const escapeCSV = (value: unknown): string => {
    if (value == null) return "";
    const str = String(value);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // 日付＋時刻をファイル名に使う
  const getTimestamp = (): string => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return `${date}_${time}`;
  };

  // ordersからCSVを生成してダウンロード
  const downloadOrdersCsv = async () => {
    const orders = await getOrders();
    const headers = Object.keys(orders[0]) as (keyof Order)[];

    console.log(headers);

    const formatDate = (value?: null | Date) => {
      if (!value) return "";
      const d = new Date(value);
      const yyyy = d.getFullYear();
      const M = d.getMonth() + 1;
      const dd = d.getDate();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      return `${yyyy}/${M}/${dd} ${hh}:${mm}:${ss}`;
    };

    const sortedOrders = [...orders].sort((a, b) => {
      return a.orderId - b.orderId;
    });

    const rows = sortedOrders.map((o) => {
      const values = headers.map((key) => {
        let value = o[key];
        // 日付をフォーマット
        if (value instanceof Date) value = formatDate(value);
        // items や comments は文字列化
        if (Array.isArray(value))
          value = value.map((v) => JSON.stringify(v)).join("; ");
        return escapeCSV(value);
      });
      return values.join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

    const timestamp = getTimestamp();
    const filename = `orders-${timestamp}.csv`;

    // ブラウザでダウンロード
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const downloadOrdersJson = async () => {
    const orders = await getOrders();
    const output = { orders };
    const blob = new Blob([JSON.stringify(output, null, 2)], {
      type: "text/json",
    });

    const timestamp = getTimestamp();
    const filename = `orders-${timestamp}.json`;

    // ブラウザでダウンロード
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
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
