import { type ItemType, MenuEntity, OrderEntity } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import type { PrintJob, TextLine } from "./document";
import {
  RECEIPT_COLUMNS,
  displayWidth,
  formalReceiptJob,
  orderReceiptJob,
  padLine,
  yen,
} from "./receipt";

const hotType: ItemType = {
  id: "1",
  name: "hot",
  display_name: "ホット",
  makes_cup: true,
  needs_brew: true,
  senior_only: false,
  iced_brew: false,
};

const menu = (id: string, name: string, price: number) =>
  MenuEntity.fromMenu({
    id,
    name,
    abbr: name,
    price,
    key: id,
    item_type: hotType,
    assignee: null,
  });

// 2026-11-07 10:23（日本時間）に受けた No.123
const createOrder = () => {
  const order = OrderEntity.fromOrder({
    ...OrderEntity.createNew({ orderId: 123 }).toOrder(),
    createdAt: new Date("2026-11-07T10:23:45+09:00"),
  });
  order.menus = [
    menu("1", "ブレンド", 400),
    menu("2", "アイスコーヒー", 450),
    menu("1", "ブレンド", 400),
  ];
  return order;
};

/** 中央寄せの flow 1 枚であることを確かめ、その行を返す */
const linesOf = (job: PrintJob): readonly TextLine[] => {
  expect(job.labels).toHaveLength(1);
  const [label] = job.labels;
  if (label.type !== "flow") throw new Error("flow ではない");
  expect(label.align).toBe("center");
  return label.lines;
};

const textOf = (line: TextLine) => line.map((run) => run.text).join("");
const texts = (job: PrintJob) => linesOf(job).map(textOf);

describe("[unit] receipt layout", () => {
  test("全角は 2 桁、半角と半角カナは 1 桁で数える", () => {
    expect(displayWidth("No.123")).toBe(6);
    expect(displayWidth("ブレンド")).toBe(8);
    expect(displayWidth("ｱｲｽ")).toBe(3);
    expect(displayWidth("￥1,000")).toBe(7);
  });

  test("左右に置き、ちょうど 1 行の桁数にする", () => {
    const line = padLine("合計", "￥850");
    expect(line).toBe(`合計${" ".repeat(23)}￥850`);
    expect(displayWidth(line)).toBe(RECEIPT_COLUMNS);
    expect(displayWidth(padLine("No.1"))).toBe(RECEIPT_COLUMNS);
  });

  test("入りきらない名前は後ろを切り、金額は切らない", () => {
    const line = padLine("とても長い商品名がレシートの幅を超える", "￥1,000");
    expect(line.endsWith(" ￥1,000")).toBe(true);
    expect(line.startsWith("とても長い商品名がレシ")).toBe(true);
    expect(displayWidth(line)).toBeLessThanOrEqual(RECEIPT_COLUMNS);
  });

  test("金額は 3 桁区切り、負なら頭にマイナス", () => {
    expect(yen(1000)).toBe("￥1,000");
    expect(yen(-100)).toBe("-￥100");
  });
});

describe("[unit] orderReceiptJob", () => {
  test("同じ商品はまとめ、現金ならお預り・お釣りを載せる", () => {
    const order = createOrder();
    order.received = 1500;
    const job = orderReceiptJob(order, { method: "cash" });

    expect(texts(job)).toEqual([
      "珈琲・俺",
      "",
      padLine("2026/11/07 10:23", "No.123"),
      "-".repeat(RECEIPT_COLUMNS),
      padLine("ブレンド x2", "￥800"),
      padLine("アイスコーヒー", "￥450"),
      "-".repeat(RECEIPT_COLUMNS),
      padLine("合計", "￥1,250"),
      padLine("お預り", "￥1,500"),
      padLine("お釣り", "￥250"),
      "",
      expect.stringContaining("ありがとうございました"),
    ]);
    const lines = linesOf(job);
    expect(lines[0][0].size).toEqual([2, 2]);
    expect(lines[7][0].size).toEqual([1, 2]);
    // 中央寄せで刷るので、横 2 倍の行と空行のほかは全部同じ幅にそろえる
    for (const line of lines) {
      if (line.length > 0 && line[0].size[0] === 1) {
        expect(displayWidth(textOf(line))).toBe(RECEIPT_COLUMNS);
      }
    }
  });

  test("割引があれば小計と割引を載せる", () => {
    const order = createOrder();
    order.applyServiceOneCupDiscount();
    order.received = order.billingAmount;
    const lines = texts(orderReceiptJob(order, { method: "cash" }));

    expect(lines).toContain(padLine("小計", "￥1,250"));
    expect(lines).toContain(padLine("割引", "-￥100"));
    expect(lines).toContain(padLine("合計", "￥1,150"));
  });

  test("Square なら決済手段と請求額を載せ、お預り・お釣りは載せない", () => {
    const order = createOrder();
    const card = texts(
      orderReceiptJob(order, { method: "square", paymentType: "CARD_PRESENT" }),
    );
    expect(card).toContain(padLine("クレジットカード", "￥1,250"));
    expect(card.some((line) => line.startsWith("お預り"))).toBe(false);
    expect(card.some((line) => line.startsWith("お釣り"))).toBe(false);

    for (const paymentType of [undefined, "CASH"]) {
      expect(
        texts(orderReceiptJob(order, { method: "square", paymentType })),
      ).toContain(padLine("キャッシュレス決済", "￥1,250"));
    }
  });
});

describe("[unit] formalReceiptJob", () => {
  test("宛名は空け、請求額・但し書き・日付・発行者を載せる", () => {
    const order = createOrder();
    order.applyServiceOneCupDiscount();
    const job = formalReceiptJob(order);

    expect(texts(job)[0]).toBe("領収書");
    expect(texts(job)).toEqual(
      expect.arrayContaining([
        padLine("", "No.123"),
        padLine("_".repeat(RECEIPT_COLUMNS - 4), "様"),
        "￥1,150-",
        padLine("但し お品代として"),
        padLine("2026年11月7日"),
        padLine("", "珈琲・俺"),
      ]),
    );
    const amount = linesOf(job).find((line) => textOf(line) === "￥1,150-");
    expect(amount?.[0].size).toEqual([2, 2]);
  });
});
