import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Cup } from "../models/cup";
import {
  type CaosOrderInput,
  assignWrites,
  buildCaosCards,
  caosLane,
} from "./caos-board";
import {
  type CaosOutboxEntry,
  type CaosOutboxOp,
  type CaosOutboxRequest,
  type CaosOutboxResult,
  type CaosServerState,
  createCaosOutbox,
  overlayCaosLanes,
  overlayCaosOrders,
  parseCaosOutboxEntry,
} from "./caos-outbox";
import { undoOfWrites } from "./caos-undo";
import { emptyCaosLanes } from "./caosLanes";
import { jstDate } from "./jst";

const NOW = new Date("2026-10-08T03:00:00Z");
const DAY = jstDate(NOW.getTime());
// サーバーの時刻（端末の時計とずれている）
const SERVER_T = new Date("2026-10-08T03:00:01.234Z");

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

// カップを 1 杯ずつ別の注文にした盤面（サーバーから届いた注文）
const orders = (...cups: Cup[]): CaosOrderInput[] =>
  cups.map((c, i) => ({
    id: `order-${c.id}`,
    orderId: i + 1,
    createdAt: NOW,
    menus: [{ orderMenuId: c.orderMenuId, dripper: null, assignee: null }],
    cups: [c],
  }));

const cardOf = (input: readonly CaosOrderInput[], cupId: string) => {
  const found = buildCaosCards(input).find((card) =>
    card.cups.some((c) => c.id === cupId),
  );
  if (!found) throw new Error(`no card for ${cupId}`);
  return found;
};

let seq = 0;
const entry = (op: CaosOutboxOp, label = "操作"): CaosOutboxEntry => {
  seq += 1;
  return { id: `op-${seq}`, at: NOW.getTime() + seq, label, op };
};

// 盤面（input）で、カップ cupId のカードを dripper の最後へ置く操作
const place = (
  input: readonly CaosOrderInput[],
  cupId: string,
  dripper: number,
): CaosOutboxOp => {
  const cards = buildCaosCards(input);
  const result = assignWrites(cards, cardOf(input, cupId), dripper, {
    newId: () => `drip-${cupId}`,
  });
  if ("error" in result) throw new Error(result.error);
  return { kind: "cups", writes: result.writes };
};

describe("unit: caos-outbox 重ねて表示", () => {
  test("割当を押したら、サーバーの盤面に重ねて抽出中に出す（始めた時刻は押した時刻）", () => {
    const server = orders(cup("a"));
    const op = entry(place(server, "a", 1));
    const card = cardOf(overlayCaosOrders(server, [op], DAY), "a");
    expect(card).toMatchObject({ status: "brewing", dripper: 1 });
    expect(card.startedAt?.getTime()).toBe(op.at);
  });

  test("サーバーの盤面が届いたら、残っていても重ねずにサーバーの値（始めた時刻）を出す。場所は同じなので戻って見えない", () => {
    const server = orders(cup("a"));
    const op = entry(place(server, "a", 1));
    const arrived = orders(
      cup("a", {
        dripper: 1,
        dripperPosition: 1,
        dripId: "drip-a",
        brewStartedAt: SERVER_T,
      }),
    );
    const card = cardOf(overlayCaosOrders(arrived, [op], DAY), "a");
    expect(card).toMatchObject({ status: "brewing", dripper: 1 });
    expect(card.startedAt).toEqual(SERVER_T);
  });

  test("続けた操作は、前の操作の時刻・番号がサーバーの値に変わっても、カードの場所が同じなら重ねる", () => {
    const server = orders(cup("a"), cup("b"));
    const first = entry(place(server, "a", 1));
    const second = entry(
      place(overlayCaosOrders(server, [first], DAY), "a", 2), // 端末の時刻で始めたカードを 2 番へ
    );
    const arrived = orders(
      cup("a", {
        dripper: 1,
        dripperPosition: 7,
        dripId: "drip-a",
        brewStartedAt: SERVER_T,
      }),
      cup("b"),
    );
    expect(
      cardOf(overlayCaosOrders(arrived, [first, second], DAY), "a"),
    ).toMatchObject({ status: "brewing", dripper: 2 });
  });

  test("ほかの端末が先に動かしていたら、その操作は重ねない（サーバーの盤面のまま）", () => {
    const server = orders(cup("a"));
    const op = entry(place(server, "a", 1));
    const other = orders(
      cup("a", {
        dripper: 3,
        dripperPosition: 1,
        dripId: "drip-other",
        brewStartedAt: SERVER_T,
      }),
    );
    expect(cardOf(overlayCaosOrders(other, [op], DAY), "a").dripper).toBe(3);
  });

  test("「次へ」は押したあとに届いた盤面にも重ね、始めてからの秒は見直さない", () => {
    const brewing = orders(
      cup("a", {
        dripper: 1,
        dripperPosition: 1,
        dripId: "drip-a",
        brewStartedAt: NOW,
      }),
      cup("b", { dripper: 1, dripperPosition: 2, dripId: "drip-b" }),
    );
    const next = entry({
      kind: "next",
      dripper: 1,
      dripId: "drip-a",
      startId: "drip-b",
    });
    const lane = caosLane(
      buildCaosCards(overlayCaosOrders(brewing, [next], DAY)),
      1,
    );
    expect(lane.done.map((card) => card.key)).toEqual(["drip-a"]);
    expect(lane.brewing?.key).toBe("drip-b");
  });

  test("「1つ戻す」は戻す操作のあとに重ねる（未送信のまま戻すと、元の盤面に見える）", () => {
    const server = orders(cup("a"));
    const op = place(server, "a", 1);
    if (op.kind !== "cups") throw new Error();
    const undo = entry({
      kind: "undo",
      entry: undoOfWrites(buildCaosCards(server), op.writes),
    });
    expect(
      cardOf(overlayCaosOrders(server, [entry(op), undo], DAY), "a").status,
    ).toBe("unassigned");
  });

  test("担当者の交代と入れ替えを重ねる", () => {
    const lanes = emptyCaosLanes("2026-10-08").lanes.map((lane) =>
      lane.dripper === 2 ? { ...lane, name: "山田", senior: true } : lane,
    );
    const changed = overlayCaosLanes(lanes, [
      entry({ kind: "lane", dripper: 1, name: "鈴木", senior: false }),
      entry({ kind: "swap", first: 1, second: 2, names: ["鈴木", "山田"] }),
    ]);
    expect(
      changed.slice(0, 2).map(({ name, senior }) => [name, senior]),
    ).toEqual([
      ["山田", true],
      ["鈴木", false],
    ]);
  });
});

