import {
  type CaosCard,
  type CaosOrderInput,
  type Cup,
  buildCaosCards,
} from "@cafeore/common";
import { describe, expect, test } from "vitest";
import { LATE_ORDER_SEC, longWaitMinutes, orderBacklog } from "./alerts";
import {
  type CardLook,
  cardLooks,
  cardOrderParts,
  cardServedLabel,
  orderAndCupCounts,
  orderLabel,
  quickMergePartner,
  selectedComments,
  sharesOrder,
  unassignedRows,
} from "./cards";
import { isStampReply } from "./comments";
import {
  DROP_EDGE,
  boardLanes,
  cardPlaces,
  dropSideAt,
  frontTargets,
  moveTargets,
  pendingNominatedCups,
} from "./lanes";
import { byElapsed, liberoLanes } from "./libero";
import { earlyNext, laneStatus, laneTimes } from "./queue";
import { findOrder, focusCard } from "./search";
import { buildSheet, cellKey, linkedOrderNos } from "./sheet";
import { timelineArrivals } from "./timeline";
import {
  markSeen,
  unfinishedOrders,
  unfinishedStates,
  unseenAlerts,
} from "./unfinished";

// 作りものの注文（本物のデータは入れない）
const T0 = new Date("2025-11-02T03:00:00.000Z");
const item = {
  id: "item-blend",
  name: "テストブレンド",
  abbr: "テ",
  item_type: {
    name: "hot",
    display_name: "ホット",
    makes_cup: true,
    needs_brew: true,
    senior_only: false,
    iced_brew: false,
  },
} as Cup["item"];

type CupPlace = Partial<
  Pick<
    Cup,
    | "dripper"
    | "dripId"
    | "dripperPosition"
    | "brewStartedAt"
    | "brewFinishedAt"
    | "readyAt"
    | "servedAt"
    | "emergencies"
  >
>;

const order = (
  orderId: number,
  cups: CupPlace[],
  nominated: number | null = null,
): CaosOrderInput => ({
  id: `order-${orderId}`,
  orderId,
  createdAt: T0,
  menus: cups.map((_, index) => ({
    orderMenuId: `menu-${orderId}-${index}`,
    dripper: nominated,
    assignee: null,
  })),
  cups: cups.map((place, index) => ({
    id: `cup-${orderId}-${index}`,
    orderMenuId: `menu-${orderId}-${index}`,
    item,
    readyAt: null,
    servedAt: null,
    dripper: null,
    dripperPosition: null,
    dripId: null,
    brewStartedAt: null,
    brewFinishedAt: null,
    emergencies: [],
    ...place,
  })),
});

