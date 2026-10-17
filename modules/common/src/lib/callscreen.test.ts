import { describe, expect, test } from "vitest";
import type { Cup } from "../models/cup";
import {
  type CallScreenBrewing,
  type CallScreenOrderInput,
  DRIP_INVITE_INTERVAL_MS,
  isCallOutOfOrder,
  planDripAnnouncement,
  splitCallScreenOrders,
} from "./callscreen";

const T0 = new Date("2026-10-08T03:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

const itemType = (
  flags: Partial<Cup["item"]["item_type"]> = {},
): Cup["item"]["item_type"] => ({
  name: "hot",
  display_name: "ホット",
  makes_cup: true,
  needs_brew: true,
  senior_only: false,
  iced_brew: false,
  needs_finishing: false,
  ...flags,
});
const blend = {
  id: "item-blend",
  name: "ブレンド",
  abbr: "ブ",
  item_type: itemType(),
};
// ミルクはカップを作るが抽出は要らない
const milk = {
  id: "item-milk",
  name: "アイスミルク",
  abbr: "ミ",
  item_type: itemType({ name: "milk", needs_brew: false }),
};

let seq = 0;
const cup = (init: Partial<Cup> = {}): Cup => ({
  id: `cup-${++seq}`,
  orderMenuId: "line-1",
  item: blend,
  readyAt: null,
  servedAt: null,
  dripper: null,
  dripperPosition: null,
  dripId: null,
  brewStartedAt: null,
  brewFinishedAt: null,
  deliveredAt: null,
  emergencies: [],
  ...init,
});

// ドリッパーに置いたカード（1 杯）
const queued = (dripper: number, init: Partial<Cup> = {}) =>
  cup({
    dripper,
    dripperPosition: 1,
    dripId: `drip-${++seq}`,
    ...init,
  });
const brewing = (dripper: number, init: Partial<Cup> = {}) =>
  queued(dripper, { brewStartedAt: T0, ...init });
const brewed = (dripper: number, init: Partial<Cup> = {}) =>
  brewing(dripper, { brewFinishedAt: at(3), ...init });

const order = (
  no: number,
  cups: Cup[],
  {
    createdAt = at(no),
    readyAt = null,
    servedAt = null,
  }: Partial<
    Pick<CallScreenOrderInput, "createdAt" | "readyAt" | "servedAt">
  > = {},
): CallScreenOrderInput => ({
  id: `order-${no}`,
  orderId: no,
  createdAt,
  readyAt,
  servedAt,
  menus: [{ orderMenuId: "line-1", dripper: null, assignee: null }],
  cups,
});

describe("[unit] 呼び出し画面の注文の分け方", () => {
  test("準備完了はお呼び出し中、淹れ始めたらドリップ中、それ以外は準備中。提供済みは出さない", () => {
    const result = splitCallScreenOrders([
      order(1, [cup()]),
      order(2, [queued(1)]),
      order(3, [brewing(2)]),
      order(4, [brewing(3)], { readyAt: at(10) }),
      order(5, [cup()], { readyAt: at(5), servedAt: at(6) }),
    ]);
    expect(result).toEqual({
      calling: [4],
      dripping: [{ orderId: 3, drippers: [2] }],
      // ドリッパーに置いただけ（待機）はまだ準備中
      preparing: [1, 2],
      // 準備完了の注文（4）のカードは、ドリップの案内に使わない
      brewing: [
        {
          key: expect.stringMatching(/@2$/),
          dripper: 2,
          orders: [{ id: "order-3", orderId: 3 }],
        },
      ],
    });
  });

  test("お呼び出し中は呼び出した時刻の新しい順", () => {
    const { calling } = splitCallScreenOrders([
      order(1, [cup()], { readyAt: at(20) }),
      order(2, [cup()], { readyAt: at(30) }),
      order(3, [cup()], { readyAt: at(10) }),
    ]);
    expect(calling).toEqual([2, 1, 3]);
  });

  test("準備中は注文した順", () => {
    const { preparing } = splitCallScreenOrders([
      order(3, [cup()], { createdAt: at(1) }),
      order(1, [cup()], { createdAt: at(3) }),
      order(2, [cup()], { createdAt: at(2) }),
    ]);
    expect(preparing).toEqual([3, 2, 1]);
  });

  test("ドリップ中は抽出中のドリッパーの順。淹れ終えて準備完了を待つ注文はドリッパーを出さずに最後", () => {
    const { dripping, preparing } = splitCallScreenOrders([
      order(1, [brewing(4)]),
      order(2, [brewed(1)]),
      // 1 杯目を淹れ終え、2 杯目が待機でも準備中に戻さない
      order(3, [brewed(5), queued(6)]),
      order(4, [brewing(1)]),
      // 2 杯を別のドリッパーで同時に淹れる
      order(5, [brewing(6), brewing(2)]),
    ]);
    expect(dripping).toEqual([
      { orderId: 4, drippers: [1] },
      { orderId: 5, drippers: [2, 6] },
      { orderId: 1, drippers: [4] },
      { orderId: 2, drippers: [] },
      { orderId: 3, drippers: [] },
    ]);
    expect(preparing).toEqual([]);
  });

  test("2 杯をまとめたカードは、両方の注文をドリップ中にする", () => {
    const dripId = "drip-merged";
    const { dripping } = splitCallScreenOrders([
      order(1, [brewing(3, { dripId })]),
      order(2, [brewing(3, { dripId })]),
    ]);
    expect(dripping).toEqual([
      { orderId: 1, drippers: [3] },
      { orderId: 2, drippers: [3] },
    ]);
  });

  test("抽出が要らないカップだけの注文は、準備完了になるまで準備中", () => {
    const { dripping, preparing } = splitCallScreenOrders([
      order(1, [cup({ item: milk })]),
    ]);
    expect(dripping).toEqual([]);
    expect(preparing).toEqual([1]);
  });
});

describe("[unit] 呼び出し画面の抽出中のカード（ドリップの案内）", () => {
  test("準備完了でない注文の抽出中のカードを、ドリッパーと注文の番号つきで返す", () => {
    const dripId = "drip-merged";
    const { brewing: cards } = splitCallScreenOrders([
      order(1, [brewing(3)]),
      // 2 つの注文を 1 枚のカードで淹れる
      order(5, [brewing(2, { dripId })]),
      order(4, [brewing(2, { dripId })]),
      // 待機・終わり・準備完了の注文のカードは入れない
      order(6, [queued(4)]),
      order(7, [brewed(5)]),
      order(8, [brewing(6)], { readyAt: at(20) }),
    ]);
    expect(
      cards.map(({ dripper, orders }) => ({
        dripper,
        orderIds: orders.map((o) => o.orderId),
      })),
    ).toEqual([
      { dripper: 2, orderIds: [4, 5] },
      { dripper: 3, orderIds: [1] },
    ]);
    expect(cards.find((card) => card.dripper === 2)?.key).toBe(`${dripId}@2`);
  });

  test("緊急（入れ直し）のカードは入れない", () => {
    const emergency = {
      id: "emergency-1",
      createdAt: T0,
      reason: "こぼした",
      dripper: 1,
      dripperPosition: 1,
      dripId: "drip-emergency",
      brewStartedAt: T0,
      brewFinishedAt: null,
      deliveredAt: null,
    };
    const { brewing: cards } = splitCallScreenOrders([
      order(1, [brewed(3, { emergencies: [emergency] })]),
    ]);
    expect(cards).toEqual([]);
  });
});

describe("[unit] 呼び出しの順番が前後するか", () => {
  test("先に注文した注文がまだ待っていれば前後する", () => {
    const orders = [order(1, [cup()]), order(2, [cup()], { readyAt: at(10) })];
    expect(isCallOutOfOrder(orders, 2)).toBe(true);
  });

  test("先の注文が呼び出し中・提供済みなら前後しない。後から注文した注文が待っていても前後しない", () => {
    const orders = [
      order(1, [cup()], { readyAt: at(8) }),
      order(2, [cup()], { readyAt: at(9), servedAt: at(10) }),
      order(3, [cup()], { readyAt: at(10) }),
      order(4, [cup()]),
    ];
    expect(isCallOutOfOrder(orders, 3)).toBe(false);
  });

  test("前の日の待ったままの注文は見ない", () => {
    const yesterday = new Date(T0.getTime() - 24 * 60 * 60 * 1000);
    const orders = [
      order(9, [cup()], { createdAt: yesterday }),
      order(2, [cup()], { readyAt: at(10) }),
    ];
    expect(isCallOutOfOrder(orders, 2)).toBe(false);
  });

  test("同じ番号が前の日にもあれば、今日の呼び出し中の注文で決める", () => {
    const yesterday = new Date(T0.getTime() - 24 * 60 * 60 * 1000);
    const orders = [
      order(1, [cup()], { createdAt: new Date(yesterday.getTime() - 60_000) }),
      {
        ...order(2, [cup()], { createdAt: yesterday, readyAt: yesterday }),
        id: "order-2-yesterday",
      },
      order(2, [cup()], { readyAt: at(10) }),
    ];
    expect(isCallOutOfOrder(orders, 2)).toBe(false);
  });

  test("呼び出し中でない番号は前後しない", () => {
    expect(isCallOutOfOrder([order(1, [cup()]), order(2, [cup()])], 2)).toBe(
      false,
    );
  });
});

describe("[unit] ドリップの案内の流し方", () => {
  const card = (
    dripper: number,
    ...orders: [string, number][]
  ): CallScreenBrewing => ({
    key: `card-${orders.map(([id]) => id).join("+")}@${dripper}`,
    dripper,
    orders: orders.map(([id, orderId]) => ({ id, orderId })),
  });
  const NOW = T0.getTime();

  test("はじめての注文は「よろしければ…」を付けて流す", () => {
    expect(
      planDripAnnouncement(card(1, ["a", 12]), new Set(), null, NOW),
    ).toEqual({ orders: [{ id: "a", orderId: 12 }], invite: true });
  });

  test("もう案内した注文は流さない。統合したカードは、まだの注文だけを読む", () => {
    const announced = new Set(["a"]);
    expect(planDripAnnouncement(card(3, ["a", 12]), announced, null, NOW)).toBe(
      null,
    );
    expect(
      planDripAnnouncement(card(3, ["a", 12], ["b", 13]), announced, null, NOW),
    ).toEqual({ orders: [{ id: "b", orderId: 13 }], invite: true });
  });

  test("「よろしければ…」を付けてから 1 分以内は省き、1 分たてばまた付ける", () => {
    const last = NOW - DRIP_INVITE_INTERVAL_MS + 1;
    expect(
      planDripAnnouncement(card(2, ["b", 13]), new Set(), last, NOW)?.invite,
    ).toBe(false);
    expect(
      planDripAnnouncement(
        card(2, ["b", 13]),
        new Set(),
        NOW - DRIP_INVITE_INTERVAL_MS,
        NOW,
      )?.invite,
    ).toBe(true);
  });
});
