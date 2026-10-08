import { describe, expect, test } from "vitest";
import type { ItemType } from "../models/item";
import {
  type CaosCard,
  assignWrites,
  buildCaosCards,
  caosDay,
  caosLane,
  mergeWrites,
  unassignWrites,
} from "./caos-board";
import {
  type CaosPracticeOrder,
  advanceCaosPracticeDripper,
  applyCaosPracticeWrites,
  practiceItemType,
  toCaosPracticeOrder,
} from "./caosPractice";
import type { PracticeDataOrder } from "./caosPracticeData";

// 作りものの注文（本物のデータは入れない）
const T0 = new Date("2025-11-02T03:00:00.000Z"); // 日本時間 12:00
const DAY = caosDay(T0);
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

const dbTypes: ItemType[] = [
  {
    id: "t-hot",
    name: "hot",
    display_name: "ホット",
    makes_cup: true,
    needs_brew: true,
    senior_only: false,
  },
  {
    id: "t-milk",
    name: "milk",
    display_name: "ミルク",
    makes_cup: true,
    needs_brew: false,
    senior_only: false,
  },
  {
    id: "t-others",
    name: "others",
    display_name: "グッズ",
    makes_cup: false,
    needs_brew: false,
    senior_only: false,
  },
];

const dataOrder = (
  orderId: number,
  items: { name: string; type: string }[],
): PracticeDataOrder => ({
  orderId,
  createdAt: T0.toISOString(),
  readyAt: null,
  servedAt: null,
  total: 0,
  billingAmount: 0,
  items: items.map((item) => ({ id: "", price: 500, ...item })),
});

const hot = { name: "テストブレンド", type: "hot" };

let seq = 0;
const newId = () => `drip-${++seq}`;

const cardsOf = (orders: CaosPracticeOrder[]) => buildCaosCards(orders, DAY);
const unassigned = (orders: CaosPracticeOrder[]) =>
  cardsOf(orders).filter((card) => card.status === "unassigned");

const apply = (
  orders: CaosPracticeOrder[],
  result: ReturnType<typeof assignWrites>,
  now: Date,
) => {
  if ("error" in result) throw new Error(result.error);
  const applied = applyCaosPracticeWrites(orders, result.writes, now);
  if (applied.error !== undefined) throw new Error(applied.error);
  return applied.orders;
};

const assign = (
  orders: CaosPracticeOrder[],
  card: CaosCard,
  dripper: number,
  now: Date,
) =>
  apply(orders, assignWrites(cardsOf(orders), card, dripper, { newId }), now);

describe("unit: 練習の注文", () => {
  test("種類は DB の今の種類 → データの種類の設定 → 既定（抽出が要る）の順に決める", () => {
    expect(practiceItemType({ type: "milk" }, dbTypes)).toMatchObject({
      source: "db",
      itemType: { name: "milk", needs_brew: false },
    });
    const fromData = {
      type: "seasonal",
      itemType: {
        display_name: "季節",
        makes_cup: true,
        needs_brew: false,
        senior_only: true,
      },
    };
    expect(practiceItemType(fromData, dbTypes)).toMatchObject({
      source: "data",
      itemType: { name: "seasonal", needs_brew: false, senior_only: true },
    });
    // DB の今の種類があればそちらを使う（今の決まりで練習する）
    expect(
      practiceItemType({ ...fromData, type: "hot" }, dbTypes),
    ).toMatchObject({ source: "db", itemType: { needs_brew: true } });
    expect(practiceItemType({ type: "" }, dbTypes)).toMatchObject({
      source: "default",
      itemType: {
        display_name: "種類なし",
        makes_cup: true,
        needs_brew: true,
        senior_only: false,
      },
    });
  });

  test("カップを作る品物だけをカップにし、抽出の要らないカップはカードにならない", () => {
    const order = toCaosPracticeOrder(
      dataOrder(12, [
        hot,
        { name: "アイスミルク", type: "milk" },
        { name: "トート", type: "others" },
        hot,
        hot,
      ]),
      0,
      dbTypes,
    );
    expect(order.cups.map((cup) => cup.item.name)).toStrictEqual([
      "テストブレンド",
      "アイスミルク",
      "テストブレンド",
      "テストブレンド",
    ]);
    expect(order.menus.every((menu) => menu.assignee === null)).toBe(true);
    // 3 杯は 2 杯と 1 杯のカードに分かれる（本番と同じ buildCaosCards）
    expect(cardsOf([order]).map((card) => card.cups.length)).toStrictEqual([
      2, 1,
    ]);
  });
});

