import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Cup } from "../models/cup";
import {
  type CaosOrderInput,
  assignWrites,
  buildCaosCards,
  caosLane,
  caosStateJSON,
  mergeWrites,
} from "./caos-board";
import {
  type CaosOutboxEntry,
  type CaosOutboxOp,
  type CaosOutboxResult,
  type CaosServerState,
  createCaosOutbox,
  overlayCaosLanes,
  overlayCaosOrders,
  parseCaosOutboxEntry,
} from "./caos-outbox";
import { type CaosLanes, emptyCaosLanes } from "./caosLanes";
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
    serve_with_snack: false,
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

  test("注文をまたぐ統合は、一部の注文だけ届いたあいだも、届いていない注文のぶんを重ねて 1 枚に出す", () => {
    const server = orders(cup("a"), cup("b"));
    const merged = mergeWrites(
      cardOf(server, "a"),
      cardOf(server, "b"),
      () => "drip-m",
    );
    if (!("writes" in merged)) throw new Error(merged.error);
    const op = entry({ kind: "cups", writes: merged.writes });
    const half = orders(cup("a", { dripId: "drip-m" }), cup("b"));
    const card = cardOf(overlayCaosOrders(half, [op], DAY), "a");
    expect(card.cups.map((c) => c.id)).toEqual(["a", "b"]);
    expect(card.dripId).toBe("drip-m");
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
    // 重ねるのもサーバーと同じく終えた時刻だけで、準備完了（提供可能）にはしない
    expect(lane.done[0].cups[0].readyAt).toBeNull();
  });

  test("終えるだけの「次へ」（startNext: false）は、重ねても待機の先頭を始めない", () => {
    const brewing = orders(
      cup("a", {
        dripper: 1,
        dripperPosition: 1,
        dripId: "drip-a",
        brewStartedAt: NOW,
      }),
      cup("b", { dripper: 1, dripperPosition: 2, dripId: "drip-b" }),
    );
    const finish = entry({
      kind: "next",
      dripper: 1,
      dripId: "drip-a",
      startId: null,
      startNext: false,
    });
    const lane = caosLane(
      buildCaosCards(overlayCaosOrders(brewing, [finish], DAY)),
      1,
    );
    expect(lane.done.map((card) => card.key)).toEqual(["drip-a"]);
    expect(lane.brewing).toBeUndefined();
    expect(lane.queued.map((card) => card.key)).toEqual(["drip-b"]);
  });

  test("押したカードを始める「次へ」（startPressed）は、そのカードが待機の先頭のときだけ重ねる", () => {
    const board = orders(
      cup("a", {
        dripper: 1,
        dripperPosition: 1,
        dripId: "drip-a",
        brewStartedAt: NOW,
      }),
      cup("b", { dripper: 1, dripperPosition: 2, dripId: "drip-b" }),
      cup("c", { dripper: 1, dripperPosition: 3, dripId: "drip-c" }),
    );
    const start = (startId: string) =>
      entry({
        kind: "next",
        dripper: 1,
        dripId: "drip-a",
        startId,
        startPressed: true,
      });
    const brewingOf = (op: ReturnType<typeof start>) =>
      caosLane(buildCaosCards(overlayCaosOrders(board, [op], DAY)), 1).brewing
        ?.key;
    // 先頭へ動かすのが通らず、押したカード（c）が先頭でなければ、b を始めない
    expect(brewingOf(start("drip-c"))).toBe("drip-a");
    expect(brewingOf(start("drip-b"))).toBe("drip-b");
  });

  test("担当者の交代と入れ替えを重ねる。届いた担当者がもう入れ替わっていれば、入れ替え直さない", () => {
    const lanes = emptyCaosLanes(DAY).lanes.map((lane) =>
      lane.dripper === 2 ? { ...lane, name: "山田", senior: true } : lane,
    );
    const swap = entry({
      kind: "swap",
      first: 1,
      second: 2,
      names: ["鈴木", "山田"],
    });
    const entries = [
      entry({
        kind: "lane",
        dripper: 1,
        name: "鈴木",
        senior: false,
        before: "",
      }),
      swap,
    ];
    const names = (input: readonly { name: string; senior: boolean }[]) =>
      input.slice(0, 2).map(({ name, senior }) => [name, senior]);
    const changed = overlayCaosLanes(lanes, entries, DAY);
    expect(names(changed)).toEqual([
      ["山田", true],
      ["鈴木", false],
    ]);
    expect(names(overlayCaosLanes(changed, [swap], DAY))).toEqual(
      names(changed),
    );
  });

  test("担当者の学年は交代と入れ替えで名前と一緒に扱い、自由入力では消える", () => {
    const lanes = emptyCaosLanes(DAY).lanes;
    const change = entry({
      kind: "lane",
      dripper: 1,
      name: "山田",
      senior: false,
      grade: "B2",
      before: "",
    });
    const swap = entry({
      kind: "swap",
      first: 1,
      second: 2,
      names: ["山田", ""],
    });
    const current = overlayCaosLanes(lanes, [change, swap], DAY);
    expect(current[1]).toMatchObject({ name: "山田", grade: "B2" });
    const typed = entry({
      kind: "lane",
      dripper: 2,
      name: "手入力",
      senior: false,
      before: "山田",
    });
    expect(overlayCaosLanes(current, [typed], DAY)[1]).toMatchObject({
      name: "手入力",
      grade: "",
    });
  });

  test("交代は、届いた担当者が押したときのままのときだけ重ねる（ほかの端末が先に替えていれば、サーバーの今のまま）", () => {
    const lanes = (name: string) =>
      emptyCaosLanes(DAY).lanes.map((lane) =>
        lane.dripper === 1 ? { ...lane, name } : lane,
      );
    const change = entry({
      kind: "lane",
      dripper: 1,
      name: "鈴木",
      senior: false,
      before: "山田",
    });
    expect(overlayCaosLanes(lanes("山田"), [change], DAY)[0].name).toBe("鈴木");
    expect(overlayCaosLanes(lanes("佐藤"), [change], DAY)[0].name).toBe("佐藤");
  });

  test("前の日に押した操作は重ねない", () => {
    const server = orders(cup("a"));
    const yesterday = {
      ...entry(place(server, "a", 1)),
      at: NOW.getTime() - 24 * 60 * 60 * 1000,
    };
    expect(
      cardOf(overlayCaosOrders(server, [yesterday], DAY), "a").status,
    ).toBe("unassigned");
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
    lanes: CaosLanes | null = null,
  ) => {
    const { items, store } = memoryStore(entries);
    let server: CaosServerState | null = initial && { orders: initial, lanes };
    const sent: CaosOutboxOp[] = [];
    const pressed: number[] = [];
    const rejected: [string, string][] = [];
    const outbox = createCaosOutbox({
      store,
      server: () => server,
      send: async (request, pressedAt) => {
        sent.push(request);
        pressed.push(pressedAt);
        return results.shift() ?? {};
      },
      onRejected: ({ label }, reason) => rejected.push([label, reason]),
    });
    return {
      outbox,
      items,
      sent,
      pressed,
      rejected,
      setServer: (next: readonly CaosOrderInput[] | null) => {
        server = next && { orders: next, lanes: null };
      },
    };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("破棄を送信し、同じ終了カードの反映後は再送せず、通常終了との競合は断る", async () => {
    const original = cup("a", {
      dripper: 1,
      dripperPosition: 1,
      dripId: "original",
      brewStartedAt: NOW,
      emergencies: [
        {
          id: "redo",
          createdAt: NOW,
          reason: "抽出ミス",
          dripper: null,
          dripperPosition: null,
          dripId: null,
          brewStartedAt: null,
          brewFinishedAt: null,
        },
      ],
    });
    const op = entry({
      kind: "discard",
      request: {
        cup_ids: ["a"],
        before: caosStateJSON(original),
        drip_id: "discarded",
      },
    });
    const initial = orders(original);
    const live = setup([op], initial);
    await live.outbox.kick();
    expect(live.sent).toHaveLength(1);
    expect(live.sent[0]).toMatchObject({
      kind: "discard",
      request: { drip_id: "discarded", cup_ids: ["a"] },
    });
    live.outbox.stop();
    const reflected = setup(
      [op],
      orders({ ...original, dripId: "discarded", brewFinishedAt: SERVER_T }),
    );
    await reflected.outbox.kick();
    expect(reflected.sent).toHaveLength(0);
    expect(reflected.items()).toHaveLength(0);
    reflected.outbox.stop();
    const conflict = setup(
      [op],
      orders({ ...original, brewFinishedAt: SERVER_T }),
    );
    await conflict.outbox.kick();
    expect(conflict.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(conflict.rejected).toHaveLength(1);
    conflict.outbox.stop();
  });

  test("送信中だけロックし、反映待ち中は別タブに解放する。再送タイマーもロックを取る", async () => {
    const initial = orders(cup("a"));
    const { store, items } = memoryStore([entry(place(initial, "a", 1))]);
    let locked = false;
    const lock = vi.fn(async (run: () => Promise<void>) => {
      expect(locked).toBe(false);
      locked = true;
      try {
        await run();
      } finally {
        locked = false;
      }
    });
    const send = vi.fn(async () => {
      expect(locked).toBe(true);
      return { error: "offline" };
    });
    const sender = createCaosOutbox({
      store,
      server: () => ({ orders: initial, lanes: null }),
      send,
      onRejected: vi.fn(),
      withLock: lock,
    });
    await sender.kick();
    expect(locked).toBe(false);
    expect(items()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lock).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
    sender.stop();
  });

  test("担当者の再受信待ちでも割当は直ちに送り、交代は担当者が届くまで待つ", async () => {
    const initial = orders(cup("a"));
    for (const op of [
      place(initial, "a", 1),
      { kind: "lane", dripper: 1, name: "A", senior: false } as const,
    ]) {
      const { store } = memoryStore([entry(op)]);
      const state = { orders: initial, lanes: null, lanesReady: false };
      const send = vi.fn(async () => ({}));
      const sender = createCaosOutbox({
        store,
        server: () => state,
        send,
        onRejected: vi.fn(),
      });
      await sender.kick();
      expect(send).toHaveBeenCalledTimes(op.kind === "cups" ? 1 : 0);
      state.lanesReady = true;
      await sender.kick();
      expect(send).toHaveBeenCalledTimes(1);
      sender.stop();
    }
  });

  test("別タブ・再読込でも送信済み操作の反映待ちを復元し、古い盤面で消さない", async () => {
    const initial = orders(cup("a"));
    const { store, items } = memoryStore([entry(place(initial, "a", 1))]);
    const first = createCaosOutbox({
      store,
      server: () => ({ orders: initial, lanes: null }),
      send: async () => ({}),
      onRejected: vi.fn(),
    });
    await first.kick();
    first.stop();
    const stored = items()[0];
    const { id, ...json } = stored;
    expect(parseCaosOutboxEntry(id, JSON.parse(JSON.stringify(json)))).toEqual(
      stored,
    );
    const send = vi.fn(async () => ({}));
    const reopened = createCaosOutbox({
      store,
      server: () => ({ orders: initial, lanes: null }),
      send,
      onRejected: vi.fn(),
    });
    await reopened.kick();
    expect(items()).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
    reopened.stop();
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

  test("つなぎ直して全部の注文が届き直しただけ（まだ送ったもののとおりでない）なら、届いたとみずに次を送らない", async () => {
    const server = orders(cup("a"), cup("b"));
    const t = setup(
      [entry(place(server, "a", 1)), entry(place(server, "b", 2))],
      server,
    );
    await t.outbox.kick();
    t.setServer(orders(cup("a"), cup("b")));
    await t.outbox.kick();
    expect(t.sent).toHaveLength(1);
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

  test("押した時刻をいっしょに送る", async () => {
    const started = orders(
      cup("a", {
        dripper: 1,
        dripperPosition: 1,
        dripId: "drip-a",
        brewStartedAt: new Date(NOW.getTime() - 60_000),
      }),
    );
    const next = entry({
      kind: "next",
      dripper: 1,
      dripId: "drip-a",
      startId: null,
    });
    const t = setup([next], started);
    await t.outbox.kick();
    expect(t.sent.map((r) => r.kind)).toEqual(["next"]);
    expect(t.pressed).toEqual([next.at]);
  });

  test("サーバーの始めた時刻が後ろにずれて、押した時刻では 10 秒に届かない「次へ」は、始めた時刻の 11 秒後に押したことにして、その時刻まで待って送る", async () => {
    const started = orders(
      cup("a", {
        dripper: 1,
        dripperPosition: 1,
        dripId: "drip-a",
        brewStartedAt: NOW,
      }),
    );
    const t = setup(
      [entry({ kind: "next", dripper: 1, dripId: "drip-a", startId: null })],
      started,
    );
    await t.outbox.kick();
    expect(t.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10_999);
    expect(t.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.sent.map((r) => r.kind)).toEqual(["next"]);
    expect(t.pressed).toEqual([NOW.getTime() + 11_000]);
  });

  test("返事を待っているあいだは、その操作を送っている途中（inFlight）とする", async () => {
    const server = orders(cup("a"));
    const op = entry(place(server, "a", 1));
    const { store } = memoryStore([op]);
    let answer: (result: CaosOutboxResult) => void = () => {};
    const outbox = createCaosOutbox({
      store,
      server: () => ({ orders: server, lanes: null }),
      send: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
      onRejected: () => {},
    });
    expect(outbox.inFlight()).toBeNull();
    const kicked = outbox.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.inFlight()).toBe(op.id);
    answer({});
    await kicked;
    expect(outbox.inFlight()).toBeNull();
  });

  test("前の日に押した操作は送らずに捨てる", async () => {
    const server = orders(cup("a"));
    const t = setup(
      [
        {
          ...entry(place(server, "a", 1), "割当"),
          at: NOW.getTime() - 24 * 60 * 60 * 1000,
        },
      ],
      server,
    );
    await t.outbox.kick();
    expect(t.sent).toEqual([]);
    expect(t.rejected.map(([label]) => label)).toEqual(["割当"]);
  });

  test("「次へ」を返事が無く送り直すとき、終えるカードが終わっていれば、ほかの端末が待機の先頭を入れ替えていても済みにする", async () => {
    const before = orders(
      cup("a", {
        dripper: 1,
        dripperPosition: 1,
        dripId: "drip-a",
        brewStartedAt: NOW,
      }),
      cup("b", { dripper: 1, dripperPosition: 2, dripId: "drip-b" }),
      cup("c", { dripper: 1, dripperPosition: 3, dripId: "drip-c" }),
    );
    const t = setup(
      [
        entry({
          kind: "next",
          dripper: 1,
          dripId: "drip-a",
          startId: "drip-b",
        }),
      ],
      before,
      [{ error: "返事がありません" }],
    );
    await vi.advanceTimersByTimeAsync(11_000);
    await t.outbox.kick();
    // サーバーでは a を終え、ほかの端末が先頭に入れた c を始めていた
    t.setServer(
      orders(
        cup("a", {
          dripper: 1,
          dripperPosition: 1,
          dripId: "drip-a",
          brewStartedAt: NOW,
          brewFinishedAt: NOW,
        }),
        cup("b", { dripper: 1, dripperPosition: 3, dripId: "drip-b" }),
        cup("c", {
          dripper: 1,
          dripperPosition: 2,
          dripId: "drip-c",
          brewStartedAt: NOW,
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.sent).toHaveLength(1);
    expect(t.items()).toEqual([]);
    expect(t.rejected).toEqual([]);
  });

  test("入れ替えは、押したときの担当者のままのときだけ送る。ほかの端末が替えていれば捨てる", async () => {
    const lanes = (first: string, second: string): CaosLanes => {
      const names = new Map([
        [1, first],
        [2, second],
      ]);
      return {
        day: DAY,
        lanes: emptyCaosLanes(DAY).lanes.map((lane) => ({
          ...lane,
          name: names.get(lane.dripper) ?? lane.name,
        })),
      };
    };
    const swap = () =>
      entry(
        { kind: "swap", first: 1, second: 2, names: ["鈴木", "山田"] },
        "入れ替え",
      );
    const ok = setup([swap()], [], [], lanes("鈴木", "山田"));
    await ok.outbox.kick();
    expect(ok.sent.map((r) => r.kind)).toEqual(["swap"]);

    const changed = setup([swap()], [], [], lanes("佐藤", "山田"));
    await changed.outbox.kick();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(changed.sent).toEqual([]);
    expect(changed.rejected.map(([label]) => label)).toEqual(["入れ替え"]);
  });

  describe("交代", () => {
    const lanes = (name: string): CaosLanes => ({
      day: DAY,
      lanes: emptyCaosLanes(DAY).lanes.map((lane) =>
        lane.dripper === 1 ? { ...lane, name } : lane,
      ),
    });
    const change = (before: string, name: string) =>
      entry(
        { kind: "lane", dripper: 1, name, senior: false, before },
        `交代 1st → ${name}`,
      );
    const TAKEN =
      "1st の交代は、ほかの iPad が先に替えていたので取りやめました";

    test("押したときの担当者のままなら送る", async () => {
      const t = setup([change("山田", "鈴木")], [], [], lanes("山田"));
      await t.outbox.kick();
      expect(t.sent.map((r) => r.kind)).toEqual(["lane"]);
      expect(t.rejected).toEqual([]);
    });

    test("今日の担当者がまだ無ければ（サーバーは何も送らない）空きとみて、空きから替えたものを送る", async () => {
      const t = setup([change("", "鈴木")], [], [], null);
      await t.outbox.kick();
      expect(t.sent.map((r) => r.kind)).toEqual(["lane"]);
    });

    test("押したときの担当者の無い交代（前の版で残したもの）は、確かめずに送る", async () => {
      const old = entry({
        kind: "lane",
        dripper: 1,
        name: "鈴木",
        senior: false,
      });
      const t = setup([old], [], [], lanes("佐藤"));
      await t.outbox.kick();
      expect(t.sent.map((r) => r.kind)).toEqual(["lane"]);
    });

    test("ほかの端末が先に替えていれば、送らずに捨てて知らせる", async () => {
      const t = setup([change("山田", "鈴木")], [], [], lanes("佐藤"));
      await t.outbox.kick();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(t.sent).toEqual([]);
      expect(t.rejected).toEqual([["交代 1st → 鈴木", TAKEN]]);
      expect(t.items()).toEqual([]);
    });

    test("つながらないあいだに続けた交代は、そのあいだにほかの端末が替えていれば、どれも送らずに捨てる", async () => {
      // この端末で 山田 → 鈴木 → 田中 と替えたが、送る前にほかの端末が 山田 → 佐藤 と替えた
      const t = setup(
        [change("山田", "鈴木"), change("鈴木", "田中")],
        [],
        [],
        lanes("佐藤"),
      );
      await t.outbox.kick();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(t.sent).toEqual([]);
      expect(t.rejected).toEqual([
        ["交代 1st → 鈴木", TAKEN],
        ["交代 1st → 田中", TAKEN],
      ]);
      expect(t.items()).toEqual([]);
    });
  });

  test("ログインが切れた（401・403）は捨てずに送り直す", async () => {
    const server = orders(cup("a"));
    const t = setup([entry(place(server, "a", 1))], server, [
      { error: "x", status: 401 },
      { error: "x", status: 403 },
    ]);
    await t.outbox.kick();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(t.sent).toHaveLength(3);
    expect(t.rejected).toEqual([]);
    expect(t.items().map((e) => e.sent)).toEqual([true]);
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

test("unit: caos-outbox 端末に残したものは JSON から読み直せる", () => {
  const server = orders(cup("a"));
  const placed = { ...entry(place(server, "a", 2)), sent: true as const };
  const { id, ...stored } = placed;
  expect(parseCaosOutboxEntry(id, JSON.parse(JSON.stringify(stored)))).toEqual(
    placed,
  );
  expect(
    parseCaosOutboxEntry(id, { at: 1, label: "x", op: { kind: "?" } }),
  ).toBe(null);
  // 前の版の「1つ戻す」（もう送らない）は読まない
  expect(
    parseCaosOutboxEntry(id, {
      at: 1,
      label: "x",
      op: { kind: "undo", entry: { cups: [] } },
    }),
  ).toBe(null);
  // 形の違うもの（欠かせない項目が無い）は読まない
  expect(
    parseCaosOutboxEntry(id, { at: 1, label: "x", op: { kind: "cups" } }),
  ).toBe(null);
  expect(
    parseCaosOutboxEntry(id, { at: 1, label: "x", op: { kind: "toString" } }),
  ).toBe(null);
  // 押したときの担当者の無い交代（前の版で残したもの）も読む（確かめずに送る）
  const lane = { kind: "lane", dripper: 1, name: "鈴木", senior: false };
  expect(parseCaosOutboxEntry(id, { at: 1, label: "x", op: lane })?.op).toEqual(
    lane,
  );
});
