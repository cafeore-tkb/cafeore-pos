import { describe, expect, test } from "vitest";
import {
  type CaosCard,
  type CaosCupsWrite,
  type CaosPlace,
  type CaosWritesResult,
  assignWrites,
  buildCaosCards,
  canMergeCards,
  caosLane,
  mergeWrites,
  splitWrites,
  unassignWrites,
  unstartWrites,
} from "./caos-board";
import {
  type CaosPracticeOrder,
  type CaosPracticeSourceItem,
  type CaosPracticeSourceOrder,
  addCaosPracticeEmergencies,
  advanceCaosPracticeDripper,
  applyCaosPracticeWrites,
  cancelCaosPracticeEmergency,
  toCaosPracticeOrder,
} from "./caosPractice";
import type { PracticeDataItemType } from "./caosPracticeData";
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

// 品物の種類の設定（読み込んだあと POS の種類から付けたもの）
const itemType = (flags: Partial<PracticeDataItemType> = {}) => ({
  display_name: "",
  makes_cup: true,
  needs_brew: true,
  senior_only: false,
  ...flags,
});
const hot = { name: "テストブレンド", type: "hot", itemType: itemType() };
const milk = {
  name: "テストミルク",
  type: "milk",
  itemType: itemType({ needs_brew: false }),
};
const goods = {
  name: "トート",
  type: "others",
  itemType: itemType({ makes_cup: false, needs_brew: false }),
};
const limited = {
  name: "テスト限定",
  type: "limited",
  itemType: itemType({ senior_only: true }),
};

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

