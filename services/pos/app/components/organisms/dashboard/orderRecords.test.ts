import { type Order, OrderEntity, type WithId } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import {
  filterOrderRecords,
  normalize,
  orderRecordPage,
  orderServiceTime,
  refundSections,
} from "./orderRecords";
const at = new Date("2026-10-18T01:00:00Z");
const saved = (orderId: number, fields: Partial<Order> = {}) =>
  OrderEntity.fromOrder({
    ...OrderEntity.createNew({ orderId }).toOrder(),
    id: `record-${orderId}`,
    createdAt: at,
    paymentMethod: "cash",
    comments: [
      { author: "cashier", text: "ケニア ｻﾄｳ ミルク別", createdAt: at },
    ],
    ...fields,
  } as WithId<Order>);

describe("注文記録の検索", () => {
  test("全半角と英字の大小を揃える", () => {
    expect(normalize("ＡＢＣ１２３ ｻﾄｳ")).toBe("abc123 サトウ");
    expect(filterOrderRecords([saved(123)], "＃１２３", "すべて")).toHaveLength(
      1,
    );
    expect(filterOrderRecords([saved(1)], "#001", "すべて")).toHaveLength(1);
    expect(
      filterOrderRecords([saved(123)], "ＲＥＣＯＲＤ-１２３", "すべて"),
    ).toHaveLength(1);
  });
  test("空白区切りはANDでコメントも探せる。空検索は全件", () => {
    const records = [saved(1), saved(2, { comments: [] })];
    expect(
      filterOrderRecords(records, " ケニア　サトウ ", "すべて").map(
        (o) => o.orderId,
      ),
    ).toEqual([1]);
    expect(filterOrderRecords(records, "ケニア アイス", "すべて")).toEqual([]);
    expect(filterOrderRecords(records, "  ", "すべて")).toHaveLength(2);
  });
  test("商品・構成品・指名も検索対象", () => {
    const o = saved(1, {
      menus: [
        {
          id: "menu1",
          name: "コーヒーセット",
          abbr: "セ",
          price: 500,
          key: "c",
          priority: 0,
          assignee: "山田",
          dripper: 2,
          items: [
            {
              quantity: 1,
              item: {
                id: "item1",
                name: "ブレンド",
                abbr: "ブ",
                item_type: {
                  name: "hot",
                  display_name: "ホット",
                  makes_cup: true,
                  needs_brew: true,
                  senior_only: false,
                  iced_brew: false,
                },
              },
            },
          ],
        },
      ],
    });
    expect(
      filterOrderRecords([o], "セット ブレンド 山田 ２番", "すべて"),
    ).toHaveLength(1);
  });
  test("キャンセルを含み、状態で絞る。キャンセルは提供済みより優先", () => {
    const records = [
      saved(1),
      saved(2, { readyAt: at }),
      saved(3, { servedAt: at }),
      saved(4, { cancelledAt: at, servedAt: at }),
    ];
    expect(filterOrderRecords(records, "", "すべて")).toHaveLength(4);
    for (const [status, id] of [
      ["準備中", 1],
      ["お渡し待ち", 2],
      ["提供済み", 3],
      ["キャンセル", 4],
    ] as const)
      expect(
        filterOrderRecords(records, "", status).map((o) => o.orderId),
      ).toEqual([id]);
  });
  test("新しい受付順、同時刻は番号降順。入力配列は変更しない", () => {
    const records = [
      saved(1),
      saved(3),
      saved(2, { createdAt: new Date(at.getTime() + 1000) }),
    ];
    expect(
      filterOrderRecords(records, "", "すべて").map((o) => o.orderId),
    ).toEqual([2, 3, 1]);
    expect(records.map((o) => o.orderId)).toEqual([1, 3, 2]);
  });
  test("30件でページを分け、結果が減ったら末尾へ収める。0件・負のページも扱う", () => {
    const records = Array.from({ length: 61 }, (_, i) => i);
    expect(orderRecordPage(records, 0).shown).toEqual(records.slice(0, 30));
    expect(orderRecordPage(records, 1).shown).toEqual(records.slice(30, 60));
    expect(orderRecordPage(records, 2)).toEqual({
      lastPage: 2,
      shownPage: 2,
      shown: [60],
    });
    expect(orderRecordPage([1], 2)).toEqual({
      lastPage: 0,
      shownPage: 0,
      shown: [1],
    });
    expect(orderRecordPage([], 1)).toEqual({
      lastPage: 0,
      shownPage: 0,
      shown: [],
    });
    expect(orderRecordPage(records, -1).shownPage).toBe(0);
  });
});

describe("返金欄の表示対象", () => {
  test("現金には現金返金のみ、SquareにはSquare返金のみ", () => {
    expect(refundSections(saved(1))).toEqual({ cash: true, square: false });
    expect(refundSections(saved(1, { squareRefundStatus: "none" }))).toEqual({
      cash: true,
      square: false,
    });
    expect(refundSections(saved(1, { paymentMethod: "square" }))).toEqual({
      cash: false,
      square: true,
    });
  });
  test("旧記録のSquare返金と、現金・Square混在の個別会計を取りこぼさない", () => {
    expect(
      refundSections(saved(1, { squareRefundStatus: "refunded" })).square,
    ).toBe(true);
    const payment = {
      amount: 100,
      received: 100,
      discount: 0,
      menuIndexes: [],
    };
    expect(
      refundSections(
        saved(1, {
          payments: [
            { ...payment, method: "cash" },
            { ...payment, method: "square" },
          ],
        }),
      ),
    ).toEqual({ cash: true, square: true });
  });
});

describe("注文一覧の提供時間", () => {
  test("受付→提供完了を分秒で出し、15分を超えた場合だけ赤字対象にする", () => {
    expect(
      orderServiceTime(
        saved(1, { servedAt: new Date(at.getTime() + 15 * 60000) }),
      ),
    ).toEqual({ label: "15分00秒", overdue: false });
    expect(
      orderServiceTime(
        saved(1, { servedAt: new Date(at.getTime() + 15 * 60000 + 1000) }),
      ),
    ).toEqual({ label: "15分01秒", overdue: true });
    expect(orderServiceTime(saved(1, { servedAt: at }))).toEqual({
      label: "0分00秒",
      overdue: false,
    });
    expect(orderServiceTime(saved(1))).toEqual({ label: "—", overdue: false });
    expect(
      orderServiceTime(saved(1, { servedAt: new Date(at.getTime() - 1) })),
    ).toEqual({ label: "—", overdue: false });
  });
});
