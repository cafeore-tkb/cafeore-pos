import { describe, expect, test } from "vitest";
import type { Cup } from "../models/cup";
import {
  type CaosCupsWrite,
  type CaosOrderInput,
  assignWrites,
  buildCaosCards,
  caosDay,
  mergeWrites,
  unassignWrites,
} from "./caos-board";
import {
  CAOS_SERVER_NOW,
  type CaosUndoCupJSON,
  caosObservedCups,
  resolveUndo,
  undoOfNext,
  undoOfWrites,
} from "./caos-undo";

const NOW = new Date("2026-10-08T03:00:00Z"); // 日本時間 12:00
const DAY = caosDay(NOW);
const SERVER = new Date("2026-10-08T03:00:05.123Z"); // サーバーが付けた時刻

const blend = {
  id: "item-blend",
  name: "ブレンド",
  abbr: "ブ",
  item_type: {
    name: "hot",
    display_name: "ホット",
    makes_cup: true,
    needs_brew: true,
    senior_only: false,
  },
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
  emergencyAt: null,
  emergencyDripId: null,
  emergencyPrintedAt: null,
  ...init,
});

const order = (no: number, cups: Cup[]): CaosOrderInput => ({
  id: `order-${no}`,
  orderId: no,
  createdAt: NOW,
  menus: [{ orderMenuId: "line-1", dripper: null, assignee: null }],
  cups,
});

let idSeq = 0;
const newId = () => `drip-${++idSeq}`;

// サーバーの PUT /api/caos/cups と同じに書く（始める印には SERVER の時刻を付ける。緊急のカップのカードは emergencyDripId）
const applyWrites = (
  orders: CaosOrderInput[],
  writes: readonly CaosCupsWrite[],
): CaosOrderInput[] =>
  orders.map((o) => ({
    ...o,
    cups: o.cups.map((c) => {
      const w = writes.find((w) => w.cup_ids.includes(c.id));
      if (!w) return c;
      const card =
        c.emergencyAt !== null
          ? { emergencyDripId: w.after.drip_id }
          : { dripId: w.after.drip_id };
      return {
        ...c,
        ...card,
        dripper: w.after.dripper,
        dripperPosition: w.after.dripper_position,
        brewStartedAt: w.after.start_brew ? SERVER : null,
        brewFinishedAt: null,
      };
    }),
  }));

const cupsOf = (orders: CaosOrderInput[]) =>
  new Map(orders.flatMap((o) => o.cups.map((c) => [c.id, c])));

const resolved = (r: ReturnType<typeof resolveUndo>): CaosUndoCupJSON[] => {
  if ("error" in r) throw new Error(r.error);
  return r.cups;
};