describe("[unit] CaOS の盤面の見せ方", () => {
  // #1：1 杯を 1st で抽出中、#2：2nd の指名、#3 と #4：1 杯どうしを統合した未割当、#5：1st の待機
  const cards = buildCaosCards([
    order(1, [
      { dripper: 1, dripId: "d1", dripperPosition: 1, brewStartedAt: T0 },
    ]),
    order(2, [{}], 2),
    order(3, [{ dripId: "m" }]),
    order(4, [{ dripId: "m" }]),
    order(5, [{ dripper: 1, dripId: "d5", dripperPosition: 2 }]),
  ]);
  const lanes = boardLanes(cards);
  const unassigned = cards.filter((card) => card.status === "unassigned");

  test("未割当の行は未割当のカードだけ。統合したカードは小さい注文の行に置く（もう一方の注文の行は作らない）", () => {
    const rows = unassignedRows(unassigned).map(({ orderNo, cards }) => ({
      orderNo,
      cards: cards.map((card) => card.key),
    }));
    expect(rows).toEqual([
      { orderNo: 2, cards: ["cups:cup-2-0"] },
      { orderNo: 3, cards: ["m"] },
    ]);
  });

  test("ヘッダーの数は注文の数（統合したカードは中の注文をみな、分けた注文は 1 つ）と杯数", () => {
    // #3+#4 の統合（2 注文・2 杯）と #2（1 注文・1 杯）
    expect(orderAndCupCounts(unassigned)).toEqual({ orders: 3, cups: 3 });
    // 2 杯の注文を 2 枚に分けても 1 注文
    const split = buildCaosCards([
      order(9, [{ dripId: "a" }, { dripId: "b" }]),
    ]);
    expect(split).toHaveLength(2);
    expect(orderAndCupCounts(split)).toEqual({ orders: 1, cups: 2 });
  });

  test("いちばん古い未割当と、受けてから 15 分を超えてまだ始めていない注文（未割当・待機。古い順）", () => {
    const at = (orderId: number, minutesAgo: number, cups: CupPlace[]) => ({
      ...order(orderId, cups),
      createdAt: new Date(T0.getTime() - minutesAgo * 60_000),
    });
    const orders = [
      at(1, 30, [
        { dripper: 1, dripId: "b", dripperPosition: 1, brewStartedAt: T0 },
      ]),
      at(2, 20, [{ dripper: 2, dripId: "q", dripperPosition: 1 }]),
      at(3, LATE_ORDER_SEC / 60 + 1, [{}]),
      at(4, 5, [{}]),
    ];
    const backlog = orderBacklog(buildCaosCards(orders), T0.getTime());
    expect(backlog.oldestUnassigned).toEqual({
      orderNo: 3,
      waitSec: LATE_ORDER_SEC + 60,
      late: true,
    });
    // 抽出中の #1 は数えない
    expect(backlog.late.map((o) => o.orderNo)).toEqual([2, 3]);
    expect(orderBacklog([], T0.getTime())).toEqual({
      oldestUnassigned: null,
      late: [],
    });
  });

  test("開いたカードをもう一度押したときの統合の相手は、1 枚ならそれ、何枚かあれば注文番号がいちばん近いもの。決まらなければ無し", () => {
    const [c10, c12, c13, c14, c15] = buildCaosCards(
      [10, 12, 13, 14, 15].map((no) => order(no, [{}])),
    );
    const [two] = buildCaosCards([order(11, [{}, {}])]);
    const keyOf = (card: CaosCard, cards: CaosCard[]) =>
      quickMergePartner(card, cards)?.key;
    // 1 枚なら離れていてもそれ（2 杯のカードには統合できない）
    expect(keyOf(c10, [two, c15])).toBe(c15.key);
    // いちばん近い #13
    expect(keyOf(c15, [c10, c13, c15])).toBe(c13.key);
    // #10 と #14 はどちらも 2 つ離れていて決まらない
    expect(keyOf(c12, [c10, c12, c14])).toBeUndefined();
    expect(keyOf(c12, [two])).toBeUndefined();
    // 抽出中・待機のカードも相手の候補。終わったカードは候補にしない
    const brewing = { ...c13, status: "brewing" as const, dripper: 1 };
    const queued = { ...c13, status: "queued" as const, dripper: 1 };
    const done = { ...c13, status: "done" as const, dripper: 1 };
    expect(keyOf(c12, [brewing, c15])).toBe(brewing.key);
    expect(keyOf(c12, [queued, c15])).toBe(queued.key);
    expect(keyOf(c12, [done, c15])).toBe(c15.key);
  });

  test("列のカードに落とす所：左の端は前、右の端は後ろ、真ん中は統合（できなければ近いほうの端）。置けない列なら統合だけ", () => {
    const mergeable = { mergeable: true };
    const plain = { mergeable: false };
    expect(dropSideAt(0, mergeable)).toBe("before");
    expect(dropSideAt(DROP_EDGE - 0.01, mergeable)).toBe("before");
    expect(dropSideAt(0.5, mergeable)).toBe("merge");
    expect(dropSideAt(1 - DROP_EDGE + 0.01, mergeable)).toBe("after");
    expect(dropSideAt(1, mergeable)).toBe("after");
    expect(dropSideAt(0.45, plain)).toBe("before");
    expect(dropSideAt(0.55, plain)).toBe("after");
    expect(dropSideAt(0.1, { mergeable: true, placeable: false })).toBe(
      "merge",
    );
    expect(dropSideAt(0.1, { mergeable: false, placeable: false })).toBeNull();
  });

  test("移すボタン：番号は列の最後へ（今の列も）、指名の番号だけ押せる。先頭・待機の先頭は今と同じ場所なら押せない", () => {
    const [card] = buildCaosCards([order(20, [{}])]);
    const queued = { ...card, status: "queued" as const, dripper: 2 };
    expect(
      moveTargets(queued, 2)
        .filter((t) => t.current)
        .map((t) => t.bayId),
    ).toEqual([2]);
    expect(moveTargets(queued, 2).every((t) => !t.disabled)).toBe(true);
    const [named] = buildCaosCards([order(21, [{}], 3)]);
    expect(
      moveTargets(named, null)
        .filter((t) => !t.disabled)
        .map((t) => t.bayId),
    ).toEqual([3]);
    // 先頭・待機の先頭は、今と同じ場所なら押せない。添え書きは列に抽出中があるときだけ
    const cards = buildCaosCards([
      order(30, [
        { dripper: 2, dripId: "b", dripperPosition: 1, brewStartedAt: T0 },
      ]),
      order(31, [{ dripper: 2, dripId: "q1", dripperPosition: 2 }]),
      order(32, [{ dripper: 2, dripId: "q2", dripperPosition: 3 }]),
      order(40, [{ dripper: 3, dripId: "w1", dripperPosition: 1 }]),
      order(41, [{ dripper: 3, dripId: "w2", dripperPosition: 2 }]),
    ]);
    const lanes = boardLanes(cards);
    const fronts = (dripId: string) => {
      const c = cards.find((x) => x.dripId === dripId);
      const lane = lanes.find((l) => l.id === c?.dripper);
      if (!c || !lane) throw new Error("no card");
      return frontTargets(c, lane).map((t) => [t.disabled, t.hint ?? ""]);
    };
    expect(fronts("q2")).toEqual([
      [false, "今から始める"],
      [false, "抽出中の次"],
    ]);
    expect(fronts("q1")).toEqual([
      [false, "今から始める"],
      [true, "抽出中の次"],
    ]);
    expect(fronts("b")).toEqual([
      [true, "今から始める"],
      [false, "抽出中の次"],
    ]);
    // 抽出中の無い列：どちらも待機の先頭なので添え書きは無し
    expect(fronts("w1")).toEqual([
      [true, ""],
      [true, ""],
    ]);
    expect(fronts("w2")).toEqual([
      [false, ""],
      [false, ""],
    ]);
  });

  test("未割当の入れ直し（緊急）は、注文の別の行にして先頭に置く", () => {
    const emergency = {
      id: "e1",
      createdAt: T0,
      reason: "こぼした",
      dripper: null,
      dripperPosition: null,
      dripId: null,
      brewStartedAt: null,
      brewFinishedAt: null,
    };
    const rows = unassignedRows(
      buildCaosCards([
        order(2, [{}]),
        order(7, [{ emergencies: [emergency] }]),
      ]),
    );
    expect(
      rows.map(({ orderNo, emergency }) => ({ orderNo, emergency })),
    ).toEqual([
      { orderNo: 7, emergency: true },
      { orderNo: 2, emergency: false },
      { orderNo: 7, emergency: false },
    ]);
  });

  test("同じ注文の分け方は、ほかの注文と統合したカードに入った分も数える", () => {
    // #8：2 杯のうち 1 杯を #9 と統合した。残りの 1 杯にも「同じ注文がほかにもある」（2 枚・計2杯）
    const merged = buildCaosCards([
      order(8, [{ dripId: "m8" }, {}]),
      order(9, [{ dripId: "m8" }]),
    ]);
    const looks = cardLooks(merged, [], new Map());
    expect(looks.get("cups:cup-8-1")?.split).toEqual({
      total: 2,
      cups: 2,
    });
    // 統合したカードそのものには付けない
    expect(looks.get("m8")?.split).toBeUndefined();
  });

  test("注文を選ぶと、その注文の入った統合したカードも当たる（統合したカードを選ぶと中の注文のカードも）", () => {
    const merged = cards.find((card) => card.key === "m");
    if (!merged) throw new Error("統合したカードが無い");
    expect(orderLabel(merged)).toBe("#003+#004");
    expect(sharesOrder(merged, "#004")).toBe(true);
    expect(sharesOrder(merged, "#003")).toBe(true);
    expect(sharesOrder(merged, "#002")).toBe(false);
    expect(sharesOrder(merged, null)).toBe(false);
    const [own] = buildCaosCards([order(4, [{}])]);
    expect(sharesOrder(own, "#003+#004")).toBe(true);
    // D の表：#004 を選ぶと、統合したカードの行（#003 と #004）
    expect([...linkedOrderNos("#004", lanes, unassigned)].sort()).toEqual([
      3, 4,
    ]);
  });

  test("統合したカードの注文ごとの段は、注文番号の小さい順にその注文の杯数", () => {
    const merged = cards.find((card) => card.key === "m");
    if (!merged) throw new Error("統合したカードが無い");
    // コメントはその注文の段にだけ数える
    const look = { comments: [{ orderNo: 4 }] } as CardLook;
    expect(cardOrderParts(merged, look)).toEqual([
      { orderNo: 3, cups: 1, reason: "", comments: 0 },
      { orderNo: 4, cups: 1, reason: "", comments: 1 },
    ]);
    const [two] = buildCaosCards([order(11, [{}, {}])]);
    expect(cardOrderParts(two)).toEqual([
      { orderNo: 11, cups: 2, reason: "", comments: 0 },
    ]);
    // 入れ直しどうしを統合したカードは、理由をその注文の段にだけ出す
    const emergency = (id: string, reason: string) => ({
      id,
      createdAt: T0,
      reason,
      dripper: null,
      dripperPosition: null,
      dripId: "em",
      brewStartedAt: null,
      brewFinishedAt: null,
    });
    const rebrew = buildCaosCards([
      order(7, [{ emergencies: [emergency("e7", "こぼした")] }]),
      order(8, [{ emergencies: [emergency("e8", "")] }]),
    ]).find((card) => card.emergency);
    if (!rebrew) throw new Error("入れ直しのカードが無い");
    expect(cardOrderParts(rebrew).map(({ reason }) => reason)).toEqual([
      "こぼした",
      "",
    ]);
  });

  test("タイムラインに新しく入ったカードは、割り当てたものと抽出を始めたものだけ（移しただけのカードは入らない）", () => {
    const previous = new Map(cards.map((card) => [card.key, card.status]));
    const after = buildCaosCards([
      // 1st で抽出中のまま 4th へ移した
      order(1, [
        { dripper: 4, dripId: "d1", dripperPosition: 1, brewStartedAt: T0 },
      ]),
      // 未割当を 2nd へ割り当てた・統合した未割当を 3rd へ割り当てた
      order(2, [{ dripper: 2, dripId: "d2", dripperPosition: 1 }], 2),
      order(3, [{ dripper: 3, dripId: "m", dripperPosition: 1 }]),
      order(4, [{ dripper: 3, dripId: "m", dripperPosition: 1 }]),
      // 1st の待機の抽出を始めた
      order(5, [
        { dripper: 1, dripId: "d5", dripperPosition: 1, brewStartedAt: T0 },
      ]),
    ]);
    expect(timelineArrivals(previous, after).sort()).toEqual(["d2", "d5", "m"]);
    expect(timelineArrivals(previous, cards)).toEqual([]);
  });

  test("ドリッパーに置いたカードの場所の札", () => {
    const places = cardPlaces(lanes);
    expect(places.get("d1")).toBe("1st 抽出中");
    expect(places.get("d5")).toBe("1st 1番目");
    expect(places.has("m")).toBe(false);
  });

  test("そのドリッパーを待っている指名の杯数", () => {
    expect(pendingNominatedCups(unassigned, 2)).toBe(1);
    expect(pendingNominatedCups(unassigned, 1)).toBe(0);
  });

  test("列の状態（空き・抽出中・まもなく・継続中）", () => {
    const phase = (sec: number, lane = lanes[0]) =>
      laneStatus(lane, T0.getTime() + sec * 1000).phase;
    expect(phase(0)).toBe("brewing");
    expect(phase(290)).toBe("soon");
    expect(phase(310)).toBe("overtime");
    expect(phase(0, lanes[2])).toBe("empty");
  });

  test("予定の抽出時間を 2 分過ぎても「次へ」が押されていない抽出は要確認（予定を過ぎた秒も）", () => {
    const status = (sec: number) =>
      laneStatus(lanes[0], T0.getTime() + sec * 1000);
    // 1 杯は 300 秒
    expect(status(300 + 119)).toMatchObject({ overSec: 119, forgotten: false });
    expect(status(300 + 120)).toMatchObject({ overSec: 120, forgotten: true });
    expect(status(100)).toMatchObject({ overSec: 0, forgotten: false });
    expect(laneStatus(lanes[2], T0.getTime() + 999_000).forgotten).toBe(false);
  });

  test("受けてから 5 分たっても未割当のカードは、待っている分", () => {
    const [card] = unassigned;
    const at = (sec: number) => T0.getTime() + sec * 1000;
    expect(longWaitMinutes(card, at(299))).toBeNull();
    expect(longWaitMinutes(card, at(300))).toBe(5);
    expect(longWaitMinutes(card, at(419))).toBe(6);
    // ドリッパーに置いたカードには付けない
    expect(longWaitMinutes(lanes[0].brewing ?? card, at(999))).toBeNull();
  });

  test("「次へ」は始めてから 10 秒は押せず、抽出時間の半分までは押し間違いかを確かめる", () => {
    const at = (sec: number) => T0.getTime() + sec * 1000;
    expect(laneStatus(lanes[0], at(9)).nextLocked).toBe(true);
    expect(laneStatus(lanes[0], at(10)).nextLocked).toBe(false);
    // 1 杯は 300 秒なので、149 秒までは確かめる
    expect(earlyNext(lanes[0], at(149))?.elapsedSec).toBe(149);
    expect(earlyNext(lanes[0], at(150))).toBeNull();
    expect(earlyNext(lanes[2], at(0))).toBeNull();
  });

  test("予定の時刻は 1 杯 5 分・2 杯 6 分の抽出と、15 秒の入れ替え", () => {
    // 1st：#1（1 杯）を抽出中、#6（2 杯）と #5（1 杯）が待機
    const [lane] = boardLanes(
      buildCaosCards([
        order(1, [
          { dripper: 1, dripId: "d1", dripperPosition: 1, brewStartedAt: T0 },
        ]),
        order(5, [{ dripper: 1, dripId: "d5", dripperPosition: 3 }]),
        order(6, [
          { dripper: 1, dripId: "d6", dripperPosition: 2 },
          { dripper: 1, dripId: "d6", dripperPosition: 2 },
        ]),
      ]),
    );
    const sec = (ms: number) => (ms - T0.getTime()) / 1000;
    expect(
      laneTimes(lane, T0.getTime()).map(({ card, startMs, endMs }) => [
        card.key,
        sec(startMs),
        sec(endMs),
      ]),
    ).toEqual([
      ["d1", 0, 300],
      ["d6", 315, 675],
      ["d5", 690, 990],
    ]);
    expect(laneStatus(lane, T0.getTime()).remainingSec).toBe(300);
  });

  test("待機のカードがあり、まだ始めていない列は待機", () => {
    const [lane] = boardLanes(
      buildCaosCards([
        order(6, [{ dripper: 1, dripId: "d6", dripperPosition: 1 }]),
      ]),
    );
    expect(laneStatus(lane, T0.getTime()).phase).toBe("waiting");
  });

  test("リベロビュー：抽出中のドリッパーに経過の長い順の順位と、予定の抽出時間に対する進み具合の段", () => {
    // 1st：#1（1 杯）を 0 秒に、3rd：#2（2 杯）を 100 秒に始めた。2nd は待機だけ、ほかは空き
    const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
    const lanes = boardLanes(
      buildCaosCards([
        order(1, [
          { dripper: 1, dripId: "d1", dripperPosition: 1, brewStartedAt: T0 },
        ]),
        order(2, [
          {
            dripper: 3,
            dripId: "d2",
            dripperPosition: 1,
            brewStartedAt: at(100),
          },
          {
            dripper: 3,
            dripId: "d2",
            dripperPosition: 1,
            brewStartedAt: at(100),
          },
        ]),
        order(3, [{ dripper: 2, dripId: "d3", dripperPosition: 1 }]),
      ]),
    );
    const rows = liberoLanes(lanes, at(310).getTime());
    expect(
      rows.map(({ lane, brew }) => [
        lane.id,
        brew && { ...brew, card: brew.card.key },
      ]),
    ).toEqual([
      [
        1,
        {
          card: "d1",
          elapsedSec: 310,
          plannedSec: 300,
          progress: 1,
          overSec: 10,
          rank: 1,
          level: "overtime",
        },
      ],
      [2, undefined],
      [
        3,
        {
          card: "d2",
          elapsedSec: 210,
          plannedSec: 360,
          progress: 210 / 360,
          overSec: 0,
          rank: 2,
          level: 2,
        },
      ],
      [4, undefined],
      [5, undefined],
      [6, undefined],
    ]);
    expect(byElapsed(rows).map(({ lane }) => lane.id)).toEqual([
      1, 3, 2, 4, 5, 6,
    ]);
  });
});

