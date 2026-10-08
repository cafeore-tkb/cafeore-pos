import { describe, expect, test } from "vitest";
import {
  type CaosCard,
  type CaosCupsWrite,
  type CaosPlace,
  type CaosWritesResult,
  assignWrites,
  buildCaosCards,
  caosLane,
  mergeWrites,
  unassignWrites,
} from "./caos-board";
import {
  type CaosPracticeOrder,
  type CaosPracticeSourceItem,
  type CaosPracticeSourceOrder,
  advanceCaosPracticeDripper,
  applyCaosPracticeWrites,
  toCaosPracticeOrder,
} from "./caosPractice";
import { jstDate } from "./jst";

// 作りものの注文（本物のデータは入れない）
const T0 = new Date("2025-11-02T03:00:00.000Z"); // 日本時間 12:00
const DAY = jstDate(T0.getTime());
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

const dataOrder = (
  orderId: number,
  items: CaosPracticeSourceItem[],
): CaosPracticeSourceOrder => ({
  orderId,
  createdAt: T0.toISOString(),
  items,
});

const hot = { name: "テストブレンド", type: "hot" };
const milk = { name: "テストミルク", type: "milk" };
const goods = { name: "トート", type: "others" };
const limited = { name: "テスト限定", type: "limited" };

let seq = 0;
const newId = () => `drip-${++seq}`;

const ordersOf = (...items: CaosPracticeSourceItem[][]) =>
  items.map((list, index) =>
    toCaosPracticeOrder(dataOrder(index + 1, list), index),
  );
const cardsOf = (orders: CaosPracticeOrder[]) => buildCaosCards(orders, DAY);
const unassigned = (orders: CaosPracticeOrder[]) =>
  cardsOf(orders).filter((card) => card.status === "unassigned");
const queuedOrderNos = (orders: CaosPracticeOrder[], dripper: number) =>
  caosLane(cardsOf(orders), dripper).queued.map((card) => card.orderNo);

const writesOf = (result: CaosWritesResult) => {
  if ("error" in result) throw new Error(result.error);
  return result.writes;
};

const apply = (
  orders: CaosPracticeOrder[],
  result: CaosWritesResult,
  now: Date,
) => {
  const applied = applyCaosPracticeWrites(orders, writesOf(result), now);
  if (applied.error !== undefined) throw new Error(applied.error);
  return applied.orders;
};

const assign = (
  orders: CaosPracticeOrder[],
  card: CaosCard,
  dripper: number,
  now: Date,
  place?: CaosPlace,
) =>
  apply(
    orders,
    assignWrites(cardsOf(orders), card, dripper, { place, newId }),
    now,
  );

const UNPLACED: CaosCupsWrite["before"] = {
  dripper: null,
  dripper_position: null,
  drip_id: null,
  brew_started_at: null,
  brew_finished_at: null,
};

describe("[unit] CaOS の練習の注文", () => {
  test("グッズ以外の品物をカップにし、抽出の要らないカップはカードにならない", () => {
    const [order] = ordersOf([hot, milk, goods, hot, hot]);
    expect(order.cups.map((cup) => cup.item.name)).toStrictEqual([
      "テストブレンド",
      "テストミルク",
      "テストブレンド",
      "テストブレンド",
    ]);
    // 指名は実データに無いので、どの明細も指名なし
    expect(order.menus.every((menu) => menu.assignee === null)).toBe(true);
    // 3 杯は 2 杯と 1 杯のカードに分かれる（本番と同じ buildCaosCards）。ミルクはカードにならない
    expect(cardsOf([order]).map((card) => card.cups.length)).toStrictEqual([
      2, 1,
    ]);
  });

  test("上級生のみの品物は、本番と同じく種類の名前で印が付く", () => {
    const [card] = unassigned(ordersOf([limited]));
    expect(card.seniorOnly).toBe(true);
  });
});

