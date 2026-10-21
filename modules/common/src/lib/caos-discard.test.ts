import { describe, expect, test } from "vitest";
import type { Cup } from "../models/cup";
import { buildCaosCards, caosStateJSON } from "./caos-board";
import {
  type CaosDiscardRequest,
  caosDiscardCandidates,
  discardCaosPracticeCups,
} from "./caos-discard";
import {
  applyCaosOutboxOp,
  overlayCaosOrders,
  parseCaosOutboxEntry,
} from "./caos-outbox";
import type { CaosPracticeOrder } from "./caosPractice";
import { jstDate } from "./jst";

const at = new Date("2026-10-21T03:00:00Z");
const item = {
  id: "blend",
  name: "ブレンド",
  abbr: "ブ",
  item_type: { name: "blend", makes_cup: true, needs_brew: true },
} as Cup["item"];
const fixture = (started = true): CaosPracticeOrder[] => [
  {
    id: "order",
    orderId: 1000,
    createdAt: new Date(at.getTime() - 120_000),
    menus: [],
    cups: [0, 1].map((i) => ({
      id: `cup-${i}`,
      orderMenuId: "",
      item,
      readyAt: null,
      servedAt: null,
      dripper: 1,
      dripperPosition: 1,
      dripId: "original",
      brewStartedAt: started ? at : null,
      brewFinishedAt: null,
      emergencies: i
        ? []
        : [
            {
              id: "redo",
              createdAt: new Date(at.getTime() + 60_000),
              reason: "抽出ミス",
              dripper: null,
              dripperPosition: null,
              dripId: null,
              brewStartedAt: null,
              brewFinishedAt: null,
            },
          ],
    })),
  },
];
const request = (orders: CaosPracticeOrder[]): CaosDiscardRequest => ({
  cup_ids: ["cup-0"],
  before: caosStateJSON(orders[0].cups[0]),
  drip_id: "discarded",
});

describe("[unit] 淹れ直し元の破棄", () => {
  test.each([true, false])(
    "対象だけを終了し、統合相手・提供状態・淹れ直しを残す（抽出中=%s）",
    (started) => {
      const orders = fixture(started);
      const req = request(orders);
      const result = discardCaosPracticeCups(
        orders,
        req,
        new Date(at.getTime() + 90_000),
      );
      if (result.error !== undefined) throw new Error(result.error);
      expect(result.orders[0].cups[0]).toMatchObject({
        dripId: "discarded",
        brewFinishedAt: new Date(at.getTime() + 90_000),
        readyAt: null,
        servedAt: null,
      });
      expect(result.orders[0].cups[1]).toEqual(orders[0].cups[1]);
      expect(result.orders[0].cups[0].emergencies).toEqual(
        orders[0].cups[0].emergencies,
      );
      expect(orders[0].cups[0].brewFinishedAt).toBeNull();
      expect(
        buildCaosCards(result.orders)
          .find((c) => c.dripId === "original")
          ?.cups.map((c) => c.id),
      ).toEqual(["cup-1"]);
    },
  );
  test("ラベル再発行・淹れ直し未登録・対象外・状態変更を断る", () => {
    const orders = fixture();
    const req = request(orders);
    expect(
      discardCaosPracticeCups(orders, { ...req, cup_ids: ["cup-1"] }, at),
    ).toHaveProperty("error");
    expect(
      discardCaosPracticeCups(
        orders,
        { ...req, before: { ...req.before, drip_id: "changed" } },
        at,
      ),
    ).toHaveProperty("error");
    orders[0].cups[0].emergencies[0].reason = "ラベル再発行";
    expect(discardCaosPracticeCups(orders, req, at)).toHaveProperty("error");
    orders[0].cups[0].emergencies = [];
    expect(discardCaosPracticeCups(orders, req, at)).toHaveProperty("error");
  });
  test("破棄を再読込後も重ね、サーバー反映後は二重適用しない", () => {
    const orders = fixture();
    const entry = {
      id: "op",
      at: at.getTime() + 90_000,
      label: "破棄",
      op: { kind: "discard" as const, request: request(orders) },
    };
    const restored = parseCaosOutboxEntry(
      entry.id,
      JSON.parse(JSON.stringify(entry)),
    );
    expect(restored).not.toBeNull();
    const result = overlayCaosOrders(orders, [entry], jstDate(at.getTime()));
    expect(result[0].cups[0].dripId).toBe("discarded");
    expect(overlayCaosOrders(result, [entry], jstDate(at.getTime()))).toEqual(
      result,
    );
    const apply = applyCaosOutboxOp(orders, entry.op, new Date(entry.at));
    expect(apply).toHaveProperty("orders");
  });
  test("淹れ直し自体を再度淹れ直した場合も、前の緊急抽出を特定する", () => {
    const orders = fixture();
    const cup = orders[0].cups[0];
    cup.emergencies[0] = {
      ...cup.emergencies[0],
      dripId: "redo-card",
      dripper: 2,
      dripperPosition: 1,
      brewStartedAt: new Date(at.getTime() + 60_000),
    };
    cup.emergencies.push({
      ...cup.emergencies[0],
      id: "redo-2",
      createdAt: new Date(at.getTime() + 90_000),
      dripId: null,
      dripper: null,
      dripperPosition: null,
      brewStartedAt: null,
    });
    const cards = buildCaosCards(orders);
    const target = cards.find((c) => c.dripId === "redo-card");
    if (!target) throw new Error("missing redo card");
    expect(caosDiscardCandidates(cards, target).map((c) => c.id)).toEqual([
      "redo",
    ]);
    const req = {
      cup_ids: ["redo"],
      before: caosStateJSON(target.state),
      drip_id: "discarded-redo",
    };
    const result = discardCaosPracticeCups(
      orders,
      req,
      new Date(at.getTime() + 100_000),
    );
    if (result.error !== undefined) throw new Error(result.error);
    expect(
      result.orders[0].cups[0].emergencies[0].brewFinishedAt,
    ).not.toBeNull();
    expect(result.orders[0].cups[0].emergencies[1].brewFinishedAt).toBeNull();
  });
});
