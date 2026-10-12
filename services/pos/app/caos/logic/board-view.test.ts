import { type CaosOrderInput, type Cup, buildCaosCards } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import {
  cardLooks,
  orderLabel,
  orderRows,
  queueRows,
  sharesOrder,
} from "./cards";
import { boardLanes, cardPlaces, pendingNominatedCups } from "./lanes";
import { earlyNext, laneStatus, laneTimes } from "./queue";
import { linkedOrderNos } from "./sheet";

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
    | "readyAt"
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

  test("統合したカードは小さい注文の行に置き、もう一方の注文の行に跡を残す", () => {
    const rows = orderRows(unassigned).map(({ orderNo, entries }) => ({
      orderNo,
      entries: entries.map((entry) => entry.mergedInto ?? entry.card.key),
    }));
    expect(rows).toEqual([
      { orderNo: 2, entries: ["cups:cup-2-0"] },
      { orderNo: 3, entries: ["m"] },
      { orderNo: 4, entries: ["#003+#004"] },
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
    const rows = orderRows(
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

  test("管制盤 C の注文の列は、いちばん古い未割当の注文から。その上に直近のドリッパーに置いた注文を 3 件だけ残す", () => {
    const placed = (orderId: number, dripId: string) =>
      order(orderId, [{ dripper: 3, dripId, dripperPosition: orderId }]);
    const rows = queueRows(
      buildCaosCards([
        placed(1, "p1"),
        placed(2, "p2"),
        placed(3, "p3"),
        placed(4, "p4"),
        order(5, [
          { dripper: 4, dripId: "done5", brewStartedAt: T0, readyAt: T0 },
        ]),
        order(6, [{}]),
        placed(7, "p7"),
      ]),
    );
    expect(
      rows.map(({ orderNo, entries }) => [
        orderNo,
        entries.map(({ card }) => card.status),
      ]),
    ).toEqual([
      [2, ["queued"]],
      [3, ["queued"]],
      [4, ["queued"]],
      [6, ["unassigned"]],
      [7, ["queued"]],
    ]);
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
});