const requireCard = (card: CaosCard | undefined) => {
  if (!card) throw new Error("expected card");
  return card;
};

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
    // 指名の無い品物の明細は指名なし
    expect(
      order.menus.every(
        (menu) => menu.dripper === null && menu.assignee === null,
      ),
    ).toBe(true);
    // 3 杯は 2 杯と 1 杯のカードに分かれる（本番と同じ buildCaosCards）。ミルクはカードにならない
    expect(cardsOf([order]).map((card) => card.cups.length)).toStrictEqual([
      2, 1,
    ]);
  });

  test("品物の指名を明細に入れ、本番と同じ指名の札・カードの指名になる", () => {
    const [order] = ordersOf([
      { ...hot, dripper: 2 },
      { ...hot, assignee: "架空さん" },
      hot,
    ]);
    expect(
      order.menus.map((menu) => [menu.dripper, menu.assignee]),
    ).toStrictEqual([
      [2, null],
      [null, "架空さん"],
      [null, null],
    ]);
    // 番号の違う指名（番号の無い自由記述だけは指名なし）は別のカード。自由記述だけのカップは指名なしのカップとまとまる
    const cards = cardsOf([order]);
    expect(
      cards.map((card) => [
        card.nominatedDripper,
        card.cups.map((cup) => cup.nominee),
      ]),
    ).toStrictEqual([
      [null, ["架空さん", null]],
      [2, ["2nd"]],
    ]);
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
    // 「次へ」は終えた時刻だけ。準備完了（提供可能）は提供の画面で付ける
    expect(lane.done[0].cups[0].readyAt).toBeNull();
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
    // 始めてから 10 秒は「次へ」を押せない（二度押し）
    expect(
      advanceCaosPracticeDripper(
        orders,
        1,
        lane.brewing?.dripId ?? null,
        at(149),
      ).error,
    ).toBe("始めてから 10 秒は「次へ」を押せません");
  });

  test("終えるだけ（startNext: false）は待機の先頭を始めない。抽出中が無ければ断る", () => {
    let orders = ordersOf([hot], [hot]);
    const [first, second] = unassigned(orders);
    orders = assign(orders, first, 1, at(0));
    orders = assign(orders, second, 1, at(0));
    const brewing = caosLane(cardsOf(orders), 1).brewing?.dripId ?? null;
    expect(
      advanceCaosPracticeDripper(orders, 1, brewing, at(5), {
        startNext: false,
      }).error,
    ).toBe("始めてから 10 秒は「次へ」を押せません");
    const finished = advanceCaosPracticeDripper(orders, 1, brewing, at(60), {
      startNext: false,
    });
    if (finished.error !== undefined) throw new Error(finished.error);
    const lane = caosLane(cardsOf(finished.orders), 1);
    expect(lane.done.map((card) => card.finishedAt)).toStrictEqual([at(60)]);
    expect(lane.brewing).toBeUndefined();
    expect(lane.queued.map((card) => card.startedAt)).toStrictEqual([null]);
    expect(
      advanceCaosPracticeDripper(finished.orders, 1, null, at(70), {
        startNext: false,
      }).error,
    ).toBe("このドリッパーには抽出中のカードがありません");
  });

  test("始める・終える時刻は、同じドリッパーで前の抽出を終えた時刻より前にしない（本番の盤面に、前に押した操作を重ねるとき）", () => {
    let orders = ordersOf([hot], [hot], [hot]);
    const [first, second, third] = unassigned(orders);
    orders = assign(orders, first, 1, at(0));
    const advanced = advanceCaosPracticeDripper(
      orders,
      1,
      caosLane(cardsOf(orders), 1).brewing?.dripId ?? null,
      at(60),
    );
    if (advanced.error !== undefined) throw new Error(advanced.error);
    // 60 秒に終えた列で、30 秒に押した割当は 60 秒に始めたことにする。ほかのドリッパーは押した時刻
    orders = assign(advanced.orders, second, 1, at(30));
    orders = assign(orders, third, 2, at(30));
    expect(caosLane(cardsOf(orders), 1).brewing?.startedAt).toStrictEqual(
      at(60),
    );
    expect(caosLane(cardsOf(orders), 2).brewing?.startedAt).toStrictEqual(
      at(30),
    );
    // 「次へ」の 10 秒は、その始めた時刻から数える
    const brewing = caosLane(cardsOf(orders), 1).brewing?.dripId ?? null;
    expect(advanceCaosPracticeDripper(orders, 1, brewing, at(65)).error).toBe(
      "始めてから 10 秒は「次へ」を押せません",
    );
  });

  test("番号は最後なら最大＋1、途中なら前に入るカードの番号にし、後ろをずらす。先頭は今から始め、抽出中だったカードを待機の先頭へ", () => {
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

    // 先頭へ：今から始める。抽出中だった 1 番は始めた時刻を消して待機の先頭（2 番の番号）へ
    orders = assign(orders, fifth, 1, at(2), "front");
    const lane = caosLane(cardsOf(orders), 1);
    expect(lane.brewing?.orderNo).toBe(5);
    expect(lane.brewing?.startedAt).toStrictEqual(at(2));
    expect(queuedOrderNos(orders, 1)).toStrictEqual([1, 2, 4, 3]);
    expect(lane.queued[0].startedAt).toBeNull();
    expect(positions()).toStrictEqual([2, 3, 4, 5]);

    // 待機のカードを最後へ動かすと最大＋1。抜けた番号は詰めない
    const moved = caosLane(cardsOf(orders), 1).queued[0];
    const lastKey = caosLane(cardsOf(orders), 1).queued[3].key;
    orders = assign(orders, moved, 2, at(3));
    expect(caosLane(cardsOf(orders), 2).brewing?.orderNo).toBe(1);
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

  test("抽出中のカードも動かせ、古い値の書き込みは断り、待機・抽出中は未割当に戻せる", () => {
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
    // 抽出中のカードを空いている 3 番へ：今から始め直す。元の 2 番の待機は始めない
    orders = assign(orders, lane.brewing, 3, at(2));
    expect(caosLane(cardsOf(orders), 3).brewing?.startedAt).toStrictEqual(
      at(2),
    );
    expect(caosLane(cardsOf(orders), 2).brewing).toBeUndefined();
    expect(queuedOrderNos(orders, 2)).toStrictEqual([2]);

    orders = apply(
      orders,
      unassignWrites(caosLane(cardsOf(orders), 2).queued[0]),
      at(3),
    );
    expect(caosLane(cardsOf(orders), 2).queued).toHaveLength(0);
    const brewing = caosLane(cardsOf(orders), 3).brewing;
    if (!brewing) throw new Error("no brewing");
    orders = apply(orders, unassignWrites(brewing), at(4));
    expect(unassigned(orders).map((card) => card.orderNo)).toStrictEqual([
      1, 2,
    ]);
    expect(orders[0].cups[0].brewStartedAt).toBeNull();
  });

  test("抽出中のカードを未着手に戻すと、始めた時刻を消して待機の先頭へ（次は始めない）。「次へ」で始め直す", () => {
    let orders = ordersOf([hot], [hot], [hot]);
    const [first, second, third] = unassigned(orders);
    orders = assign(orders, first, 2, at(0));
    orders = assign(orders, second, 2, at(1));
    orders = assign(orders, third, 3, at(1));
    const brewing = caosLane(cardsOf(orders), 2).brewing;
    if (!brewing) throw new Error("no brewing");
    orders = apply(orders, unstartWrites(cardsOf(orders), brewing), at(5));
    expect(caosLane(cardsOf(orders), 2).brewing).toBeUndefined();
    expect(queuedOrderNos(orders, 2)).toStrictEqual([1, 2]);
    expect(caosLane(cardsOf(orders), 2).queued[0].startedAt).toBeNull();
    const started = advanceCaosPracticeDripper(orders, 2, null, at(6));
    expect(
      started.orders && caosLane(cardsOf(started.orders), 2).brewing?.orderNo,
    ).toBe(1);
    // 待機の無い列でも戻せる。抽出中でないカードは断る
    const alone = caosLane(cardsOf(orders), 3).brewing;
    if (!alone) throw new Error("no brewing");
    orders = apply(orders, unstartWrites(cardsOf(orders), alone), at(7));
    expect(queuedOrderNos(orders, 3)).toStrictEqual([3]);
    expect(
      unstartWrites(cardsOf(orders), caosLane(cardsOf(orders), 2).queued[0]),
    ).toEqual({ error: "抽出中のカードだけ未着手に戻せます" });
  });

  test("カップが全部準備完了・提供済みになっても、抽出中のカードは抽出中のまま動かせ、終えるのは「次へ」だけ", () => {
    let orders = ordersOf([hot], [hot]);
    const [first, second] = unassigned(orders);
    orders = assign(orders, first, 2, at(0));
    orders = assign(orders, second, 2, at(1));
    // 提供の画面で両方のカップを提供済みにした（提供済みは準備完了も持つ）
    orders = orders.map((order) => ({
      ...order,
      cups: order.cups.map((cup) => ({
        ...cup,
        readyAt: at(2),
        servedAt: at(2),
      })),
    }));
    const lane = caosLane(cardsOf(orders), 2);
    expect(lane.brewing?.orderNo).toBe(1);
    expect(queuedOrderNos(orders, 2)).toStrictEqual([2]);
    if (!lane.brewing) throw new Error("no brewing");
    // 抽出中のカードは動かせる（3 番の空きへ移すと今から始め直す）
    const moved = assign(orders, lane.brewing, 3, at(3));
    expect(caosLane(cardsOf(moved), 3).brewing?.orderNo).toBe(1);
    // 「次へ」で終わり、待機の先頭が始まる
    const advanced = advanceCaosPracticeDripper(
      orders,
      2,
      lane.brewing.dripId,
      at(20),
    );
    if (advanced.error !== undefined) throw new Error(advanced.error);
    const after = caosLane(cardsOf(advanced.orders), 2);
    expect(after.done.map((card) => card.orderNo)).toStrictEqual([1]);
    expect(after.brewing?.orderNo).toBe(2);
  });

  test("抽出中のカードを同じ列の待機へ下げると次のカードが今から始まり、抽出中のある列の先頭へ移すとそこの抽出中が待機の先頭へ", () => {
    let orders = ordersOf([hot], [hot], [hot], [hot]);
    for (const dripper of [1, 1, 1, 2])
      orders = assign(orders, unassigned(orders)[0], dripper, at(0));
    const lane1 = () => caosLane(cardsOf(orders), 1);
    const lane2 = () => caosLane(cardsOf(orders), 2);
    // 1 番の抽出中（1 番）を 3 番の前へ：2 番が今から始まる
    const third = lane1().queued[1];
    orders = assign(orders, lane1().brewing as CaosCard, 1, at(5), {
      beforeKey: third.key,
    });
    expect(lane1().brewing?.orderNo).toBe(2);
    expect(lane1().brewing?.startedAt).toStrictEqual(at(5));
    expect(queuedOrderNos(orders, 1)).toStrictEqual([1, 3]);
    // 1 番の抽出中（2 番）を 2 番の列の抽出中（4 番）の前へ：2 番は今から始め直し、4 番は待機へ。1 番の列は始めない
    orders = assign(orders, lane1().brewing as CaosCard, 2, at(20), {
      beforeKey: lane2().brewing?.key ?? "",
    });
    expect(lane2().brewing?.orderNo).toBe(2);
    expect(lane2().brewing?.startedAt).toStrictEqual(at(20));
    expect(queuedOrderNos(orders, 2)).toStrictEqual([4]);
    expect(lane2().queued[0].startedAt).toBeNull();
    expect(lane1().brewing).toBeUndefined();
    expect(queuedOrderNos(orders, 1)).toStrictEqual([1, 3]);
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

  test("待機どうしの統合は、入るカードと同じ番号にし、ほかはずらさない", () => {
    let orders = ordersOf([hot], [hot], [hot], [hot]);
    for (const _ of [0, 1, 2, 3])
      orders = assign(orders, unassigned(orders)[0], 1, at(0));
    const [a, b, c] = caosLane(cardsOf(orders), 1).queued;
    orders = apply(orders, mergeWrites(b, c, newId), at(1));
    const queued = caosLane(cardsOf(orders), 1).queued;
    expect(queued.map((card) => card.cups.length)).toStrictEqual([1, 2]);
    expect(queued.map((card) => card.dripperPosition)).toStrictEqual([
      a.dripperPosition,
      c.dripperPosition,
    ]);
  });

  test("抽出中のカードに 1 杯を足すと、開始の時刻はそのカードのまま", () => {
    let orders = ordersOf([hot], [hot]);
    orders = assign(orders, unassigned(orders)[0], 2, at(0));
    const brewing = caosLane(cardsOf(orders), 2).brewing;
    if (!brewing) throw new Error("not brewing");
    orders = apply(
      orders,
      mergeWrites(unassigned(orders)[0], brewing, newId),
      at(30),
    );
    const after = caosLane(cardsOf(orders), 2).brewing;
    expect(after?.cups).toHaveLength(2);
    expect(after?.startedAt).toStrictEqual(at(0));
  });

  test("上級生のみのカードは、担当者がいないのでどのドリッパーにも置ける（指名のあるカードは指名のドリッパーに）", () => {
    let orders = ordersOf([limited], [{ ...limited, dripper: 4 }]);
    orders = assign(orders, unassigned(orders)[0], 3, at(0));
    expect(caosLane(cardsOf(orders), 3).brewing?.seniorOnly).toBe(true);
    // 指名（4th）の上級生のみのカード
    orders = assign(orders, unassigned(orders)[0], 4, at(0));
    const placed = caosLane(cardsOf(orders), 4).brewing;
    expect([placed?.seniorOnly, placed?.nominatedDripper]).toStrictEqual([
      true,
      4,
    ]);
  });

  test("指名のカードは指名のドリッパーにだけ置け、指名の無い上級生のみの 1 杯も指名のカードに入れれば指名のドリッパーへ", () => {
    let orders = ordersOf(
      [{ ...limited, dripper: 2 }],
      [limited],
      [{ ...limited, dripper: 5 }],
    );
    const [nominated, plain, other] = unassigned(orders);
    // 本番と同じ assignWrites が断る
    const refused = assignWrites(cardsOf(orders), nominated, 3, { newId });
    expect("error" in refused && refused.error).toBe(
      "指名のあるカードは 2nd のドリッパーにしか置けません",
    );
    // 違う番号の指名は統合できない。指名なしは指名のカードに入れられる
    expect(canMergeCards(other, nominated)).toBe(false);
    expect(canMergeCards(plain, nominated)).toBe(true);
    orders = apply(orders, mergeWrites(plain, nominated, newId), at(0));
    const merged = unassigned(orders).find((card) => card.cups.length === 2);
    expect([merged?.nominatedDripper, merged?.seniorOnly]).toStrictEqual([
      2,
      true,
    ]);
    if (!merged) throw new Error("統合したカードがありません");
    expect("error" in assignWrites(cardsOf(orders), merged, 4, { newId })).toBe(
      true,
    );
    orders = assign(orders, merged, 2, at(0));
    expect(
      caosLane(cardsOf(orders), 2).brewing?.cups.map((cup) => cup.orderNo),
    ).toStrictEqual([1, 2]);
  });

  test("指名に合わない書き込みは、API と同じく練習の盤面も断る", () => {
    const orders = ordersOf(
      [{ ...hot, dripper: 2 }],
      [{ ...hot, dripper: 5 }],
      [hot],
    );
    const write = (cupIds: string[], dripper: number | null) => ({
      cup_ids: cupIds,
      before: UNPLACED,
      after: {
        dripper,
        drip_id: "n",
        insert_before: null,
        start_brew: false,
      },
    });
    const [two, five, free] = orders.map((order) => order.cups[0].id);
    expect(
      applyCaosPracticeWrites(orders, [write([two], 3)], at(0)).error,
    ).toBe("指名のあるカップは 2 番のドリッパーにしか置けません");
    expect(
      applyCaosPracticeWrites(orders, [write([two, five], null)], at(0)).error,
    ).toBe("指名の違うカップは同じカードにできません");
    // 指名なしのカップは、指名のカップと同じカードにできる
    expect(
      applyCaosPracticeWrites(orders, [write([two, free], 2)], at(0)).error,
    ).toBeUndefined();
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
    // 抽出中が無く待機のあるドリッパーで、待機の先頭を飛ばして始めることはできない（始めるのは「次へ」）
    const queued = apply(
      orders,
      {
        writes: [
          {
            ...twoBrews[0],
            after: { ...twoBrews[0].after, start_brew: false },
          },
        ],
      },
      at(0),
    );
    expect(applyCaosPracticeWrites(queued, [twoBrews[1]], at(0)).error).toBe(
      "1 番のドリッパーには待機のカードがあるので、抽出は「次へ」で待機の先頭から始めてください",
    );
    expect(orders[0].cups[0].dripId).toBeNull();
    expect(orders[0].cups[0].brewStartedAt).toBeNull();
    // 抽出中のカードはほかのカードに統合しない。終わったカードは動かさない
    let brewed = apply(orders, { writes: [twoBrews[0]] }, at(0));
    const write = (after: CaosCupsWrite["after"]) => ({
      cup_ids: [orders[0].cups[0].id],
      before: {
        ...UNPLACED,
        dripper: 1,
        dripper_position: 1,
        drip_id: "b0",
        brew_started_at: at(0).toISOString(),
      },
      after,
    });
    expect(
      applyCaosPracticeWrites(
        brewed,
        [write({ ...twoBrews[1].after, start_brew: false })],
        at(1),
      ).error,
    ).toBe(
      "抽出中のカードの drip_id は変えられません（ほかのカードに統合もできません）",
    );
    const advanced = advanceCaosPracticeDripper(brewed, 1, "b0", at(20));
    if (advanced.error !== undefined) throw new Error(advanced.error);
    brewed = advanced.orders;
    const done = write({ ...twoBrews[0].after, dripper: 2 });
    done.before.brew_finished_at = at(20).toISOString();
    expect(applyCaosPracticeWrites(brewed, [done], at(21)).error).toBe(
      "終わったカードは動かせません",
    );
  });
});

describe("[unit] CaOS の練習の盤面の緊急（本番の API と同じ決まり）", () => {
  const addEmergencies = (
    orders: CaosPracticeOrder[],
    cupIds: string[],
    reason: string,
    now: Date,
  ) => {
    const added = addCaosPracticeEmergencies(
      orders,
      cupIds,
      reason,
      now,
      newId,
    );
    if ("error" in added) throw new Error(added.error);
    return added;
  };

  test("足した入れ直しは未割当のカードになり、割当・抽出・次へはカップと同じ。次へで入れ直したカップは準備完了にしない", () => {
    const initial = ordersOf([hot], [hot]);
    const cupId = initial[0].cups[0].id;
    const added = addEmergencies(initial, [cupId], "  こぼした ", at(5));
    let orders = added.orders;
    expect(initial[0].cups[0].emergencies).toHaveLength(0);
    const emergency = orders[0].cups[0].emergencies[0];
    expect(emergency).toMatchObject({
      id: added.ids[0],
      reason: "こぼした",
      createdAt: at(5),
      dripper: null,
    });
    const [card] = unassigned(orders).filter((c) => c.emergency);
    expect(card.cups.map((cup) => cup.id)).toStrictEqual(added.ids);

    // 割当（空いていればそのまま抽出）。抽出の開始は練習の時計の今
    orders = assign(orders, card, 2, at(10));
    expect(orders[0].cups[0].emergencies[0].brewStartedAt).toStrictEqual(
      at(10),
    );
    expect(orders[0].cups[0].dripper).toBeNull();
    const advanced = advanceCaosPracticeDripper(
      orders,
      2,
      caosLane(cardsOf(orders), 2).brewing?.dripId ?? null,
      at(310),
    );
    if (advanced.error !== undefined) throw new Error(advanced.error);
    expect(
      advanced.orders[0].cups[0].emergencies[0].brewFinishedAt,
    ).toStrictEqual(at(310));
    expect(advanced.orders[0].cups[0].readyAt).toBeNull();
  });

  test.each([false, true])(
    "通常＋緊急を未割当・待機で統合し、緊急だけ取り消せる（待機=%s）",
    (queued) => {
      const initial = ordersOf([hot], [hot]);
      let { orders, ids } = addEmergencies(
        initial,
        [initial[0].cups[0].id],
        "抽出ミス",
        at(0),
      );
      const normalId = orders[1].cups[0].id;

      if (queued)
        orders = apply(
          orders,
          {
            writes: [
              {
                cup_ids: [normalId],
                before: UNPLACED,
                after: {
                  dripper: 2,
                  drip_id: newId(),
                  insert_before: null,
                  start_brew: false,
                },
              },
            ],
          },
          at(0),
        );
      const normal = requireCard(
        cardsOf(orders).find((c) => c.cups.some((cup) => cup.id === normalId)),
      );
      const redo = requireCard(unassigned(orders).find((c) => c.emergency));
      orders = apply(orders, mergeWrites(redo, normal, newId), at(1));
      const mixed = requireCard(
        cardsOf(orders).find((c) => c.cups.length === 2),
      );
      expect(mixed.emergency).toBe(true);
      expect(mixed.cups.map((c) => c.id).sort()).toEqual(
        [ids[0], normalId].sort(),
      );
      expect(mixed.cups.find((c) => c.emergency)?.emergencyReason).toBe(
        "抽出ミス",
      );
      // 分割しても通常・緊急それぞれのIDと状態を保持する。
      const split = apply(orders, splitWrites(mixed, ids[0]), at(2));
      expect(
        cardsOf(split).filter((c) =>
          c.cups.some((cup) => [ids[0], normalId].includes(cup.id)),
        ),
      ).toHaveLength(2);
      const before = orders[1].cups[0];
      const cancelled = cancelCaosPracticeEmergency(orders, ids[0]);
      if (cancelled.error !== undefined) throw new Error(cancelled.error);
      expect(cancelled.orders[1].cups[0]).toEqual(before);
      expect(
        cardsOf(cancelled.orders).find((c) =>
          c.cups.some((cup) => cup.id === normalId),
        )?.emergency,
      ).toBe(false);
    },
  );

  test.each([false, true])(
    "抽出中の通常＋緊急を統合し、一緒に完了できる（緊急が先=%s）",
    (emergencyFirst) => {
      const initial = ordersOf([hot], [hot]);
      let { orders, ids } = addEmergencies(
        initial,
        [initial[0].cups[0].id],
        "異物混入",
        at(0),
      );
      const normalId = orders[1].cups[0].id;
      const firstId = emergencyFirst ? ids[0] : normalId;
      const secondId = emergencyFirst ? normalId : ids[0];
      const first = requireCard(
        unassigned(orders).find((c) => c.cups[0].id === firstId),
      );
      orders = assign(orders, first, 2, at(0));
      const brewing = requireCard(
        cardsOf(orders).find((c) => c.status === "brewing"),
      );
      const joining = requireCard(
        unassigned(orders).find((c) => c.cups[0].id === secondId),
      );
      orders = apply(orders, mergeWrites(joining, brewing, newId), at(10));
      const mixed = requireCard(
        cardsOf(orders).find((c) => c.cups.length === 2),
      );
      expect(mixed.startedAt).toEqual(at(0));
      expect(cancelCaosPracticeEmergency(orders, ids[0]).error).toBe(
        "抽出を始めた淹れ直しは取り消せません",
      );
      const finished = advanceCaosPracticeDripper(
        orders,
        2,
        mixed.dripId,
        at(310),
      );
      if (finished.error !== undefined) throw new Error(finished.error);
      expect(finished.orders[1].cups[0].brewFinishedAt).toEqual(at(310));
      expect(finished.orders[0].cups[0].emergencies[0].brewFinishedAt).toEqual(
        at(310),
      );
      expect(finished.orders[0].cups[0].brewFinishedAt).toBeNull();
    },
  );

  test("取り消せるのはまだ抽出を始めていない入れ直しだけ。抽出の要らないカップ・無いカップには足せない", () => {
    const initial = ordersOf([hot], [milk]);
    const { orders, ids } = addEmergencies(
      initial,
      [initial[0].cups[0].id],
      "",
      at(0),
    );
    const cancelled = cancelCaosPracticeEmergency(orders, ids[0]);
    if (cancelled.error !== undefined) throw new Error(cancelled.error);
    expect(cancelled.orders[0].cups[0].emergencies).toHaveLength(0);
    expect(orders[0].cups[0].emergencies).toHaveLength(1);
    expect(
      cancelCaosPracticeEmergency(cancelled.orders, ids[0]).error,
    ).toContain("入れ直しが見つかりません");

    const [card] = unassigned(orders).filter((c) => c.emergency);
    const brewing = assign(orders, card, 1, at(0));
    expect(cancelCaosPracticeEmergency(brewing, ids[0]).error).toBe(
      "抽出を始めた入れ直しは取り消せません",
    );

    const add = (cupIds: string[], reason = "") =>
      addCaosPracticeEmergencies(initial, cupIds, reason, at(0), newId);
    expect(add([initial[1].cups[0].id])).toStrictEqual({
      error: "抽出の要らないカップ（テストミルク）は入れ直せません",
    });
    expect(add(["missing"])).toHaveProperty("error");
    expect(add([])).toHaveProperty("error");
    expect(add([initial[0].cups[0].id], "あ".repeat(101))).toStrictEqual({
      error: "理由は 100 文字までです",
    });
  });
});