describe("[unit] CaOS の注文番号の検索とコメント", () => {
  // #1：1st で抽出中、#2：1st の待機、#3 と #4：統合した未割当、#6：準備完了（盤面に出ない）
  const orders = [
    order(1, [
      { dripper: 1, dripId: "d1", dripperPosition: 1, brewStartedAt: T0 },
    ]),
    order(2, [{ dripper: 1, dripId: "d2", dripperPosition: 2 }]),
    order(3, [{ dripId: "m" }]),
    order(4, [{ dripId: "m" }]),
    order(6, [{ readyAt: T0 }]),
    // #7：3 杯を 3 枚に分けた（4th で終わり・5th で待機・6th で抽出中）
    order(7, [
      {
        dripper: 4,
        dripId: "d7a",
        dripperPosition: 1,
        brewStartedAt: T0,
        brewFinishedAt: T0,
      },
      { dripper: 5, dripId: "d7b", dripperPosition: 1 },
      { dripper: 6, dripId: "d7c", dripperPosition: 1, brewStartedAt: T0 },
    ]),
  ];
  const cards = buildCaosCards(orders);
  const comment = {
    author: "cashier" as const,
    text: "氷少なめ",
    createdAt: T0,
    orderNo: 3,
    orderId: "order-3",
  };
  const comments = new Map([["order-3", [comment]]]);
  const find = (orderNo: number) =>
    findOrder({
      orders,
      cards,
      lanes: boardLanes(cards),
      comments,
      orderNo,
      nowMs: T0.getTime() + 130_000,
    });

  test("注文の状態と、その注文のカードの場所（抽出中は始めてからの時間）を出す", () => {
    const places = (orderNo: number) =>
      find(orderNo)?.cards.map(({ place }) => place);
    expect(places(1)).toEqual(["1st 抽出中 2:10"]);
    expect(places(2)).toEqual(["1st 1番目"]);
    expect(places(4)).toEqual(["未割当"]);
    expect(find(1)?.status).toBe("preparing");
    expect(find(6)).toMatchObject({
      status: "ready",
      readyCups: 1,
      cards: [],
    });
    expect(find(99)).toBeNull();
  });

  test("見せるカードは、抽出中・待機・未割当・終わりの順に選ぶ", () => {
    const focus = (orderNo: number) => {
      const found = find(orderNo);
      return found && focusCard(found)?.key;
    };
    expect(find(7)?.cards.map(({ place }) => place)).toEqual([
      "4th 済",
      "5th 1番目",
      "6th 抽出中 2:10",
    ]);
    expect(focus(7)).toBe("d7c");
    expect(focus(3)).toBe("m");
  });

  test("統合したカードには中の注文のコメントが付き、選んだ注文のコメントだけを出す", () => {
    const looks = cardLooks(cards, [], new Map(), comments);
    expect(looks.get("m")?.comments).toEqual([comment]);
    expect(looks.get("d1")?.comments).toBeUndefined();
    expect(selectedComments(cards, looks, "#003")).toEqual([comment]);
    expect(find(4)?.comments).toEqual([]);
    expect(find(3)?.comments).toEqual([comment]);
    expect(selectedComments(cards, looks, "#004")).toEqual([]);
  });
});

