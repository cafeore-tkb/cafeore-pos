import { describe, expect, test } from "vitest";
import type { Cup } from "../models/cup";
import { type CaosOrderInput, buildCaosCards, caosLane } from "./caos-board";
import {
  caosDeliverables,
  caosUnstartedHead,
  cardAwaitsDelivery,
  cupDelivered,
} from "./caos-deliver";

const NOW = new Date("2026-10-08T03:00:00Z"); // 日本時間 12:00
const at = (sec: number) => new Date(NOW.getTime() - sec * 1000);

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
    needs_finishing: false,
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
  deliveredAt: null,
  emergencies: [],
  ...init,
});

// ドリッパー 1 に置いたカップ。started・finished は何秒前か
const placed = (
  dripId: string,
  {
    position = 1,
    started,
    finished,
    ...init
  }: Partial<Cup> & { position?: number; started?: number; finished?: number },
) =>
  cup({
    dripper: 1,
    dripperPosition: position,
    dripId,
    brewStartedAt: started === undefined ? null : at(started),
    brewFinishedAt: finished === undefined ? null : at(finished),
    ...init,
  });

const order = (no: number, cups: Cup[]): CaosOrderInput => ({
  id: `order-${no}`,
  orderId: no,
  createdAt: NOW,
  menus: [{ orderMenuId: "line-1", dripper: null, assignee: null }],
  cups,
});

const lane = (...orders: CaosOrderInput[]) =>
  caosLane(buildCaosCards(orders), 1);

const keys = (lane: ReturnType<typeof caosLane>) =>
  caosDeliverables(lane, NOW.getTime()).map(({ card, brewing, locked }) => ({
    key: card.key,
    brewing,
    locked,
  }));

describe("[unit] cupDelivered", () => {
  test("a cup without re-brews is delivered once it has deliveredAt", () => {
    expect(cupDelivered(cup())).toBe(false);
    expect(cupDelivered(cup({ deliveredAt: NOW }))).toBe(true);
  });

  test("a cup with re-brews waits for every re-brew", () => {
    const emergency = {
      id: "e-1",
      createdAt: NOW,
      reason: "",
      dripper: null,
      dripperPosition: null,
      dripId: null,
      brewStartedAt: null,
      brewFinishedAt: null,
      deliveredAt: null,
    };
    expect(
      cupDelivered(cup({ deliveredAt: NOW, emergencies: [emergency] })),
    ).toBe(false);
    expect(
      cupDelivered(cup({ emergencies: [{ ...emergency, deliveredAt: NOW }] })),
    ).toBe(true);
  });
});

describe("[unit] caosDeliverables", () => {
  test("the brewing card can be delivered once the cooldown has passed", () => {
    expect(keys(lane(order(1, [placed("a", { started: 200 })])))).toEqual([
      { key: "a", brewing: true, locked: false },
    ]);
    expect(keys(lane(order(1, [placed("a", { started: 5 })])))).toEqual([
      { key: "a", brewing: true, locked: true },
    ]);
  });

  test("only the last finished card that is not delivered yet comes before the brewing card", () => {
    const l = lane(
      order(1, [placed("old", { started: 900, finished: 600 })]),
      order(2, [placed("last", { started: 600, finished: 300 })]),
      order(3, [placed("now", { position: 2, started: 300 })]),
    );
    expect(keys(l)).toEqual([
      { key: "last", brewing: false, locked: false },
      { key: "now", brewing: true, locked: false },
    ]);
  });

  test("a finished card is left out once delivered or readied at serve", () => {
    const delivered = order(1, [
      placed("a", { started: 600, finished: 300, deliveredAt: at(200) }),
    ]);
    const readied = order(2, [
      placed("b", { started: 600, finished: 300, readyAt: at(100) }),
    ]);
    expect(keys(lane(delivered))).toEqual([]);
    expect(keys(lane(readied))).toEqual([]);
  });

  test("queued cards cannot be delivered, but an unstarted head is reported", () => {
    const l = lane(
      order(1, [placed("done", { started: 600, finished: 300 })]),
      order(2, [placed("next", { position: 2 })]),
    );
    expect(keys(l).map(({ key }) => key)).toEqual(["done"]);
    expect(caosUnstartedHead(l)?.key).toBe("next");
    expect(
      caosUnstartedHead(lane(order(3, [placed("c", { started: 60 })]))),
    ).toBeUndefined();
  });

  test("a merged card awaits delivery while any cup is not delivered", () => {
    const [card] = buildCaosCards([
      order(1, [
        placed("m", { started: 600, finished: 300, deliveredAt: NOW }),
      ]),
      order(2, [placed("m", { started: 600, finished: 300 })]),
    ]);
    expect(cardAwaitsDelivery(card)).toBe(true);
  });
});
