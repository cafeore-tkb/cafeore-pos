import { describe, expect, test } from "vitest";
import type { Cup } from "../models/cup";
import { type CallScreenOrderInput, splitCallScreenOrders } from "./callscreen";

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
