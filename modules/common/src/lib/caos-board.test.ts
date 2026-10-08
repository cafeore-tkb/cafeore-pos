import { describe, expect, test } from "vitest";
import type { Cup } from "../models/cup";
import {
  type CaosCard,
  type CaosOrderInput,
  assignWrites,
  buildCaosCards,
  canMergeCards,
  caosDay,
  caosLane,
  mergeWrites,
  unassignWrites,
} from "./caos-board";

const NOW = new Date("2026-10-08T03:00:00Z"); // 日本時間 12:00
const DAY = caosDay(NOW);

const type = (name: string, flags: Partial<Cup["item"]["item_type"]> = {}) => ({
  name,
  display_name: name,
  makes_cup: true,
  needs_brew: true,
  senior_only: false,
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
// 抽出が要るかは種類の項目で決める（名前が hot でも needs_brew が false なら出さない）
const milk = {
  id: "item-milk",
  name: "アイスミルク",
  abbr: "ミ",
  item_type: type("hot", { needs_brew: false }),
};
const limited = {
  id: "item-sp",
  name: "限定",
  abbr: "限",
  item_type: type("ice", { senior_only: true }),
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
  ...init,
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
  test("未割当：注文ごと・商品ごと・指名ごとに分け、1 枚は最大 2 杯。抽出が要らないカップと準備完了のカップは出さない", () => {
    const o1 = order(
      1,
      [
        cup({ item: blend }),
        cup({ item: blend }),
        cup({ item: blend }),
        cup({ item: kenya }),
        cup({ item: milk }),
        cup({ item: blend, line: "line-2" }),
        cup({ item: blend, line: "line-3" }),
        cup({ item: blend, line: "line-4" }),
        cup({ item: blend, readyAt: NOW }),
      ],
      {
        // 指名は明細のドリッパーの番号。自由記述は番号に添えるだけ（表示は番号）。
        // 番号の無い自由記述だけの古い明細は、数字でも指名なし（表示は自由記述）
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
        c.nominatedDripper,
        c.cups[0].nominee,
      ]),
    ).toEqual([
      [1, "unassigned", 1, "ケニア", undefined, null],
      [1, "unassigned", 2, "ブレンド", undefined, null],
      [1, "unassigned", 1, "ブレンド", undefined, null],
      [1, "unassigned", 2, "ブレンド", 3, "3rd"],
      [1, "unassigned", 1, "ブレンド", undefined, "4"],
      [2, "unassigned", 1, "ブレンド", undefined, null],
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

  test("今日（日本時間）の注文だけを見る", () => {
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

  test("限定は種類の senior_only の印をそのまま出す（種類の名前は見ない）", () => {
    const cards = buildCaosCards(
      [order(1, [cup({ item: limited }), cup({ item: blend })])],
      DAY,
    );
    expect(cards.map((c) => [c.cups[0].item.name, c.seniorOnly])).toEqual([
      ["ブレンド", false],
      ["限定", true],
    ]);
  });
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
          { dripper: { n: 4 }, assignee: { old: "4" } },
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

  test("割当：未割当を待機に入れる（注文番号の順）。空いているドリッパーならそのまま始める（時刻はサーバーが付ける）", () => {
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
            dripper_position: 5,
            drip_id: expect.stringMatching(/^drip-/),
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
      dripper_position: 5,
      drip_id: expect.stringMatching(/^drip-/),
      start_brew: true,
    });
    expect(idle.writes[0].after).not.toHaveProperty("brew_started_at");
  });

  test("順番：待機の index 番目に入るよう前後の間の値にする。同じドリッパーで index が無ければ何もしない", () => {
    const cards = board();
    const q3 = find(cards, (c) => c.dripId === "q3");
    const front = assignWrites(cards, q3, 1, { index: 0, newId });
    expect("writes" in front && front.writes[0].after).toMatchObject({
      dripper: 1,
      dripper_position: 1,
      drip_id: "q3",
    });
    expect("writes" in front && front.writes[0].before).toMatchObject({
      dripper: 1,
      dripper_position: 3,
      drip_id: "q3",
    });
    const card = find(cards, (c) => c.orderNo === 5);
    const middle = assignWrites(cards, card, 1, { index: 1, newId });
    expect("writes" in middle && middle.writes[0].after.dripper_position).toBe(
      2.5,
    );
    expect(assignWrites(cards, q3, 1, { newId })).toEqual({
      writes: [],
    });
  });

  test("指名のあるカードはその番号のドリッパーだけ。抽出中は動かせない", () => {
    const cards = board();
    const named = find(cards, (c) => c.nominatedDripper === 4);
    expect(assignWrites(cards, named, 1, { newId })).toHaveProperty("error");
    expect(assignWrites(cards, named, 4, { newId })).toHaveProperty("writes");
    // 自由記述だけの古い明細は、数字でも指名なし（どこにでも置ける）
    const old = find(cards, (c) => c.cups[0].nominee === "4");
    expect(old.nominatedDripper).toBeUndefined();
    expect(assignWrites(cards, old, 1, { newId })).toHaveProperty("writes");
    expect(
      assignWrites(
        cards,
        find(cards, (c) => c.dripId === "brewing"),
        2,
        { newId },
      ),
    ).toHaveProperty("error");
  });

  test("未割当に戻す：待機だけ。値を全部空にする", () => {
    const cards = board();
    const q2 = find(cards, (c) => c.dripId === "q2");
    const result = unassignWrites(q2);
    expect("writes" in result && result.writes[0].after).toEqual({
      dripper: null,
      dripper_position: null,
      drip_id: null,
      start_brew: false,
    });
    expect(
      unassignWrites(find(cards, (c) => c.dripId === "brewing")),
    ).toHaveProperty("error");
  });

  test("統合：1 杯どうし・同じ商品・同じ指名。未割当は新しい dripId、待機は相手を同じ値にする", () => {
    const cards = board();
    const o5 = find(cards, (c) => c.orderNo === 5);
    const o4 = find(
      cards,
      (c) => c.orderNo === 4 && !c.nominatedDripper && !c.cups[0].nominee,
    );
    const o6 = find(cards, (c) => c.orderNo === 6);
    const named = find(cards, (c) => c.nominatedDripper === 4);
    expect(canMergeCards(o4, o5)).toBe(true);
    expect(canMergeCards(o5, o6)).toBe(false); // 商品が違う
    expect(canMergeCards(o4, named)).toBe(false); // 指名が違う
    const merged = mergeWrites(o4, o5, newId);
    if (!("writes" in merged)) throw new Error(merged.error);
    expect(merged.writes.map((w) => w.after.drip_id)).toEqual([
      merged.writes[0].after.drip_id,
      merged.writes[0].after.drip_id,
    ]);
    expect(merged.writes[0].after.dripper).toBeNull();

    const q2 = find(cards, (c) => c.dripId === "q2");
    const q3 = find(cards, (c) => c.dripId === "q3");
    const queued = mergeWrites(q2, q3, newId);
    if (!("writes" in queued)) throw new Error(queued.error);
    const q2After = {
      dripper: q2.dripper,
      dripper_position: q2.dripperPosition,
      drip_id: "q2",
      start_brew: false,
    };
    expect(queued.writes).toEqual([
      {
        cup_ids: ids(q2),
        before: {
          dripper: q2.dripper,
          dripper_position: q2.dripperPosition,
          drip_id: "q2",
          brew_started_at: null,
          brew_finished_at: null,
        },
        after: q2After,
      },
      {
        cup_ids: ids(q3),
        before: expect.objectContaining({ drip_id: "q3" }),
        after: q2After,
      },
    ]);
    expect(mergeWrites(q2, o5, newId)).toHaveProperty("error"); // 待機と未割当
  });

  test("書き込みの結果を組み立て直すと、統合したカードは 1 枚になる", () => {
    const cards = board();
    const o4 = find(
      cards,
      (c) => c.orderNo === 4 && !c.nominatedDripper && !c.cups[0].nominee,
    );
    const o5 = find(cards, (c) => c.orderNo === 5);
    const merged = mergeWrites(o4, o5, () => "merged");
    if (!("writes" in merged)) throw new Error(merged.error);
    const apply = (input: CaosOrderInput): CaosOrderInput => ({
      ...input,
      cups: input.cups.map((c) =>
        merged.writes.some((w) => w.cup_ids.includes(c.id))
          ? { ...c, dripId: "merged" }
          : c,
      ),
    });
    const o4cup = o4.cups[0];
    const o5cup = o5.cups[0];
    const after = buildCaosCards(
      [
        apply(order(4, [{ ...cup({ item: blend }), id: o4cup.id }])),
        apply(order(5, [{ ...cup({ item: blend }), id: o5cup.id }])),
      ],
      DAY,
    );
    expect(after.map((c) => [c.key, c.cups.map((x) => x.orderNo)])).toEqual([
      ["merged", [4, 5]],
    ]);
  });
});