describe("[unit] CaOS の「1つ戻す」", () => {
  test("割当（空いているドリッパーで始めた）：current は書いた値とサーバーの時刻、restore は前の値（未割当）", () => {
    const orders = [order(1, [cup(), cup()])];
    const cards = buildCaosCards(orders, DAY);
    const result = assignWrites(cards, cards[0], 2, { newId });
    if ("error" in result) throw new Error(result.error);
    const entry = undoOfWrites("assign", "割当", cards, result.writes);
    expect(entry?.cups.map((c) => c.written.brewStartedAt)).toEqual([
      CAOS_SERVER_NOW,
      CAOS_SERVER_NOW,
    ]);
    const after = applyWrites(orders, result.writes);
    const cups = resolved(
      resolveUndo(
        entry ?? { kind: "assign", label: "", cups: [] },
        caosObservedCups(after),
      ),
    );
    expect(cups).toHaveLength(2);
    const byId = cupsOf(after);
    for (const c of cups) {
      const now = byId.get(c.cup_id);
      // 送る current は、サーバーが書いた今の値そのもの
      expect(c.current).toEqual({
        dripper: 2,
        dripper_position: now?.dripperPosition,
        drip_id: now?.dripId,
        brew_started_at: SERVER.toISOString(),
        brew_finished_at: null,
        ready_at: null,
        served_at: null,
        emergency_at: null,
      });
      expect(c.restore).toEqual({
        dripper: null,
        dripper_position: null,
        drip_id: null,
        brew_started_at: null,
        brew_finished_at: null,
        ready_at: null,
        served_at: null,
        emergency_at: null,
      });
    }
  });

  test("未割当に戻す・統合も、書いたカップを前の値に戻す", () => {
    const queued = { dripper: 1, dripperPosition: 1, dripId: "q1" };
    const orders = [
      order(1, [cup({ ...queued, brewStartedAt: null })]),
      order(2, [cup()]),
      order(3, [cup()]),
      // 1 番は抽出中があるので、移動しても始めない
      order(4, [
        cup({
          dripper: 1,
          dripperPosition: 0,
          dripId: "b1",
          brewStartedAt: NOW,
        }),
      ]),
    ];
    const cards = buildCaosCards(orders, DAY);
    const q = cards.find((c) => c.dripId === "q1");
    if (!q) throw new Error("no card");

    const unassign = unassignWrites(q);
    if ("error" in unassign) throw new Error(unassign.error);
    const entry = undoOfWrites(
      "unassign",
      "未割当に戻す",
      cards,
      unassign.writes,
    );
    const [back] = resolved(
      resolveUndo(
        entry ?? { kind: "unassign", label: "", cups: [] },
        caosObservedCups(applyWrites(orders, unassign.writes)),
      ),
    );
    expect(back.current.dripper).toBeNull();
    expect(back.restore).toMatchObject({
      dripper: 1,
      dripper_position: 1,
      drip_id: "q1",
    });

    const [a, b] = cards.filter((c) => c.status === "unassigned");
    const merge = mergeWrites(a, b, newId);
    if ("error" in merge) throw new Error(merge.error);
    const merged = undoOfWrites("merge", "統合", cards, merge.writes);
    const both = resolved(
      resolveUndo(
        merged ?? { kind: "merge", label: "", cups: [] },
        caosObservedCups(applyWrites(orders, merge.writes)),
      ),
    );
    expect(both.map((c) => c.current.drip_id)).toEqual([
      merge.writes[0].after.drip_id,
      merge.writes[0].after.drip_id,
    ]);
    expect(both.map((c) => c.restore.drip_id)).toEqual([null, null]);
  });

  test("次へ：終えたカードは抽出中に、始めたカードは待機に戻す。準備完了はこの「次へ」で付けたカップだけ外す", () => {
    const readyBefore = new Date(NOW.getTime() - 10_000);
    const brewing = {
      dripper: 3,
      dripperPosition: 1,
      dripId: "x",
      brewStartedAt: NOW,
    };
    const x1 = cup(brewing);
    const x2 = cup({ ...brewing, readyAt: readyBefore }); // マスターで先に準備完了にしていた
    const y = cup({ dripper: 3, dripperPosition: 2, dripId: "y" });
    const orders = [order(1, [x1, x2]), order(2, [y])];
    const cards = buildCaosCards(orders, DAY);
    const entry = undoOfNext("3番の次へ", cards, "x", "y");
    if (!entry) throw new Error("no entry");

    // サーバーの「次へ」のあと
    const after = orders.map((o) => ({
      ...o,
      cups: o.cups.map((c) =>
        c.dripId === "x"
          ? { ...c, brewFinishedAt: SERVER, readyAt: c.readyAt ?? SERVER }
          : { ...c, brewStartedAt: SERVER },
      ),
    }));
    const cups = resolved(resolveUndo(entry, caosObservedCups(after)));
    const of = (id: string) => cups.find((c) => c.cup_id === id);
    expect(of(x1.id)?.current).toMatchObject({
      brew_finished_at: SERVER.toISOString(),
      ready_at: SERVER.toISOString(),
    });
    expect(of(x1.id)?.restore).toMatchObject({
      brew_started_at: NOW.toISOString(),
      brew_finished_at: null,
      ready_at: null,
    });
    // 先に準備完了だったカップは、準備完了のまま
    expect(of(x2.id)?.current.ready_at).toBe(readyBefore.toISOString());
    expect(of(x2.id)?.restore.ready_at).toBe(readyBefore.toISOString());
    expect(of(y.id)?.current.brew_started_at).toBe(SERVER.toISOString());
    expect(of(y.id)?.restore.brew_started_at).toBeNull();

    // 画面の知らないカードを終えた・始めたなら覚えない
    expect(undoOfNext("", cards, "unknown", null)).toBeNull();
    expect(undoOfNext("", cards, null, null)).toBeNull();
  });

  test("送れないとき：カップが消えた・サーバーの時刻がまだ（ほかの画面で変わった）", () => {
    const orders = [order(1, [cup()])];
    const cards = buildCaosCards(orders, DAY);
    const result = assignWrites(cards, cards[0], 1, { newId });
    if ("error" in result) throw new Error(result.error);
    const entry = undoOfWrites("assign", "割当", cards, result.writes);
    if (!entry) throw new Error("no entry");
    expect(resolveUndo(entry, new Map())).toEqual({
      error: expect.stringContaining("カップが消えた"),
    });
    // 始めたはずの時刻が無い（ほかの画面が未割当に戻した、など）
    expect(resolveUndo(entry, caosObservedCups(orders))).toEqual({
      error: "ほかの画面で先に変わったので戻せません",
    });
    // 見ていないカップを書いた書き込みは覚えない
    expect(undoOfWrites("assign", "割当", [], result.writes)).toBeNull();
  });

  test("緊急（入れ直し）のカード：drip_id は入れ直しのカード（emergencyDripId）、emergency_at は比べるだけで戻さない", () => {
    const emergencyAt = new Date(NOW.getTime() - 60_000);
    const rebrew = cup({
      dripId: "first", // 最初に淹れたカード
      readyAt: NOW,
      emergencyAt,
    });
    const orders = [order(1, [rebrew])];
    const cards = buildCaosCards(orders, DAY);
    expect(cards[0].emergency).toBe(true);
    const result = assignWrites(cards, cards[0], 4, { newId });
    if ("error" in result) throw new Error(result.error);
    const entry = undoOfWrites("assign", "割当", cards, result.writes);
    if (!entry) throw new Error("no entry");
    const after = applyWrites(orders, result.writes);
    expect(after[0].cups[0].dripId).toBe("first");
    const [back] = resolved(resolveUndo(entry, caosObservedCups(after)));
    expect(back.current).toMatchObject({
      dripper: 4,
      drip_id: result.writes[0].after.drip_id,
      ready_at: NOW.toISOString(),
      emergency_at: emergencyAt.toISOString(),
    });
    expect(back.restore).toMatchObject({
      dripper: null,
      drip_id: null,
      emergency_at: emergencyAt.toISOString(),
    });
  });
});