describe("unit: caos-outbox 送る", () => {
  // 端末に残した操作（古い順）
  const memoryStore = (entries: CaosOutboxEntry[]) => {
    let items = [...entries];
    const read = () => [...items].sort((a, b) => a.at - b.at);
    return {
      items: read,
      store: {
        read,
        put: (item: CaosOutboxEntry) => {
          items = [...items.filter((e) => e.id !== item.id), item];
        },
        remove: (id: string) => {
          items = items.filter((e) => e.id !== id);
        },
      },
    };
  };

  const setup = (
    entries: CaosOutboxEntry[],
    initial: readonly CaosOrderInput[] | null,
    results: CaosOutboxResult[] = [],
  ) => {
    const { items, store } = memoryStore(entries);
    let server: CaosServerState | null = initial && {
      orders: initial,
      lanes: null,
    };
    const sent: CaosOutboxRequest[] = [];
    const rejected: [string, string][] = [];
    const outbox = createCaosOutbox({
      store,
      server: () => server,
      send: async (request) => {
        sent.push(request);
        return results.shift() ?? {};
      },
      onRejected: ({ label }, reason) => rejected.push([label, reason]),
    });
    return {
      outbox,
      items,
      sent,
      rejected,
      setServer: (next: readonly CaosOrderInput[] | null) => {
        server = next && { orders: next, lanes: null };
      },
    };
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("古い順に 1 つずつ送り、送れたらサーバーの盤面が届くまで次を送らない。次は書く前の値をサーバーの値に差し替えて送る", async () => {
    const server = orders(cup("a"), cup("b"));
    const first = entry(place(server, "a", 1));
    const second = entry(
      place(overlayCaosOrders(server, [first], DAY), "a", 2),
    );
    const t = setup([first, second], server);

    await t.outbox.kick();
    expect(t.sent).toHaveLength(1);
    expect(t.items().map((e) => [e.id, e.sent])).toEqual([
      [first.id, true],
      [second.id, undefined],
    ]);

    // サーバーの盤面が届く（a の注文が新しくなる。始めた時刻はサーバーの時刻）
    t.setServer(
      orders(
        cup("a", {
          dripper: 1,
          dripperPosition: 1,
          dripId: "drip-a",
          brewStartedAt: SERVER_T,
        }),
        cup("b"),
      ),
    );
    await t.outbox.kick();
    expect(t.sent).toHaveLength(2);
    const request = t.sent[1];
    expect(request.kind === "cups" && request.writes[0].before).toMatchObject({
      dripper: 1,
      brew_started_at: SERVER_T.toISOString(),
    });
  });

  test("サーバーの盤面が届かなくても、待つのは ECHO_MS まで", async () => {
    const server = orders(cup("a"), cup("b"));
    const t = setup(
      [entry(place(server, "a", 1)), entry(place(server, "b", 2))],
      server,
    );
    await t.outbox.kick();
    expect(t.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.sent).toHaveLength(2);
  });

  test("つながっていない（サーバーの盤面が無い）あいだは送らず、つながったら送る", async () => {
    const server = orders(cup("a"));
    const t = setup([entry(place(server, "a", 1))], null);
    await t.outbox.kick();
    expect(t.sent).toHaveLength(0);
    t.setServer(server);
    await t.outbox.kick();
    expect(t.sent).toHaveLength(1);
  });

  test("つながらない・5xx は間をあけて何度でも送り直し、そのあいだ後ろは送らない", async () => {
    const server = orders(cup("a"), cup("b"));
    const t = setup(
      [entry(place(server, "a", 1)), entry(place(server, "b", 2))],
      server,
      [{ error: "cafeore-pos につながりません" }, { error: "x", status: 503 }],
    );
    await t.outbox.kick();
    expect(t.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(t.sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.sent).toHaveLength(3);
    expect(t.sent.map((r) => r.kind === "cups" && r.writes[0].cup_ids)).toEqual(
      [["a"], ["a"], ["a"]],
    );
    expect(t.rejected).toEqual([]);
  });

  test("送れたが返事が届かなかったあと、サーバーの盤面がもうそうなっていれば送らずに済ませる", async () => {
    const server = orders(cup("a"));
    const t = setup([entry(place(server, "a", 1))], server, [
      { error: "返事がありません" },
    ]);
    await t.outbox.kick();
    t.setServer(
      orders(
        cup("a", {
          dripper: 1,
          dripperPosition: 1,
          dripId: "drip-a",
          brewStartedAt: SERVER_T,
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.sent).toHaveLength(1);
    expect(t.items()).toEqual([]);
    expect(t.rejected).toEqual([]);
  });

  test("409 のあと、カードの場所が同じなら（番号がずれただけ）サーバーの今の値で送り直す", async () => {
    const queued = (position: number) =>
      orders(
        cup("a", { dripper: 1, dripperPosition: position, dripId: "drip-a" }),
        cup("b", {
          dripper: 1,
          dripperPosition: 1,
          dripId: "drip-b",
          brewStartedAt: NOW,
        }),
      );
    const op = entry(place(queued(2), "a", 2));
    const t = setup([op], queued(2), [
      { error: "ほかの端末で先に変わりました", status: 409 },
    ]);
    await t.outbox.kick();
    t.setServer(queued(5));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.sent).toHaveLength(2);
    const retried = t.sent[1];
    expect(
      retried.kind === "cups" && retried.writes[0].before.dripper_position,
    ).toBe(5);
    expect(t.rejected).toEqual([]);
  });

  test("409 のあともほかの端末が動かしたままなら、送り直さずに捨てて何が戻ったかを知らせ、次を送る", async () => {
    const server = orders(cup("a"), cup("b"));
    const t = setup(
      [
        entry(place(server, "a", 1), "割当 #001 → 1st"),
        entry(place(server, "b", 2)),
      ],
      server,
      [{ error: "ほかの端末で先に変わりました", status: 409 }],
    );
    await t.outbox.kick();
    t.setServer(
      orders(
        cup("a", { dripper: 3, dripperPosition: 1, dripId: "drip-other" }),
        cup("b"),
      ),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.rejected).toEqual([
      ["割当 #001 → 1st", "ほかの端末で先に変わりました"],
    ]);
    expect(t.sent.map((r) => r.kind === "cups" && r.writes[0].cup_ids)).toEqual(
      [["a"], ["b"]],
    );
  });

  test("400（決まりに合わない）は送り直さずに捨てる", async () => {
    const server = orders(cup("a"));
    const t = setup([entry(place(server, "a", 1), "割当")], server, [
      { error: "上級生のみのカードは…", status: 400 },
    ]);
    await t.outbox.kick();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.sent).toHaveLength(1);
    expect(t.rejected).toEqual([["割当", "上級生のみのカードは…"]]);
    expect(t.items()).toEqual([]);
  });
});

test("unit: caos-outbox 端末に残したものは JSON から読み直せる（「1つ戻す」の時刻も）", () => {
  const server = orders(
    cup("a", {
      dripper: 1,
      dripperPosition: 1,
      dripId: "d",
      brewStartedAt: NOW,
    }),
  );
  const op = place(server, "a", 2);
  if (op.kind !== "cups") throw new Error();
  const undo = entry({
    kind: "undo",
    entry: undoOfWrites(buildCaosCards(server), op.writes),
  });
  const { id, ...stored } = undo;
  expect(parseCaosOutboxEntry(id, JSON.parse(JSON.stringify(stored)))).toEqual(
    undo,
  );
  expect(
    parseCaosOutboxEntry(id, { at: 1, label: "x", op: { kind: "?" } }),
  ).toBe(null);
});