describe("[unit] CaOS の終わったカードと提供済みのカード", () => {
  // #1：1st で「次へ」で終えた、#2：1st で抽出中（提供の画面で提供済み）、#3：1st の待機（2 杯のうち 1 杯だけ提供済み）
  const cards = buildCaosCards([
    order(1, [
      {
        dripper: 1,
        dripId: "d1",
        dripperPosition: 1,
        brewStartedAt: T0,
        brewFinishedAt: T0,
      },
    ]),
    order(2, [
      {
        dripper: 1,
        dripId: "d2",
        dripperPosition: 2,
        brewStartedAt: T0,
        readyAt: T0,
        servedAt: T0,
      },
    ]),
    order(3, [
      { dripper: 1, dripId: "d3", dripperPosition: 3, servedAt: T0 },
      { dripper: 1, dripId: "d3", dripperPosition: 3 },
    ]),
  ]);
  const lanes = boardLanes(cards);

  test("提供済みのカップがあっても抽出中・待機のまま。札は全部なら「提供済」、一部なら杯数", () => {
    expect(lanes[0].brewing?.key).toBe("d2");
    expect(lanes[0].queued.map((card) => card.key)).toEqual(["d3"]);
    const label = (key: string) =>
      cardServedLabel(cards.find((card) => card.key === key) as CaosCard);
    expect(label("d2")).toBe("提供済");
    expect(label("d3")).toBe("提供済 1/2");
    // 終わったカードには付けない
    expect(label("d1")).toBe("");
  });

  test("管制盤 D の表は、終わったカードを枠に出さず、淹れ終わった行は灰色の行として残す", () => {
    const sheet = buildSheet(lanes, [], new Map());
    expect(sheet.cells.get(cellKey(1, 1))?.entries ?? []).toEqual([]);
    expect(
      sheet.cells.get(cellKey(2, 1))?.entries.map((entry) => entry.state),
    ).toEqual(["current"]);
    expect(sheet.rows.find((row) => row.orderNo === 1)).toMatchObject({
      isPast: true,
      cups: 1,
    });
  });
});

