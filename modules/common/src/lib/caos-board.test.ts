import { describe, expect, test } from "vitest";
import type { Cup } from "../models/cup";
import {
  type CaosCard,
  type CaosOrderInput,
  assignWrites,
  buildCaosCards,
  canMergeCards,
  caosBrewSec,
  caosLane,
  cupNeedsBrew,
  cupSeniorOnly,
  itemMakesCup,
  mergeWrites,
  unassignWrites,
} from "./caos-board";
import laneCases from "./caos-lane-cases.json";
import { jstDate } from "./jst";

const NOW = new Date("2026-10-08T03:00:00Z"); // 日本時間 12:00
const DAY = jstDate(NOW.getTime());

// 抽出が要るか・上級生のみかは種類の名前で決める（cupNeedsBrew・cupSeniorOnly。本番の DB の種類の名前で作る）
const type = (name: string) => ({ name, display_name: name });
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
// 種類の名前に milk・others を含むカップは抽出が要らない
const milk = {
  id: "item-milk",
  name: "アイスミルク",
  abbr: "ミ",
  item_type: type("milk"),
};
const goods = {
  id: "item-goods",
  name: "グッズ",
  abbr: "グ",
  item_type: type("others"),
};
// 種類の名前に limited を含むカップは上級生のみ
const seniorOnly = {
  id: "item-sp",
  name: "スペシャル",
  abbr: "限",
  item_type: type("limited"),
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
    assignee = {},
    createdAt = NOW,
  }: { assignee?: Record<string, string>; createdAt?: Date } = {},
): CaosOrderInput => ({
  id: `order-${no}`,
  orderId: no,
  createdAt,
  menus: Array.from(new Set(cups.map((c) => c.orderMenuId))).map((line) => ({
    orderMenuId: line,
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
        cup({ item: goods }),
        cup({ item: blend, line: "line-2" }),
        cup({ item: blend, readyAt: NOW }),
      ],
      { assignee: { "line-2": " ３ " } },
    );
    const o2 = order(2, [cup({ item: blend })]);
    const cards = buildCaosCards([o2, o1], DAY);
    expect(
      cards.map((c) => [
        c.orderNo,
        c.status,
        c.cups.length,
        c.cups[0].item.name,
        c.cups[0].nominee,
      ]),
    ).toEqual([
      [1, "unassigned", 1, "ケニア", null],
      [1, "unassigned", 2, "ブレンド", null],
      [1, "unassigned", 1, "ブレンド", null],
      [1, "unassigned", 1, "ブレンド", "３"],
      [2, "unassigned", 1, "ブレンド", null],
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

  // TODO: C1（種類の makes_cup・needs_brew・senior_only）が入ったら、名前で決める前提ごとこのテストを消す
  test("カップを作るか・抽出が要るか・上級生のみかは種類の名前（部分一致）で決める", () => {
    const names = [
      "brend",
      "gourmet",
      "hot",
      "ice",
      "iceOre",
      "limited",
      "milk",
      "others",
    ];
    const of = (name: string) => ({
      item: { id: name, name, abbr: name, item_type: type(name) },
    });
    expect(names.filter(itemMakesCup)).toEqual([
      "brend",
      "gourmet",
      "hot",
      "ice",
      "iceOre",
      "limited",
      "milk",
    ]);
    expect(names.filter((name) => cupNeedsBrew(of(name)))).toEqual([
      "brend",
      "gourmet",
      "hot",
      "ice",
      "iceOre",
      "limited",
    ]);
    expect(names.filter((name) => cupSeniorOnly(of(name)))).toEqual([
      "limited",
    ]);
  });

  test("上級生のみは種類の名前に limited を含むカップのカードに出す", () => {
    const cards = buildCaosCards(
      [order(1, [cup({ item: seniorOnly }), cup({ item: blend })])],
      DAY,
    );
    expect(cards.map((c) => [c.cups[0].item.name, c.seniorOnly])).toEqual([
      ["ブレンド", false],
      ["スペシャル", true],
    ]);
  });

  test("今日の区切りは端末の時刻帯によらず日本時間の 0 時", () => {
    expect(jstDate(Date.parse("2026-10-07T14:59:59Z"))).toBe("2026-10-07");
    expect(jstDate(Date.parse("2026-10-07T15:00:00Z"))).toBe("2026-10-08");
  });

  test("抽出時間", () => {
    expect(caosBrewSec(1)).toBe(135);
    expect(caosBrewSec(2)).toBe(195);
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
        order(4, [cup({ item: blend }), cup({ item: blend, line: "n" })], {
          assignee: { n: "たくみ" },
        }),
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

  test("順番：どのカードの前に入れるか（insert_before）だけを送る。先頭は先頭のカードの前、途中はそのカードの前、無ければ最後", () => {
    const cards = board();
    const q2 = find(cards, (c) => c.dripId === "q2");
    const q3 = find(cards, (c) => c.dripId === "q3");
    const afterOf = (result: ReturnType<typeof assignWrites>) => {
      if (!("writes" in result)) throw new Error(result.error);
      return result.writes[0]?.after;
    };
    // 先頭：待機の先頭（q2）の前。抽出中のカードの前ではない
    const front = assignWrites(cards, q3, 1, { place: "front", newId });
    expect(afterOf(front)).toEqual({
      dripper: 1,
      drip_id: "q3",
      insert_before: "q2",
      start_brew: false,
    });
    expect("writes" in front && front.writes[0].before).toMatchObject({
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
    // 今と同じ場所なら何も書かない（最後のカードを最後へ・すぐ後ろのカードの前へ・先頭のカードを先頭へ）
    expect(assignWrites(cards, q3, 1, { newId })).toEqual({ writes: [] });
    expect(
      assignWrites(cards, q2, 1, { place: { beforeKey: "q3" }, newId }),
    ).toEqual({ writes: [] });
    expect(assignWrites(cards, q2, 1, { place: "front", newId })).toEqual({
      writes: [],
    });
    // 前に入れるカードがそのドリッパーの待機に無い（抽出中・ほかのドリッパー）
    expect(
      assignWrites(cards, card, 1, { place: { beforeKey: "brewing" }, newId }),
    ).toHaveProperty("error");
    expect(
      assignWrites(cards, card, 2, { place: { beforeKey: "q3" }, newId }),
    ).toHaveProperty("error");
  });

  test("指名（自由記述）のカードもどのドリッパーにも置ける。抽出中は動かせない", () => {
    const cards = board();
    const named = find(cards, (c) => c.cups[0].nominee === "たくみ");
    expect(assignWrites(cards, named, 1, { newId })).toHaveProperty("writes");
    expect(assignWrites(cards, named, 7, { newId })).toHaveProperty("error");
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
      drip_id: null,
      insert_before: null,
      start_brew: false,
    });
    expect(
      unassignWrites(find(cards, (c) => c.dripId === "brewing")),
    ).toHaveProperty("error");
  });

  test("統合：1 杯どうし・同じ商品・同じ指名。未割当は新しい dripId、待機は相手を card のカードに入れる（相手を先に書く）", () => {
    const cards = board();
    const o5 = find(cards, (c) => c.orderNo === 5);
    const o4 = find(cards, (c) => c.orderNo === 4 && !c.cups[0].nominee);
    const o6 = find(cards, (c) => c.orderNo === 6);
    const named = find(cards, (c) => c.cups[0].nominee === "たくみ");
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
    // 番号は送らない。サーバーが q2 のカードと同じ番号にする（ほかはずらさない）
    const q2After = {
      dripper: q2.dripper,
      drip_id: "q2",
      insert_before: null,
      start_brew: false,
    };
    expect(queued.writes).toEqual([
      {
        cup_ids: ids(q3),
        before: expect.objectContaining({ drip_id: "q3" }),
        after: q2After,
      },
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
    ]);
    expect(mergeWrites(q2, o5, newId)).toHaveProperty("error"); // 待機と未割当
  });

  test("書き込みの結果を組み立て直すと、統合したカードは 1 枚になる", () => {
    const cards = board();
    const o4 = find(cards, (c) => c.orderNo === 4 && !c.cups[0].nominee);
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
