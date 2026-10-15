import { describe, expect, test } from "vitest";
import type { Cup } from "../models/cup";
import {
  type CaosOrderInput,
  assignWrites,
  buildCaosCards,
  mergeWrites,
} from "./caos-board";
import {
  caosLaneUndoBlock,
  caosUndoCups,
  undoOfNext,
  undoOfWrites,
} from "./caos-undo";

const NOW = new Date("2026-10-08T03:00:00Z");
const T1 = new Date("2026-10-08T03:01:00Z");
const T2 = new Date("2026-10-08T03:03:00Z");

const blend: Cup["item"] = {
  id: "item-blend",
  name: "ブレンド",
  abbr: "ブ",
  item_type: {
    name: "hot",
    display_name: "ホット",
    makes_cup: true,
    needs_brew: true,
    senior_only: false,
    iced_brew: false,
  },
};

const cup = (id: string, init: Partial<Cup> = {}): Cup => ({
  id,
  orderMenuId: `line-${id}`,
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

const order = (no: number, cups: Cup[]): CaosOrderInput => ({
  id: `order-${no}`,
  orderId: no,
  createdAt: NOW,
  menus: cups.map((c) => ({
    orderMenuId: c.orderMenuId,
    dripper: null,
    assignee: null,
  })),
  cups,
});

// カップを 1 杯ずつ別の注文にした盤面
const board = (...cups: Cup[]) =>
  buildCaosCards(cups.map((c, i) => order(i + 1, [c])));

const nullState = {
  dripper: null,
  dripper_position: null,
  drip_id: null,
  brew_started_at: null,
  brew_finished_at: null,
};

describe("unit: caos-undo", () => {
  test("割当を戻す：届いた値がその割当のままなら、今の値と前の値（未割当）を送る", () => {
    const before = [cup("a")];
    const cards = buildCaosCards([order(1, before)]);
    const result = assignWrites(cards, cards[0], 2, { newId: () => "d1" });
    if ("error" in result) throw new Error(result.error);
    const entry = undoOfWrites(cards, result.writes);

    // サーバーが番号と始めた時刻を付けて書いた
    const after = cup("a", {
      dripper: 2,
      dripperPosition: 1,
      dripId: "d1",
      brewStartedAt: T1,
    });
    expect(caosUndoCups(entry, board(after))).toEqual({
      cups: [
        {
          cup_id: "a",
          current: {
            state: {
              dripper: 2,
              dripper_position: 1,
              drip_id: "d1",
              brew_started_at: T1.toISOString(),
              brew_finished_at: null,
            },
            ready_at: null,
          },
          restore: { state: nullState, ready_at: null },
        },
      ],
    });
  });

  test("抽出中のカードへの統合を戻す：入れたカップは抽出中（開始の時刻はそのカードのもの）とみて、未割当に戻す", () => {
    const brewing = cup("a", {
      dripper: 3,
      dripperPosition: 1,
      dripId: "d1",
      brewStartedAt: NOW,
    });
    const cards = board(brewing, cup("b"));
    const [loose, into] = cards; // 未割当が先に並ぶ
    const result = mergeWrites(loose, into, () => "unused");
    if ("error" in result) throw new Error(result.error);
    const entry = undoOfWrites(cards, result.writes);
    const joined = cup("b", {
      dripper: 3,
      dripperPosition: 1,
      dripId: "d1",
      brewStartedAt: NOW,
    });
    const undo = caosUndoCups(entry, board(brewing, joined));
    // 抽出中のカードのカップは、今の値のまま送る
    if (!("cups" in undo)) throw new Error(undo.error);
    expect(undo.cups.map((c) => [c.cup_id, c.restore])).toEqual([
      ["b", { state: nullState, ready_at: null }],
      ["a", undo.cups[1].current],
    ]);
  });

  test("抽出中のカードをほかの列の先頭へ移したのを戻す：移したカードは前の始めた時刻、待機に下がったカードも前の始めた時刻に戻す", () => {
    const x = cup("x", {
      dripper: 1,
      dripperPosition: 1,
      dripId: "dx",
      brewStartedAt: NOW,
    });
    const y = cup("y", {
      dripper: 2,
      dripperPosition: 1,
      dripId: "dy",
      brewStartedAt: T1,
    });
    const cards = board(x, y);
    const result = assignWrites(cards, cards[0], 2, {
      place: "front",
      newId: () => "unused",
    });
    if ("error" in result) throw new Error(result.error);
    const entry = undoOfWrites(cards, result.writes);
    expect(entry.cups.map((c) => [c.id, c.expect.started])).toEqual([
      ["y", false],
      ["x", true],
    ]);
    // サーバーが x を今（T2）から始め、y の始めた時刻を消して待機（番号 2）にした
    const undo = caosUndoCups(
      entry,
      board(
        cup("x", {
          dripper: 2,
          dripperPosition: 3,
          dripId: "dx",
          brewStartedAt: T2,
        }),
        cup("y", { dripper: 2, dripperPosition: 2, dripId: "dy" }),
      ),
    );
    if (!("cups" in undo)) throw new Error(undo.error);
    expect(
      undo.cups.map((c) => [c.cup_id, c.restore.state.brew_started_at]),
    ).toEqual([
      ["y", T1.toISOString()],
      ["x", NOW.toISOString()],
    ]);
  });

  test("ほかの画面があとで変えた・提供済み・消えたカップは送らない", () => {
    const cards = buildCaosCards([order(1, [cup("a")])]);
    const result = assignWrites(cards, cards[0], 2, { newId: () => "d1" });
    if ("error" in result) throw new Error(result.error);
    const entry = undoOfWrites(cards, result.writes);
    const placed = { dripper: 2, dripperPosition: 1, dripId: "d1" };

    expect(
      caosUndoCups(entry, board(cup("a", { ...placed, dripper: 3 }))),
    ).toEqual({
      error: "ほかの画面で先に変わったので戻せません",
    });
    expect(
      caosUndoCups(entry, board(cup("a", { ...placed, servedAt: T2 }))),
    ).toEqual({ error: "提供済みになったカップがあるので戻せません" });
    expect(caosUndoCups(entry, [])).toEqual({
      error:
        "カップが消えたので戻せません（注文が編集・削除されたかもしれません）",
    });
  });

  test("次へを戻す：終えたカードは抽出中に、始めたカードは待機に戻す（準備完了は変えない）", () => {
    const brewing = cup("a", {
      dripper: 1,
      dripperPosition: 1,
      dripId: "d1",
      brewStartedAt: NOW,
    });
    const queued = cup("b", { dripper: 1, dripperPosition: 2, dripId: "d2" });
    const cards = buildCaosCards([order(1, [brewing]), order(2, [queued])]);
    const entry = undoOfNext(cards, 1);
    expect(entry.cups.map((c) => c.id)).toEqual(["a", "b"]);
    // 終えるだけなら終えたカードだけ、始めるカードを選んだならそのカード
    expect(undoOfNext(cards, 1, null).cups.map((c) => c.id)).toEqual(["a"]);
    const other = cards.find((card) => card.dripId === "d2");
    expect(undoOfNext(cards, 1, other).cups.map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);

    const finished = { ...brewing, brewFinishedAt: T1 };
    const started = { ...queued, brewStartedAt: T1 };
    const sent = caosUndoCups(entry, board(finished, started));
    if ("error" in sent) throw new Error(sent.error);
    expect(sent.cups.map((c) => [c.cup_id, c.restore])).toEqual([
      [
        "a",
        {
          state: {
            dripper: 1,
            dripper_position: 1,
            drip_id: "d1",
            brew_started_at: NOW.toISOString(),
            brew_finished_at: null,
          },
          ready_at: null,
        },
      ],
      [
        "b",
        {
          state: {
            dripper: 1,
            dripper_position: 2,
            drip_id: "d2",
            brew_started_at: null,
            brew_finished_at: null,
          },
          ready_at: null,
        },
      ],
    ]);
    // まだ「次へ」の結果が届いていなければ送らず、もう一度押せるように知らせる
    expect(caosUndoCups(entry, board(brewing, queued))).toEqual({
      error: "操作の結果がまだ届いていません。もう一度押してください",
      arriving: true,
    });
    // 「次へ」のあとに提供の画面で準備完了にしていたら、ほかの画面が変えたとみて戻さない
    expect(
      caosUndoCups(entry, board({ ...finished, readyAt: T1 }, started)),
    ).toEqual({ error: "ほかの画面で先に変わったので戻せません" });
  });

  test("入れ直しの「次へ」を戻す：入れ直しは準備完了を持たないので、終えても準備完了は見ない", () => {
    const emergency = {
      id: "e1",
      createdAt: NOW,
      reason: "",
      dripper: 1,
      dripperPosition: 1,
      dripId: "d1",
      brewStartedAt: NOW,
      brewFinishedAt: null,
    };
    const served = cup("a", { readyAt: NOW, servedAt: NOW });
    const entry = undoOfNext(board({ ...served, emergencies: [emergency] }), 1);
    const finished = {
      ...served,
      emergencies: [{ ...emergency, brewFinishedAt: T1 }],
    };
    const sent = caosUndoCups(entry, board(finished));
    if ("error" in sent) throw new Error(sent.error);
    expect(sent.cups.map((c) => [c.cup_id, c.restore.ready_at])).toEqual([
      ["e1", null],
    ]);
  });

  test("先頭へを戻す：番号がずれる列の待機のカードも前の番号に戻す", () => {
    const a = cup("a", { dripper: 1, dripperPosition: 1, dripId: "da" });
    const b = cup("b", { dripper: 1, dripperPosition: 2, dripId: "db" });
    const cards = board(a, b);
    const result = assignWrites(cards, cards[1], 1, {
      place: "front",
      newId: () => "x",
    });
    if ("error" in result) throw new Error(result.error);
    const entry = undoOfWrites(cards, result.writes);
    const sent = caosUndoCups(
      entry,
      board({ ...a, dripperPosition: 2 }, { ...b, dripperPosition: 1 }),
    );
    if ("error" in sent) throw new Error(sent.error);
    expect(
      sent.cups.map((c) => [c.cup_id, c.restore.state.dripper_position]),
    ).toEqual([
      ["b", 2],
      ["a", 1],
    ]);
  });

  test("担当者の交代を戻す：今の担当者が交代のあとのままのときだけ", () => {
    const before = { dripper: 1, name: "山田", senior: true };
    const after = { dripper: 1, name: "伊藤", senior: false };
    expect(caosLaneUndoBlock(before, after, after)).toBeNull();
    expect(caosLaneUndoBlock(before, after, before)).toMatchObject({
      arriving: true,
    });
    expect(
      caosLaneUndoBlock(before, after, { ...after, name: "鈴木" }),
    ).toEqual({ error: "ほかの画面で先に変わったので戻せません" });
    // 上級生の判定だけ変わったのも、ほかの画面が替えたとみる
    expect(
      caosLaneUndoBlock(before, after, { ...after, senior: true }),
    ).toEqual({ error: "ほかの画面で先に変わったので戻せません" });
  });
});