describe("[unit] CaOS の未完了の注文とタブの印", () => {
  const at = (orderId: number, minutesAgo: number, cups: CupPlace[]) => ({
    ...order(orderId, cups),
    createdAt: new Date(T0.getTime() - minutesAgo * 60_000),
  });
  // #1：20 分前・1st で抽出中、#2：10 分前・未割当、#3：提供済み、#4：抽出を終えたが提供していない、#5：1 杯だけ準備完了、
  // #6：提供済みのカップを入れ直した（入れ直しが未割当）
  const rebrew = {
    id: "e6",
    createdAt: T0,
    reason: "こぼした",
    dripper: null,
    dripperPosition: null,
    dripId: null,
    brewStartedAt: null,
    brewFinishedAt: null,
  };
  const orders = [
    at(1, 20, [
      { dripper: 1, dripId: "d1", dripperPosition: 1, brewStartedAt: T0 },
    ]),
    at(2, 10, [{}]),
    at(3, 30, [{ readyAt: T0, servedAt: T0 }]),
    at(6, 0, [{ readyAt: T0, servedAt: T0, emergencies: [rebrew] }]),
    at(4, 5, [
      {
        dripper: 2,
        dripId: "d4",
        dripperPosition: 1,
        brewStartedAt: T0,
        brewFinishedAt: T0,
      },
    ]),
    at(5, 1, [{ readyAt: T0 }, {}]),
  ];
  const cards = buildCaosCards(orders);
  const comment = (text: string, author: "cashier" | "master" = "cashier") => ({
    author,
    text,
    createdAt: T0,
    orderNo: 2,
    orderId: "order-2",
  });
  const comments = new Map([
    ["order-2", [comment("氷少なめ"), comment("👍 了解", "master")]],
  ]);
  const rows = (practice = false) =>
    unfinishedOrders({
      orders,
      cards,
      lanes: boardLanes(cards),
      comments,
      nowMs: T0.getTime(),
      practice,
    });

  test("まだ提供していない注文を注文番号の順に、受けてからの時間（15 分超は late）と今の場所で", () => {
    expect(
      rows().map((row) => ({
        no: row.orderNo,
        late: row.late,
        places: row.cards.map(({ place }) => place),
        ready: row.readyCups,
      })),
    ).toEqual([
      { no: 1, late: true, places: ["1st 抽出中 0:00"], ready: 0 },
      { no: 2, late: false, places: ["未割当"], ready: 0 },
      { no: 4, late: false, places: ["2nd 済"], ready: 0 },
      { no: 5, late: false, places: ["未割当"], ready: 1 },
      { no: 6, late: false, places: ["未割当"], ready: 1 },
    ]);
    expect(rows()[1].comments).toHaveLength(2);
    expect(rows().map(unfinishedStates)).toEqual([
      ["1st 抽出中 0:00"],
      ["未割当"],
      ["2nd 済"],
      ["未割当", "準備完了 1/2"],
      ["未割当", "準備完了"],
    ]);
  });

  test("実データテストは、抽出の要るカップが全部抽出を終えた注文を済みとみる", () => {
    expect(rows(true).map((row) => row.orderNo)).toEqual([1, 2, 5, 6]);
  });

  test("タブの印は、まだ見ていない 15 分超の注文と新しいコメント（返したスタンプは数えない）。見たら消え、今の未完了に無いものは忘れる", () => {
    expect(isStampReply(comment("👍 了解", "master"))).toBe(true);
    expect(isStampReply(comment("👍 了解"))).toBe(false);
    const none = { late: [], comments: [] };
    const unseen = unseenAlerts(rows(), none);
    expect(unseen.late).toEqual(["order-1"]);
    expect(unseen.comments).toHaveLength(1);
    const seen = markSeen(rows(), { late: ["gone"], comments: [] }, unseen);
    expect(seen.late).toEqual(["order-1"]);
    expect(unseenAlerts(rows(), seen)).toEqual(none);
  });
});
