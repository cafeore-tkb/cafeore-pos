import { type ItemType, MenuEntity, OrderEntity } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import { claimReceipt, formalReceipt, orderReceipt, yen } from "./receipt";

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

describe("[unit] yen", () => {
  test("金額は 3 桁区切り、負なら頭にマイナス", () => {
    expect(yen(1000)).toBe("￥1,000");
    expect(yen(-100)).toBe("-￥100");
  });
});

describe("[unit] orderReceipt", () => {
  test("同じ商品はまとめ、現金ならお預り・お釣りを載せる", () => {
    const order = createOrder();
    order.received = 1500;

    expect(orderReceipt(order, { method: "cash" })).toEqual({
      dateTime: "2026/11/07 10:23",
      orderNo: "No.123",
      items: [
        { label: "ブレンド", quantity: "x2", amount: "￥800" },
        { label: "アイスコーヒー", amount: "￥450" },
      ],
      adjustments: [],
      total: "￥1,250",
      payments: [
        { label: "お預り", amount: "￥1,500" },
        { label: "お釣り", amount: "￥250" },
      ],
      claimNumber: "123",
    });
  });

  test("割引があれば小計と割引を載せ、合計は割引後", () => {
    const order = createOrder();
    order.applyServiceOneCupDiscount();
    order.received = order.billingAmount;
    const receipt = orderReceipt(order, { method: "cash" });

    expect(receipt.adjustments).toEqual([
      { label: "小計", amount: "￥1,250" },
      { label: "割引", amount: "-￥100" },
    ]);
    expect(receipt.total).toBe("￥1,150");
  });

  test("Square なら決済手段と請求額を載せ、お預り・お釣りは載せない", () => {
    const order = createOrder();
    expect(
      orderReceipt(order, { method: "square", paymentType: "CARD_PRESENT" })
        .payments,
    ).toEqual([{ label: "クレジットカード", amount: "￥1,250" }]);

    for (const paymentType of [undefined, "CASH"]) {
      expect(
        orderReceipt(order, { method: "square", paymentType }).payments,
      ).toEqual([{ label: "キャッシュレス決済", amount: "￥1,250" }]);
    }
  });

  test("小計を金額で分けたら、先に払った分とあとで払う分を引いた額を合計にし、お釣りもその額から出す", () => {
    const order = createOrder();
    order.applyServiceOneCupDiscount();
    order.received = 500;
    const receipt = orderReceipt(
      order,
      { method: "cash" },
      { prepaid: 300, deferred: 400 },
    );

    expect(receipt.adjustments).toEqual([
      { label: "小計", amount: "￥1,250" },
      { label: "割引", amount: "-￥100" },
      { label: "先にお支払い済み", amount: "-￥300" },
      { label: "あとでお支払い", amount: "-￥400" },
    ]);
    expect(receipt.total).toBe("￥450");
    expect(receipt.payments).toEqual([
      { label: "お預り", amount: "￥500" },
      { label: "お釣り", amount: "￥50" },
    ]);
    expect(
      orderReceipt(
        order,
        { method: "square", paymentType: "FELICA_ALL" },
        { prepaid: 0, deferred: 850 },
      ).payments,
    ).toEqual([{ label: "電子マネー", amount: "￥300" }]);
  });

  test("一括で払うときは引換券番号を載せ、何回かに分けて払う 1 回分（split）には載せない", () => {
    const order = createOrder();
    order.received = order.billingAmount;

    expect(orderReceipt(order, { method: "cash" }).claimNumber).toBe("123");
    // 先にもあとにも払う額が無い 1 回分でも載せない
    for (const split of [
      { prepaid: 0, deferred: 0 },
      { prepaid: 300, deferred: 400 },
    ]) {
      expect(orderReceipt(order, { method: "cash" }, split)).not.toHaveProperty(
        "claimNumber",
      );
    }
  });
});

describe("[unit] claimReceipt", () => {
  test("日時・注文番号と、引換券番号を載せる", () => {
    expect(claimReceipt(createOrder())).toEqual({
      dateTime: "2026/11/07 10:23",
      orderNo: "No.123",
      claimNumber: "123",
    });
  });
});

describe("[unit] formalReceipt", () => {
  test("請求額・但し書き・注文を受けた日を載せる", () => {
    const order = createOrder();
    order.applyServiceOneCupDiscount();

    expect(formalReceipt(order)).toEqual({
      orderNo: "No.123",
      amount: "￥1,150-",
      note: "但し 飲食代として",
      date: "2026年11月7日",
    });
  });

  test("店舗控は同じ中身に店舗控の印を付ける", () => {
    const order = createOrder();
    order.applyServiceOneCupDiscount();

    expect(formalReceipt(order, { storeCopy: true })).toEqual({
      ...formalReceipt(order),
      copyMark: "店舗控",
    });
  });
});