describe("[unit] CaOS の練習の盤面の操作（本番の API と同じ決まり）", () => {
  test("割当（空いていればそのまま抽出）・待機・次へ", () => {
    const initial = ordersOf([hot], [hot], [hot, hot], [milk]);
    let orders = initial;
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
    expect(initial[0].cups[0].dripper).toBeNull();
    // もう終わったカードで「次へ」を押すと断る
    expect(
      advanceCaosPracticeDripper(orders, 1, brewing?.dripId ?? null, at(150))
        .error,
    ).toContain("もう終わっています");
  });

  test("番号は最後なら最大＋1、途中・先頭なら前に入るカードの番号にし、後ろをずらす", () => {
    let orders = ordersOf([hot], [hot], [hot], [hot], [hot]);
    // 1 番は抽出中、2・3 番は待機（番号 2・3）
    for (const _ of [0, 1, 2])
      orders = assign(orders, unassigned(orders)[0], 1, at(0));
    expect(queuedOrderNos(orders, 1)).toStrictEqual([2, 3]);
    const positions = () =>
      caosLane(cardsOf(orders), 1).queued.map((card) => card.dripperPosition);
    expect(positions()).toStrictEqual([2, 3]);

    // 3 番の前へ（途中への差し込み）。3 番の番号に入り、3 番は +1
    const [fourth, fifth] = unassigned(orders);
    const third = caosLane(cardsOf(orders), 1).queued[1];
    orders = assign(orders, fourth, 1, at(1), { beforeKey: third.key });
    expect(queuedOrderNos(orders, 1)).toStrictEqual([2, 4, 3]);
    expect(positions()).toStrictEqual([2, 3, 4]);

    // 先頭へ
    orders = assign(orders, fifth, 1, at(2), "front");
    expect(queuedOrderNos(orders, 1)).toStrictEqual([5, 2, 4, 3]);
    expect(positions()).toStrictEqual([2, 3, 4, 5]);

    // 待機のカードを最後へ動かすと最大＋1。抜けた番号は詰めない
    const moved = caosLane(cardsOf(orders), 1).queued[0];
    const lastKey = caosLane(cardsOf(orders), 1).queued[3].key;
    orders = assign(orders, moved, 2, at(3));
    expect(caosLane(cardsOf(orders), 2).brewing?.orderNo).toBe(5);
    expect(positions()).toStrictEqual([3, 4, 5]);
    expect(caosLane(cardsOf(orders), 1).queued[2].key).toBe(lastKey);
  });

  test("前に入れるカードが待機に無ければ断る", () => {
    let orders = ordersOf([hot], [hot]);
    orders = assign(orders, unassigned(orders)[0], 1, at(0));
    const brewing = caosLane(cardsOf(orders), 1).brewing;
    const [card] = unassigned(orders);
    expect(
      applyCaosPracticeWrites(
        orders,
        [
          {
            cup_ids: card.cups.map((cup) => cup.id),
            before: UNPLACED,
            after: {
              dripper: 1,
              drip_id: "x",
              insert_before: brewing?.dripId ?? null,
              start_brew: false,
            },
          },
        ],
        at(1),
      ).error,
    ).toBe(
      "前に入れるカードが、そのドリッパーの待機にありません（ほかの端末で動いたかもしれません）",
    );
  });

  test("抽出中のカードは動かせず、古い値の書き込みは断り、待機は未割当に戻せる", () => {
    const initial = ordersOf([hot], [hot]);
    let orders = initial;
    const [first, second] = unassigned(orders);
    orders = assign(orders, first, 2, at(0));
    orders = assign(orders, second, 2, at(1));
    const lane = caosLane(cardsOf(orders), 2);
    if (!lane.brewing) throw new Error("no brewing");
    // 古いカード（抽出を始める前の値）で書くと、本番と同じく断る
    const stale = writesOf(assignWrites(cardsOf(initial), first, 3, { newId }));
    expect(applyCaosPracticeWrites(orders, stale, at(2)).error).toBe(
      "ほかの端末で先に変わりました。もう一度操作してください",
    );
    expect(
      assignWrites(cardsOf(orders), lane.brewing, 3, { newId }),
    ).toStrictEqual({ error: "抽出中・終了のカードは動かせません" });

    orders = apply(orders, unassignWrites(lane.queued[0]), at(3));
    expect(caosLane(cardsOf(orders), 2).queued).toHaveLength(0);
    expect(unassigned(orders).map((card) => card.orderNo)).toContain(2);
  });

  test("1 杯どうしを統合し、2 杯のカードとしてドリッパーに置ける", () => {
    let orders = ordersOf([hot], [hot]);
    const [first, second] = unassigned(orders);
    orders = apply(orders, mergeWrites(first, second, newId), at(0));
    const merged = unassigned(orders).find((card) => card.cups.length === 2);
    expect(merged?.cups.map((cup) => cup.orderNo)).toStrictEqual([1, 2]);
    if (!merged) throw new Error("not merged");
    orders = assign(orders, merged, 4, at(5));
    expect(caosLane(cardsOf(orders), 4).brewing?.cups).toHaveLength(2);
  });

  test("待機どうしの統合は、相手のカードと同じ番号にし、ほかはずらさない", () => {
    let orders = ordersOf([hot], [hot], [hot], [hot]);
    for (const _ of [0, 1, 2, 3])
      orders = assign(orders, unassigned(orders)[0], 1, at(0));
    const [a, b, c] = caosLane(cardsOf(orders), 1).queued;
    orders = apply(orders, mergeWrites(b, c, newId), at(1));
    const queued = caosLane(cardsOf(orders), 1).queued;
    expect(queued.map((card) => card.cups.length)).toStrictEqual([1, 2]);
    expect(queued.map((card) => card.dripperPosition)).toStrictEqual([
      a.dripperPosition,
      b.dripperPosition,
    ]);
  });

  test("上級生のみのカードは、本番と同じくどのドリッパーにも置ける", () => {
    let orders = ordersOf([limited]);
    orders = assign(orders, unassigned(orders)[0], 3, at(0));
    expect(caosLane(cardsOf(orders), 3).brewing?.seniorOnly).toBe(true);
  });

  test("決まりに合わない書き込みは何も変えずに断る", () => {
    const orders = ordersOf([hot], [], [hot, hot], [milk]);
    const milkCup = orders[3].cups[0];
    expect(
      applyCaosPracticeWrites(
        orders,
        [
          {
            cup_ids: [milkCup.id],
            before: UNPLACED,
            after: {
              dripper: 1,
              drip_id: "x",
              insert_before: null,
              start_brew: false,
            },
          },
        ],
        at(0),
      ).error,
    ).toBe("抽出の要らないカップ（テストミルク）はドリッパーに置けません");
    // 3 杯を 1 枚のカードにはできない
    const three = [orders[0].cups[0], ...orders[2].cups].map((cup) => cup.id);
    expect(
      applyCaosPracticeWrites(
        orders,
        [
          {
            cup_ids: three,
            before: UNPLACED,
            after: {
              dripper: null,
              drip_id: "y",
              insert_before: null,
              start_brew: false,
            },
          },
        ],
        at(0),
      ).error,
    ).toBe("1 枚のカードは 2 杯までです");
    // 抽出中のドリッパーでもう 1 枚を始めることはできない
    const twoBrews = [orders[0].cups[0], orders[2].cups[0]].map((cup, i) => ({
      cup_ids: [cup.id],
      before: UNPLACED,
      after: {
        dripper: 1,
        drip_id: `b${i}`,
        insert_before: null,
        start_brew: true,
      },
    }));
    expect(applyCaosPracticeWrites(orders, twoBrews, at(0)).error).toBe(
      "1 番のドリッパーはもう抽出中です",
    );
    expect(orders[0].cups[0].dripId).toBeNull();
    expect(orders[0].cups[0].brewStartedAt).toBeNull();
  });
});
