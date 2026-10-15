import { describe, expect, test } from "vitest";
import type { Cup } from "../models/cup";
import {
  CAOS_LATE_MERGE_SEC,
  type CaosCard,
  type CaosOrderInput,
  assignWrites,
  buildCaosCards,
  canMergeCards,
  canSplitCard,
  caosBrewSec,
  caosDripperAllowed,
  caosLane,
  caosLateMerge,
  caosMergePair,
  caosNextLocked,
  caosRebrewMergePair,
  caosRebrewsTogether,
  cupNeedsBrew,
  cupSeniorOnly,
  mergeWrites,
  moveQueueWrites,
  splitWrites,
  unassignWrites,
} from "./caos-board";
import laneCases from "./caos-lane-cases.json";
import { jstDate } from "./jst";

const NOW = new Date("2026-10-08T03:00:00Z"); // 日本時間 12:00
const DAY = jstDate(NOW.getTime());

// 抽出が要るか・上級生のみかは種類の項目で決める（cupNeedsBrew・cupSeniorOnly）。既定は POS の新しい種類と同じ
const type = (
  name: string,
  flags: Partial<Cup["item"]["item_type"]> = {},
): Cup["item"]["item_type"] => ({
  name,
  display_name: name,
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
  item_type: type("hot"),
};
const kenya = {
  id: "item-kenya",
  name: "ケニア",
  abbr: "ケ",
  item_type: type("hot"),
};
// ミルクはカップを作るが抽出は要らない。グッズはカップを作らない
const milk = {
  id: "item-milk",
  name: "アイスミルク",
  abbr: "ミ",
  item_type: type("milk", { needs_brew: false }),
};
const goods = {
  id: "item-goods",
  name: "グッズ",
  abbr: "グ",
  item_type: type("others", { makes_cup: false, needs_brew: false }),
};
// 上級生だけが淹れる種類
const seniorOnly = {
  id: "item-sp",
  name: "スペシャル",
  abbr: "限",
  item_type: type("limited", { senior_only: true }),
};

let seq = 0;
type CupInit = Partial<Cup> & { item: Cup["item"]; line?: string };
const cup = ({ line = "line-1", ...init }: CupInit): Cup => ({
  id: `cup-${++seq}`,
  orderMenuId: line,
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

// 緊急（入れ直し）の行。既定は未割当
const emergency = (
  id: string,
  at: Partial<Cup["emergencies"][number]> = {},
): Cup["emergencies"][number] => ({
  id,
  createdAt: NOW,
  reason: "",
  dripper: null,
  dripperPosition: null,
  dripId: null,
  brewStartedAt: null,
  brewFinishedAt: null,
  ...at,
});

const order = (
  no: number,
  cups: Cup[],
  {
    dripper = {},
    assignee = {},
    createdAt = NOW,
  }: {
    dripper?: Record<string, number>;
    assignee?: Record<string, string>;
    createdAt?: Date;
  } = {},
): CaosOrderInput => ({
  id: `order-${no}`,
  orderId: no,
  createdAt,
  menus: Array.from(new Set(cups.map((c) => c.orderMenuId))).map((line) => ({
    orderMenuId: line,
    dripper: dripper[line] ?? null,
    assignee: assignee[line] ?? null,
  })),
  cups,
});

const ids = (card: CaosCard) => card.cups.map((c) => c.id);
let idSeq = 0;
const newId = () => `drip-${++idSeq}`;

describe("[unit] CaOS の盤面の組み立て", () => {
  test("未割当：注文ごと・商品ごと・指名の番号ごとに分け、1 枚は最大 2 杯。抽出が要らないカップと準備完了のカップは出さない", () => {
    const o1 = order(
      1,
      [
        cup({ item: blend }),
        cup({ item: blend }),
        cup({ item: blend }),
        cup({ item: kenya }),
        cup({ item: milk }),
        cup({ item: goods }),
        cup({ item: blend, line: "line-2" }),
        cup({ item: blend, line: "line-3" }),
        cup({ item: blend, line: "line-4" }),
        cup({ item: blend, readyAt: NOW }),
      ],
      {
        // 指名は明細のドリッパーの番号。自由記述は番号に添えるだけ（表示は番号で、同じ番号なら 1 枚にまとめる）。
        // 番号の無い自由記述だけの古い明細は、数字でも指名なし（指名なしのカップと同じ分け方。表示は自由記述）
        dripper: { "line-2": 3, "line-3": 3 },
        assignee: { "line-3": " 山田 ", "line-4": " 4 " },
      },
    );
    const o2 = order(2, [cup({ item: blend })]);
    const cards = buildCaosCards([o2, o1], DAY);
    expect(
      cards.map((c) => [
        c.orderNo,
        c.status,
        c.cups.length,
        c.cups[0].item.name,
        c.cups.map((x) => x.nominatedDripper),
        c.cups.map((x) => x.nominee),
      ]),
    ).toEqual([
      [1, "unassigned", 1, "ケニア", [null], [null]],
      [1, "unassigned", 2, "ブレンド", [null, null], [null, null]],
      [1, "unassigned", 2, "ブレンド", [null, null], [null, "4"]],
      [1, "unassigned", 2, "ブレンド", [3, 3], ["3rd", "3rd"]],
      [2, "unassigned", 1, "ブレンド", [null], [null]],
    ]);
    // 未割当のキーはカップの ID の組
    expect(cards[0].key).toBe(`cups:${ids(cards[0]).join(",")}`);
  });

  test("ドリッパーに置いたカードの状態は時刻で決まり、カップが全部準備完了なら終わり", () => {
    const start = new Date(NOW.getTime() - 60_000);
    const placed = (dripId: string, at: Partial<Cup>) => ({
      item: blend,
      dripper: 2,
      dripperPosition: 1,
      dripId,
      ...at,
    });
    const cards = buildCaosCards(
      [
        order(1, [
          cup(placed("a", { brewStartedAt: start, brewFinishedAt: NOW })),
        ]),
        order(2, [
          cup(placed("b", { brewStartedAt: start })),
          cup(placed("b", { brewStartedAt: start })),
        ]),
        order(3, [cup(placed("c", { dripperPosition: 5 }))]),
        order(4, [cup(placed("d", { dripperPosition: 3 }))]),
        // マスターで準備完了にした待機のカード
        order(5, [cup(placed("e", { readyAt: start }))]),
      ],
      DAY,
    );
    const lane = caosLane(cards, 2);
    expect(lane.brewing?.dripId).toBe("b");
    expect(lane.brewing?.cups).toHaveLength(2);
    expect(lane.queued.map((c) => c.dripId)).toEqual(["d", "c"]);
    expect(lane.done.map((c) => [c.dripId, c.finishedAt])).toEqual([
      ["e", start],
      ["a", NOW],
    ]);
  });

  test("統合した未割当は dripId のカードになり、準備完了のカップは外れる", () => {
    const cards = buildCaosCards(
      [
        order(1, [cup({ item: blend, dripId: "m" })]),
        order(2, [cup({ item: blend, dripId: "m" })]),
        order(3, [
          cup({ item: blend, dripId: "n", readyAt: NOW }),
          cup({ item: blend, dripId: "n", line: "x" }),
        ]),
      ],
      DAY,
    );
    expect(
      cards.map((c) => [c.key, c.status, c.cups.map((x) => x.orderNo)]),
    ).toEqual([
      ["m", "unassigned", [1, 2]],
      ["n", "unassigned", [3]],
    ]);
  });

  test("緊急（入れ直し）：カップと同じ決まりのカードになり、未割当のいちばん上。準備完了のカップの入れ直しも出し、入れ直しは準備完了で終わりにしない", () => {
    const start = new Date(NOW.getTime() - 60_000);
    // 1 杯目は準備完了（最初の抽出は終わり）で、入れ直しが 2 回。1 回目は 3 番で抽出中、2 回目は未割当
    const brewed = cup({
      item: blend,
      readyAt: NOW,
      dripper: 1,
      dripperPosition: 1,
      dripId: "first",
      brewStartedAt: start,
      brewFinishedAt: NOW,
      emergencies: [
        emergency("e1", {
          dripper: 3,
          dripperPosition: 1,
          dripId: "redo",
          brewStartedAt: start,
        }),
        emergency("e2"),
      ],
    });
    const cards = buildCaosCards(
      [
        order(1, [cup({ item: kenya })]),
        order(2, [brewed], { dripper: { "line-1": 3 } }),
      ],
      DAY,
    );
    expect(
      cards.map((c) => [c.orderNo, c.status, c.emergency, c.dripper, ids(c)]),
    ).toEqual([
      [2, "unassigned", true, null, ["e2"]],
      [1, "unassigned", false, null, [cards[1].cups[0].id]],
      [2, "done", false, 1, [brewed.id]],
      [2, "brewing", true, 3, ["e1"]],
    ]);
    // 入れ直しは入れ直したカップの商品・指名で、書き込みの cup_ids は入れ直しの ID、before は入れ直しの列
    const redo = cards[0];
    expect(redo.cups[0]).toMatchObject({
      cupId: brewed.id,
      item: blend,
      nominatedDripper: 3,
    });
    expect(caosDripperAllowed(redo, 2)).toBe(false);
    expect(assignWrites(cards, redo, 3, { newId })).toEqual({
      writes: [
        {
          cup_ids: ["e2"],
          before: {
            dripper: null,
            dripper_position: null,
            drip_id: null,
            brew_started_at: null,
            brew_finished_at: null,
          },
          after: {
            dripper: 3,
            drip_id: expect.any(String),
            insert_before: null,
            start_brew: false,
          },
        },
      ],
    });

    // 入れ直しは入れ直しどうしでだけ統合できる（緊急でないカップと同じカードにすると、緊急の取り消しと食い違う）。
    // 指名は、同じ番号か片方だけ
    const nominated = cup({ item: blend, line: "line-2" });
    const free = cup({ item: blend, line: "line-3" });
    const otherRedo = cup({
      item: blend,
      line: "line-4",
      emergencies: [emergency("e3")],
    });
    const withPeers = buildCaosCards(
      [
        order(2, [brewed, nominated], {
          dripper: { "line-1": 3, "line-2": 3 },
        }),
        order(3, [free, otherRedo]),
      ],
      DAY,
    );
    const cardOf = (id: string) => {
      const card = withPeers.find((c) => ids(c)[0] === id);
      if (!card) throw new Error(id);
      return card;
    };
    const redoCard = cardOf("e2");
    expect(canMergeCards(redoCard, cardOf(nominated.id))).toBe(false);
    expect(canMergeCards(cardOf(free.id), redoCard)).toBe(false);
    expect(canMergeCards(cardOf("e3"), redoCard)).toBe(true);
    expect(mergeWrites(cardOf("e3"), redoCard, newId)).toHaveProperty("writes");
  });

  test("今日（日本時間。端末の時刻帯によらず 0 時で区切る）の注文だけを見る", () => {
    const yesterday = new Date("2026-10-07T14:59:59Z"); // 日本時間 10/7 23:59:59
    const midnight = new Date("2026-10-07T15:00:00Z"); // 日本時間 10/8 0:00
    const cards = buildCaosCards(
      [
        order(1, [cup({ item: blend })], { createdAt: yesterday }),
        order(2, [cup({ item: blend })], { createdAt: midnight }),
      ],
      DAY,
    );
    expect(cards.map((c) => c.orderNo)).toEqual([2]);
  });

  test("抽出が要るか・上級生のみかは種類の名前でなく項目で決める", () => {
    const of = (item_type: Cup["item"]["item_type"]) => ({
      item: { id: "x", name: "x", abbr: "x", item_type },
    });
    // 名前が milk でも抽出が要る種類なら要る。名前が hot でも抽出が要らない種類なら要らない
    expect(cupNeedsBrew(of(type("milk")))).toBe(true);
    expect(cupNeedsBrew(of(type("hot", { needs_brew: false })))).toBe(false);
    // カップを作らない種類は抽出も要らない
    expect(cupNeedsBrew(of(type("hot", { makes_cup: false })))).toBe(false);
    // 上級生のみは senior_only の種類だけ（名前が limited でも項目が false なら違う）。抽出が要らなければ違う
    expect(cupSeniorOnly(of(type("limited")))).toBe(false);
    expect(cupSeniorOnly(of(type("hot", { senior_only: true })))).toBe(true);
    expect(
      cupSeniorOnly(of(type("hot", { senior_only: true, needs_brew: false }))),
    ).toBe(false);
  });

  test("上級生のみは上級生だけが淹れる種類のカップのカードに出す", () => {
    const cards = buildCaosCards(
      [order(1, [cup({ item: seniorOnly }), cup({ item: blend })])],
      DAY,
    );
    expect(cards.map((c) => [c.cups[0].item.name, c.seniorOnly])).toEqual([
      ["ブレンド", false],
      ["スペシャル", true],
    ]);
  });

  test("抽出時間", () => {
    expect(caosBrewSec(1)).toBe(300);
    expect(caosBrewSec(2)).toBe(360);
  });
});

// API の「次へ」（splitCaosLane）と同じ例で、同じ結果になるか（caos-lane-cases.json。API のテストも同じ例を読む）
describe("[unit] CaOS のドリッパーの列（API と同じ決まり）", () => {
  const at = new Date(NOW.getTime() - 60_000);
  for (const c of laneCases.cases) {
    test(c.name, () => {
      const byOrder = new Map<number, Cup[]>();
      for (const x of c.cups) {
        byOrder.set(x.order_no, [
          ...(byOrder.get(x.order_no) ?? []),
          cup({
            item: blend,
            dripper: 1,
            dripperPosition: x.dripper_position,
            dripId: x.drip_id,
            brewStartedAt: x.started ? at : null,
            brewFinishedAt: x.finished ? at : null,
            readyAt: x.ready ? at : null,
          }),
        ]);
      }
      const orders = [...byOrder].map(([no, cups]) => order(no, cups));
      const lane = caosLane(buildCaosCards(orders, DAY), 1);
      expect(lane.brewing?.dripId ?? null).toBe(c.brewing);
      expect(lane.queued.map((card) => card.dripId)).toEqual(c.queued);
    });
  }
});

describe("[unit] CaOS の書き込み", () => {
  const start = new Date(NOW.getTime() - 60_000);
  const board = () =>
    buildCaosCards(
      [
        order(1, [
          cup({
            item: blend,
            dripper: 1,
            dripperPosition: 1,
            dripId: "brewing",
            brewStartedAt: start,
          }),
        ]),
        order(2, [
          cup({ item: blend, dripper: 1, dripperPosition: 2, dripId: "q2" }),
        ]),
        order(3, [
          cup({ item: blend, dripper: 1, dripperPosition: 3, dripId: "q3" }),
        ]),
        order(
          4,
          [
            cup({ item: blend }),
            cup({ item: blend, line: "n" }),
            cup({ item: blend, line: "old" }),
          ],
          // n は 4 番の指名（自由記述つき）、old は番号の無い自由記述だけの古い明細
          { dripper: { n: 4 }, assignee: { n: "たくみ", old: "4" } },
        ),
        order(5, [cup({ item: blend })]),
        order(6, [cup({ item: kenya })]),
      ],
      DAY,
    );
  const find = (cards: CaosCard[], pred: (c: CaosCard) => boolean) => {
    const card = cards.find(pred);
    if (!card) throw new Error("no card");
    return card;
  };

  test("割当：未割当を待機の最後に入れる（insert_before は null。番号はサーバーが決める）。空いているドリッパーならそのまま始める（時刻はサーバーが付ける）", () => {
    const cards = board();
    const card = find(cards, (c) => c.orderNo === 5);
    expect(assignWrites(cards, card, 1, { newId })).toEqual({
      writes: [
        {
          cup_ids: ids(card),
          before: {
            dripper: null,
            dripper_position: null,
            drip_id: null,
            brew_started_at: null,
            brew_finished_at: null,
          },
          after: {
            dripper: 1,
            drip_id: expect.stringMatching(/^drip-/),
            insert_before: null,
            start_brew: false,
          },
        },
      ],
    });
    // 空いているドリッパー：時刻の代わりに「始める」の印を送る（iPad の時計の時刻は送らない）
    const idle = assignWrites(cards, card, 3, { newId });
    if (!("writes" in idle)) throw new Error(idle.error);
    expect(idle.writes[0].after).toEqual({
      dripper: 3,
      drip_id: expect.stringMatching(/^drip-/),
      insert_before: null,
      start_brew: true,
    });
    expect(idle.writes[0].after).not.toHaveProperty("brew_started_at");
    // 順番の数は送らない
    expect(idle.writes[0].after).not.toHaveProperty("dripper_position");
  });

  test("順番：どのカードの前に入れるか（insert_before）だけを送る。待機の先頭は先頭のカードの前、途中はそのカードの前、無ければ最後", () => {
    const cards = board();
    const q2 = find(cards, (c) => c.dripId === "q2");
    const q3 = find(cards, (c) => c.dripId === "q3");
    const afterOf = (result: ReturnType<typeof assignWrites>) => {
      if (!("writes" in result)) throw new Error(result.error);
      return result.writes[0]?.after;
    };
    // 待機の先頭：待機の先頭（q2）の前
    const head = assignWrites(cards, q3, 1, {
      place: { beforeKey: "q2" },
      newId,
    });
    expect(afterOf(head)).toEqual({
      dripper: 1,
      drip_id: "q3",
      insert_before: "q2",
      start_brew: false,
    });
    expect("writes" in head && head.writes[0].before).toMatchObject({
      dripper: 1,
      dripper_position: 3,
      drip_id: "q3",
    });
    // 途中：未割当のカードを q3 の前（q2 と q3 の間）へ
    const card = find(cards, (c) => c.orderNo === 5);
    expect(
      afterOf(
        assignWrites(cards, card, 1, { place: { beforeKey: "q3" }, newId }),
      ),
    ).toMatchObject({ dripper: 1, insert_before: "q3", start_brew: false });
    // 最後：insert_before は null（同じドリッパーの中でも）
    expect(afterOf(assignWrites(cards, q2, 1, { newId }))).toMatchObject({
      dripper: 1,
      drip_id: "q2",
      insert_before: null,
    });
    // 別のドリッパーの先頭：待機が無ければ最後と同じ（空いていれば始める）
    expect(
      afterOf(assignWrites(cards, q2, 2, { place: "front", newId })),
    ).toEqual({
      dripper: 2,
      drip_id: "q2",
      insert_before: null,
      start_brew: true,
    });
    // 今と同じ場所なら何も書かない（最後のカードを最後へ・すぐ後ろのカードの前へ・抽出中のカードを先頭へ）
    expect(assignWrites(cards, q3, 1, { newId })).toEqual({ writes: [] });
    expect(
      assignWrites(cards, q2, 1, { place: { beforeKey: "q3" }, newId }),
    ).toEqual({ writes: [] });
    const brewing = find(cards, (c) => c.dripId === "brewing");
    expect(assignWrites(cards, brewing, 1, { place: "front", newId })).toEqual({
      writes: [],
    });
    expect(
      assignWrites(cards, brewing, 1, { place: { beforeKey: "q2" }, newId }),
    ).toEqual({ writes: [] });
    // 前に入れるカードがそのドリッパーの列に無い（ほかのドリッパー）
    expect(
      assignWrites(cards, card, 2, { place: { beforeKey: "q3" }, newId }),
    ).toHaveProperty("error");
  });

  test("列の先頭は抽出中：先頭（抽出中のカードの前）に入れたら今から始め、抽出中だったカードは始めた時刻を消して待機の先頭へ", () => {
    const cards = board();
    const q3 = find(cards, (c) => c.dripId === "q3");
    const o5 = find(cards, (c) => c.orderNo === 5);
    const brewingBefore = {
      dripper: 1,
      dripper_position: 1,
      drip_id: "brewing",
      brew_started_at: start.toISOString(),
      brew_finished_at: null,
    };
    // 待機のカードを先頭へ：抽出中のカードを待機の先頭（q2 の前）に下げ、q3 を始める
    const front = [
      {
        cup_ids: ids(find(cards, (c) => c.dripId === "brewing")),
        before: brewingBefore,
        after: {
          dripper: 1,
          drip_id: "brewing",
          insert_before: "q2",
          start_brew: false,
        },
      },
      {
        cup_ids: ids(q3),
        before: expect.objectContaining({ drip_id: "q3" }),
        after: {
          dripper: 1,
          drip_id: "q3",
          insert_before: null,
          start_brew: true,
        },
      },
    ];
    expect(assignWrites(cards, q3, 1, { place: "front", newId })).toEqual({
      writes: front,
    });
    // 抽出中のカードの前に落としても同じ
    expect(
      assignWrites(cards, q3, 1, { place: { beforeKey: "brewing" }, newId }),
    ).toEqual({ writes: front });
    // 未割当のカードを先頭へ
    const assigned = assignWrites(cards, o5, 1, { place: "front", newId });
    expect("writes" in assigned && assigned.writes.map((w) => w.after)).toEqual(
      [
        front[0].after,
        {
          dripper: 1,
          drip_id: expect.stringMatching(/^drip-/),
          insert_before: null,
          start_brew: true,
        },
      ],
    );
  });

  test("抽出中のカードを動かす：先頭でない所なら始めた時刻を消して待機に。同じ列で下げたら次のカードを今から始め、ほかの列へ移したら元の列は始めない", () => {
    const cards = board();
    const brewing = find(cards, (c) => c.dripId === "brewing");
    const q2 = find(cards, (c) => c.dripId === "q2");
    const writesOf = (result: ReturnType<typeof assignWrites>) => {
      if (!("writes" in result)) throw new Error(result.error);
      return result.writes.map((w) => [w.cup_ids, w.after]);
    };
    // 同じ列の q3 の前へ：抽出中を待機に下げ、先頭になった q2 を始める
    expect(
      writesOf(
        assignWrites(cards, brewing, 1, { place: { beforeKey: "q3" }, newId }),
      ),
    ).toEqual([
      [
        ids(brewing),
        {
          dripper: 1,
          drip_id: "brewing",
          insert_before: "q3",
          start_brew: false,
        },
      ],
      [
        ids(q2),
        { dripper: 1, drip_id: "q2", insert_before: null, start_brew: true },
      ],
    ]);
    // 同じ列の最後へ
    expect(writesOf(assignWrites(cards, brewing, 1, { newId }))).toEqual([
      [
        ids(brewing),
        {
          dripper: 1,
          drip_id: "brewing",
          insert_before: null,
          start_brew: false,
        },
      ],
      [
        ids(q2),
        { dripper: 1, drip_id: "q2", insert_before: null, start_brew: true },
      ],
    ]);
    // 空いている列へ：そのまま今から始める（元の列の q2 は始めない）
    expect(
      writesOf(assignWrites(cards, brewing, 2, { place: "front", newId })),
    ).toEqual([
      [
        ids(brewing),
        {
          dripper: 2,
          drip_id: "brewing",
          insert_before: null,
          start_brew: true,
        },
      ],
    ]);
    // 抽出中が無く待機のある列の先頭は、待機の先頭（始めない）
    const moved = buildCaosCards(
      [
        order(1, [
          cup({
            item: blend,
            dripper: 1,
            dripperPosition: 1,
            dripId: "brewing",
            brewStartedAt: start,
          }),
        ]),
        order(2, [
          cup({ item: blend, dripper: 2, dripperPosition: 1, dripId: "w" }),
        ]),
      ],
      DAY,
    );
    expect(
      writesOf(
        assignWrites(
          moved,
          find(moved, (c) => c.dripId === "brewing"),
          2,
          {
            place: "front",
            newId,
          },
        ),
      ),
    ).toEqual([
      [
        ids(find(moved, (c) => c.dripId === "brewing")),
        {
          dripper: 2,
          drip_id: "brewing",
          insert_before: "w",
          start_brew: false,
        },
      ],
    ]);
    // 未割当に戻す：ドリッパー・順番・始めた時刻を消す
    expect(unassignWrites(brewing)).toEqual({
      writes: [
        {
          cup_ids: ids(brewing),
          before: expect.objectContaining({
            brew_started_at: start.toISOString(),
          }),
          after: {
            dripper: null,
            drip_id: null,
            insert_before: null,
            start_brew: false,
          },
        },
      ],
    });
  });

  test("指名の番号のカードはその番号のドリッパーにだけ置ける。自由記述だけの古い明細はどこにでも。終わったカードは動かせない", () => {
    const cards = board();
    const named = find(cards, (c) => c.cups[0].nominatedDripper === 4);
    expect(named.cups[0].nominee).toBe("4th");
    expect(caosDripperAllowed(named, 1)).toBe(false);
    expect(assignWrites(cards, named, 1, { newId })).toEqual({
      error: "指名のあるカードは 4th のドリッパーにしか置けません",
    });
    expect(assignWrites(cards, named, 4, { newId })).toHaveProperty("writes");
    expect(assignWrites(cards, named, 7, { newId })).toHaveProperty("error");
    const old = find(cards, (c) => c.cups.some((x) => x.nominee === "4"));
    expect(old.cups.map((x) => x.nominatedDripper)).toEqual([null, null]);
    expect(caosDripperAllowed(old, 1)).toBe(true);
    expect(assignWrites(cards, old, 1, { newId })).toHaveProperty("writes");
    const brewing = find(cards, (c) => c.dripId === "brewing");
    expect(
      assignWrites(cards, { ...brewing, status: "done" }, 2, { newId }),
    ).toEqual({ error: "終わったカードは動かせません" });
  });

  test("未割当に戻す：待機・抽出中だけ。値を全部空にする", () => {
    const cards = board();
    const q2 = find(cards, (c) => c.dripId === "q2");
    const result = unassignWrites(q2);
    expect("writes" in result && result.writes[0].after).toEqual({
      dripper: null,
      drip_id: null,
      insert_before: null,
      start_brew: false,
    });
    const brewing = find(cards, (c) => c.dripId === "brewing");
    expect(unassignWrites(brewing)).toHaveProperty("writes");
    expect(unassignWrites({ ...brewing, status: "done" })).toHaveProperty(
      "error",
    );
  });

  test("統合：1 杯どうし・同じ商品。指名は片方だけか同じ番号。card を into のカードに入れ（into を後に同じ値で書く）、into の場所のまま", () => {
    const cards = board();
    const o5 = find(cards, (c) => c.orderNo === 5);
    const o6 = find(cards, (c) => c.orderNo === 6);
    const named = find(cards, (c) => c.nominatedDripper === 4);
    expect(canMergeCards(o5, o6)).toBe(false); // 商品が違う
    // 指名なしは指名のカードに入れられる（カードの指名はその番号）。違う番号どうしはだめ
    expect(canMergeCards(o5, named)).toBe(true);
    const named2 = buildCaosCards(
      [order(7, [cup({ item: blend })], { dripper: { "line-1": 2 } })],
      DAY,
    )[0];
    expect(canMergeCards(named2, named)).toBe(false);
    const mergedNamed = buildCaosCards(
      [
        order(5, [cup({ item: blend, dripId: "m" })]),
        order(7, [cup({ item: blend, dripId: "m" })], {
          dripper: { "line-1": 4 },
        }),
      ],
      DAY,
    )[0];
    expect(mergedNamed.nominatedDripper).toBe(4);
    expect(caosDripperAllowed(mergedNamed, 1)).toBe(false);

    const o8 = buildCaosCards([order(8, [cup({ item: blend })])], DAY)[0];
    expect(canMergeCards(o8, o5)).toBe(true);
    const merged = mergeWrites(o8, o5, newId);
    if (!("writes" in merged)) throw new Error(merged.error);
    expect(merged.writes.map((w) => w.cup_ids)).toEqual([ids(o8), ids(o5)]);
    expect(merged.writes[1].after).toEqual(merged.writes[0].after);
    expect(merged.writes[0].after.dripper).toBeNull();

    // 待機どうし：q2 を q3 のカードへ。番号は送らない（サーバーが q3 と同じ番号にする。ほかはずらさない）
    const q2 = find(cards, (c) => c.dripId === "q2");
    const q3 = find(cards, (c) => c.dripId === "q3");
    const queued = mergeWrites(q2, q3, newId);
    if (!("writes" in queued)) throw new Error(queued.error);
    const q3After = {
      dripper: 1,
      drip_id: "q3",
      insert_before: null,
      start_brew: false,
    };
    expect(queued.writes).toEqual([
      {
        cup_ids: ids(q2),
        before: expect.objectContaining({ drip_id: "q2" }),
        after: q3After,
      },
      {
        cup_ids: ids(q3),
        before: {
          dripper: 1,
          dripper_position: 3,
          drip_id: "q3",
          brew_started_at: null,
          brew_finished_at: null,
        },
        after: q3After,
      },
    ]);
    // 未割当を待機のカードへ（そのドリッパーの待機に入る）
    const intoQueued = mergeWrites(o5, q2, newId);
    expect("writes" in intoQueued && intoQueued.writes[0].after).toEqual({
      dripper: 1,
      drip_id: "q2",
      insert_before: null,
      start_brew: false,
    });
    // 指名の番号のドリッパーでない待機には入れない
    expect(canMergeCards(named, q2)).toBe(false);
  });

  test("抽出を始めたカードにも 1 杯を足せる（抽出中のカードは書かない。開始の時刻はサーバーが写す）。抽出中のカードから統合しても相手を抽出中のカードに入れ、終わったカードには入れない", () => {
    const cards = board();
    const brewing = find(cards, (c) => c.dripId === "brewing");
    const o5 = find(cards, (c) => c.orderNo === 5);
    const result = mergeWrites(o5, brewing, newId);
    expect(result).toEqual({
      writes: [
        {
          cup_ids: ids(o5),
          before: expect.objectContaining({ drip_id: null }),
          after: {
            dripper: 1,
            drip_id: "brewing",
            insert_before: null,
            start_brew: false,
          },
        },
      ],
    });
    // 抽出中のカードを相手に統合しても、抽出中のカードの dripId は変えず、相手（待機・未割当）を抽出中のカードに入れる
    expect(caosMergePair(brewing, o5)).toEqual({ card: o5, into: brewing });
    expect(mergeWrites(brewing, o5, newId)).toEqual(result);
    const q2 = find(cards, (c) => c.dripId === "q2");
    expect(caosMergePair(brewing, q2)).toEqual({ card: q2, into: brewing });
    // 逆向きでも、入るカード（抽出中）のドリッパーに置けないカード（4 番の指名）は入れない
    const named = find(cards, (c) => c.nominatedDripper === 4);
    expect(caosMergePair(brewing, named)).toBeNull();
    // 抽出中どうし・終わったカードとは統合しない
    const other = { ...brewing, key: "other", dripId: "other" };
    expect(canMergeCards(brewing, other)).toBe(false);
    const done = { ...brewing, key: "done", status: "done" as const };
    expect(canMergeCards(o5, done)).toBe(false);
    expect(canMergeCards(done, o5)).toBe(false);
  });

  test("統合の解除：ほかの注文と統合した未割当・待機のカードから選んだ 1 杯を未割当に戻す（残りはそのまま）", () => {
    const merged = buildCaosCards(
      [
        order(2, [
          cup({ item: blend, dripper: 3, dripperPosition: 5, dripId: "m" }),
        ]),
        order(9, [
          cup({ item: blend, dripper: 3, dripperPosition: 5, dripId: "m" }),
        ]),
      ],
      DAY,
    )[0];
    expect(canSplitCard(merged)).toBe(true);
    const later = merged.cups[1];
    expect(splitWrites(merged, later.id)).toEqual({
      writes: [
        {
          cup_ids: [later.id],
          before: {
            dripper: 3,
            dripper_position: 5,
            drip_id: "m",
            brew_started_at: null,
            brew_finished_at: null,
          },
          after: {
            dripper: null,
            drip_id: null,
            insert_before: null,
            start_brew: false,
          },
        },
      ],
    });
    // 同じ注文の同じ商品の 2 杯（はじめから 1 枚のカード）・1 杯・抽出中のカードは分けない
    const cards = board();
    const pair = find(cards, (c) => c.orderNo === 4 && c.cups.length === 2);
    expect(canSplitCard(pair)).toBe(false);
    expect(splitWrites(pair, pair.cups[0].id)).toHaveProperty("error");
    expect(canSplitCard(find(cards, (c) => c.orderNo === 5))).toBe(false);
    const brewing2 = { ...merged, status: "brewing" as const };
    expect(splitWrites(brewing2, later.id)).toHaveProperty("error");
  });

  test("統合したカードから全部の杯を入れ直したら、足した入れ直しを元のカードと同じ組み合わせの 1 枚（未割当）にまとめる", () => {
    const started = new Date(NOW.getTime() - 60_000);
    const brewed = { dripper: 3, dripperPosition: 1, dripId: "m" };
    const a = cup({ item: blend, ...brewed, brewStartedAt: started });
    const b = cup({ item: blend, ...brewed, brewStartedAt: started });
    const other = cup({ item: blend, line: "line-2" });
    const before = buildCaosCards([order(11, [a, other]), order(12, [b])], DAY);
    // 元のカード（#011+#012）と同じ組み合わせだけ。1 杯だけ・ほかのカップを混ぜたら別々のまま
    expect(caosRebrewsTogether(before, [b.id, a.id])).toBe(true);
    expect(caosRebrewsTogether(before, [a.id])).toBe(false);
    expect(caosRebrewsTogether(before, [other.id, b.id])).toBe(false);
    expect(caosRebrewsTogether(before, [a.id, b.id, other.id])).toBe(false);

    // 足した入れ直しは注文ごとに別々のカードで届く。届いていなければ待つ（null）
    const added = (emergencies: Record<string, string[]>) =>
      buildCaosCards(
        [
          order(11, [
            {
              ...a,
              emergencies: (emergencies[a.id] ?? []).map((id) => emergency(id)),
            },
            other,
          ]),
          order(12, [
            {
              ...b,
              emergencies: (emergencies[b.id] ?? []).map((id) => emergency(id)),
            },
          ]),
        ],
        DAY,
      );
    expect(caosRebrewMergePair(added({ [a.id]: ["e1"] }), ["e1", "e2"])).toBe(
      "arriving",
    );
    const arrived = added({ [a.id]: ["e1"], [b.id]: ["e2"] });
    expect(arrived.filter((c) => c.emergency).map(ids)).toEqual([
      ["e1"],
      ["e2"],
    ]);
    const pair = caosRebrewMergePair(arrived, ["e1", "e2"]);
    if (!pair || pair === "arriving") throw new Error("not mergeable");
    expect([ids(pair.card), ids(pair.into)]).toEqual([["e1"], ["e2"]]);
    const merged = mergeWrites(pair.card, pair.into, newId);
    if (!("writes" in merged)) throw new Error(merged.error);
    expect(merged.writes.map((w) => [w.cup_ids, w.after])).toEqual([
      [
        ["e1"],
        {
          dripper: null,
          drip_id: expect.any(String),
          insert_before: null,
          start_brew: false,
        },
      ],
      [["e2"], merged.writes[0].after],
    ]);
    // 届くまでに動かした（未割当でない）・もう 1 枚なら、まとめない
    const moved = arrived.map((c) =>
      ids(c)[0] === "e2" ? { ...c, status: "queued" as const } : c,
    );
    expect(caosRebrewMergePair(moved, ["e1", "e2"])).toBeNull();
    const one = buildCaosCards(
      [
        order(11, [
          { ...a, emergencies: [emergency("e1")] },
          { ...other, emergencies: [emergency("e3")] },
        ]),
      ],
      DAY,
    );
    expect(one.filter((c) => c.emergency).map(ids)).toEqual([["e1", "e3"]]);
    expect(caosRebrewMergePair(one, ["e1", "e3"])).toBeNull();
  });

  test("待機を丸ごと別のドリッパーへ：並びのまま最後に入れる。置けないカードは残す。空いていれば先頭を始める", () => {
    const cards = buildCaosCards(
      [
        order(1, [
          cup({ item: blend, dripper: 2, dripperPosition: 1, dripId: "a" }),
        ]),
        order(
          2,
          [cup({ item: blend, dripper: 2, dripperPosition: 2, dripId: "n" })],
          {
            dripper: { "line-1": 2 },
          },
        ),
        order(3, [
          cup({
            item: seniorOnly,
            dripper: 2,
            dripperPosition: 3,
            dripId: "s",
          }),
        ]),
        order(4, [
          cup({ item: blend, dripper: 2, dripperPosition: 4, dripId: "b" }),
        ]),
      ],
      DAY,
    );
    const result = moveQueueWrites(cards, 2, 5, (card) =>
      card.seniorOnly ? "上級生のみ" : null,
    );
    if (!("writes" in result)) throw new Error(result.error);
    expect(result.kept).toBe(2);
    expect(
      result.writes.map((w) => [w.after.drip_id, w.after.start_brew]),
    ).toEqual([
      ["a", true],
      ["b", false],
    ]);
    expect(moveQueueWrites(cards, 2, 2)).toHaveProperty("error");
  });

  test("「次へ」は始めてから 10 秒は押せない", () => {
    const startedAt = new Date(NOW.getTime());
    expect(caosNextLocked({ startedAt }, NOW.getTime() + 9_999)).toBe(true);
    expect(caosNextLocked({ startedAt }, NOW.getTime() + 10_000)).toBe(false);
    expect(caosNextLocked(undefined, NOW.getTime())).toBe(false);
  });

  test("抽出を始めてから CAOS_LATE_MERGE_SEC 秒を過ぎたカードへの統合は確かめる（始めてからの秒）", () => {
    const late = NOW.getTime() + CAOS_LATE_MERGE_SEC * 1000;
    const brewing = { status: "brewing" as const, startedAt: NOW };
    expect(caosLateMerge(brewing, late)).toBeNull();
    expect(caosLateMerge(brewing, late + 1)).toBe(CAOS_LATE_MERGE_SEC);
    expect(caosLateMerge(brewing, late + 45_000)).toBe(
      CAOS_LATE_MERGE_SEC + 45,
    );
    // 待機・未割当のカードへの統合は確かめない
    for (const status of ["queued", "unassigned"] as const)
      expect(caosLateMerge({ status, startedAt: null }, late + 1)).toBeNull();
  });
});