describe("unit: 練習の盤面の操作（本番と同じ決まり）", () => {
  const start = () =>
    [
      dataOrder(1, [hot]),
      dataOrder(2, [hot]),
      dataOrder(3, [hot, hot]),
      dataOrder(4, [{ name: "アイスミルク", type: "milk" }]),
    ].map((order, index) => toCaosPracticeOrder(order, index, dbTypes));

  test("割当（空いていればそのまま抽出）・待機・次へ", () => {
    let orders = start();
    const [first, second] = unassigned(orders);
    orders = assign(orders, first, 1, at(0));
    expect(caosLane(cardsOf(orders), 1).brewing?.startedAt).toStrictEqual(
      at(0),
    );
    orders = assign(orders, second, 1, at(10));
    expect(caosLane(cardsOf(orders), 1).queued).toHaveLength(1);

    // 画面が抽出中と見ているカードと違えば断る
    expect(
      advanceCaosPracticeDripper(orders, 1, null, at(100)).error,
    ).toContain("抽出中のカードがあります");
    const brewing = caosLane(cardsOf(orders), 1).brewing;
    const advanced = advanceCaosPracticeDripper(
      orders,
      1,
      brewing?.dripId ?? null,
      at(140),
    );
    if (advanced.error !== undefined) throw new Error(advanced.error);
    orders = advanced.orders;
    const lane = caosLane(cardsOf(orders), 1);
    expect(lane.done.map((card) => card.finishedAt)).toStrictEqual([at(140)]);
    expect(lane.done[0].cups[0].readyAt).toStrictEqual(at(140));
    expect(lane.brewing?.orderNo).toBe(2);
    expect(lane.brewing?.startedAt).toStrictEqual(at(140));
    expect(lane.queued).toHaveLength(0);
    // 元の注文は変えない
    expect(start()[0].cups[0].dripper).toBeNull();
  });

  test("抽出中のカードは動かせず、待機は未割当に戻せる", () => {
    let orders = start();
    const [first, second] = unassigned(orders);
    orders = assign(orders, first, 2, at(0));
    orders = assign(orders, second, 2, at(1));
    const lane = caosLane(cardsOf(orders), 2);
    if (!lane.brewing) throw new Error("no brewing");
    // 古いカード（抽出を始める前の値）で書くと、本番と同じく断る
    const stale = assignWrites(cardsOf(start()), first, 3, { newId });
    if ("error" in stale) throw new Error(stale.error);
    expect(
      applyCaosPracticeWrites(orders, stale.writes, at(2)).error,
    ).toContain("ほかの端末で先に変わりました");
    expect(
      assignWrites(cardsOf(orders), lane.brewing, 3, { newId }),
    ).toStrictEqual({ error: "抽出中・終了のカードは動かせません" });

    orders = apply(orders, unassignWrites(lane.queued[0]), at(3));
    expect(caosLane(cardsOf(orders), 2).queued).toHaveLength(0);
    expect(unassigned(orders).map((card) => card.orderNo)).toContain(2);
  });

  test("1 杯どうしを統合し、2 杯のカードとしてドリッパーに置ける", () => {
    let orders = start();
    const [first, second] = unassigned(orders);
    orders = apply(orders, mergeWrites(first, second, newId), at(0));
    const merged = unassigned(orders).find((card) => card.cups.length === 2);
    expect(merged?.cups.map((cup) => cup.orderNo)).toStrictEqual([1, 2]);
    if (!merged) throw new Error("not merged");
    orders = assign(orders, merged, 4, at(5));
    expect(caosLane(cardsOf(orders), 4).brewing?.cups).toHaveLength(2);
  });

  test("決まりに合わない書き込みは何も変えずに断る", () => {
    const orders = start();
    const milkCup = orders[3].cups[0];
    const before = {
      dripper: null,
      dripper_position: null,
      drip_id: null,
      brew_started_at: null,
      brew_finished_at: null,
    };
    expect(
      applyCaosPracticeWrites(
        orders,
        [
          {
            cup_ids: [milkCup.id],
            before,
            after: {
              dripper: 1,
              dripper_position: 4,
              drip_id: "x",
              start_brew: false,
            },
          },
        ],
        at(0),
      ).error,
    ).toBe("抽出の要らないカップ（アイスミルク）はドリッパーに置けません");
    // 3 杯を 1 枚のカードにはできない
    const three = [orders[0].cups[0], ...orders[2].cups].map((cup) => cup.id);
    expect(
      applyCaosPracticeWrites(
        orders,
        [
          {
            cup_ids: three,
            before,
            after: {
              dripper: null,
              dripper_position: null,
              drip_id: "y",
              start_brew: false,
            },
          },
        ],
        at(0),
      ).error,
    ).toBe("1 枚のカードは 2 杯までです");
    expect(orders[0].cups[0].dripId).toBeNull();
  });
});
