import {
  type ItemType,
  MenuEntity,
  OrderEntity,
  jstDate,
} from "@cafeore/common";
import { describe, expect, test } from "vitest";
import { STACK_MODEL, predictReadyMinutes } from "../readyTimeEstimate";
import baseline from "./data/baseline-2025.json";
import { type TimeWindow, dayWindow, quantile } from "./operations";
import {
  type StackObservation,
  type StackOrder,
  stackModelTrend,
  stackModelView,
  stackObservations,
  stackOrders,
  stackWarnings,
  trendPointFromFit,
} from "./stackModel";
import { type StackFit, fitStackModel, predictWithFit } from "./stackModelFit";

/** 日本時間の時刻を epoch ミリ秒にする */
const at = (clock: string, date = "2026-11-07") =>
  Date.parse(`${date}T${clock}+09:00`);

/** StackOrder を手で書く */
const so = (
  id: string,
  created: number,
  {
    ready = null,
    cancelled = null,
    cups = 1,
  }: { ready?: number | null; cancelled?: number | null; cups?: number } = {},
): StackOrder => ({
  id,
  number: Number(id.replace(/\D/g, "")) || 0,
  created,
  ready,
  cancelled,
  drinkCups: cups,
  day: jstDate(created),
});

const stackOf = (observations: StackObservation[], id: string) =>
  observations.find((o) => o.id === id)?.stack;

/** 2025 年の同梱データの行を StackOrder に写す（ドリンク杯数は R の is_service_item() と同じ） */
const baselineStackOrders = (rows: unknown[][]): StackOrder[] =>
  rows.map((row) => {
    const orderId = row[0] as number;
    const created = Date.parse(row[1] as string);
    const readyAt = row[2] as string | null;
    return {
      id: String(orderId),
      number: orderId,
      created,
      ready: readyAt ? Date.parse(readyAt) : null,
      cancelled: null,
      drinkCups: (row[5] as string[][]).filter(([, type]) => type !== "others")
        .length,
      day: jstDate(created),
    };
  });
const baselineOrders = baselineStackOrders(baseline.orders as unknown[][]);

/** 有効数字 3 桁に丸める */
const sig3 = (value: number) => Number(value.toPrecision(3));

describe("[unit] stackOrders", () => {
  const itemType = (name: string, makesCup: boolean): ItemType => ({
    id: name,
    name,
    display_name: name,
    makes_cup: makesCup,
    needs_brew: makesCup,
    senior_only: false,
    iced_brew: false,
  });
  const hot = itemType("hot", true);
  const goods = itemType("others", false);
  const menu = (id: string, ...types: ItemType[]) =>
    MenuEntity.fromMenu({
      id,
      name: id,
      abbr: id,
      price: 500,
      key: id,
      items: types.map((type, i) => ({
        item: { id: `${id}-${i}`, name: id, abbr: id, item_type: type },
        quantity: 1,
      })),
      assignee: "担当者",
    });
  const blend = menu("blend", hot);
  const tote = menu("tote", hot, goods);
  const bag = menu("bag", goods);

  const order = (
    orderId: number,
    menus: ReturnType<typeof menu>[],
    {
      id,
      createdAt = new Date("2026-11-07T11:00:00+09:00"),
      readyAt = null,
      cancelledAt = null,
    }: {
      id?: string;
      createdAt?: Date;
      readyAt?: Date | null;
      cancelledAt?: Date | null;
    } = {},
  ) => {
    const entity = OrderEntity.fromOrder({
      ...OrderEntity.createNew({ orderId }).toOrder(),
      id,
      createdAt,
      readyAt,
      cancelledAt,
    });
    entity.menus = menus;
    entity.addComment("cashier", "コメント");
    return entity;
  };

  test("必要な列だけを写す（指名とコメントは写さない）", () => {
    const created = new Date("2026-11-07T11:00:00+09:00");
    const ready = new Date("2026-11-07T11:07:00+09:00");
    const cancelled = new Date("2026-11-07T11:09:00+09:00");
    const [mapped] = stackOrders([
      order(12, [blend, blend], {
        id: "uuid-12",
        createdAt: created,
        readyAt: ready,
        cancelledAt: cancelled,
      }),
    ]);
    expect(mapped).toEqual({
      id: "uuid-12",
      number: 12,
      created: created.getTime(),
      ready: ready.getTime(),
      cancelled: cancelled.getTime(),
      drinkCups: 2,
      day: "2026-11-07",
    });
    expect(Object.keys(mapped).sort()).toEqual([
      "cancelled",
      "created",
      "day",
      "drinkCups",
      "id",
      "number",
      "ready",
    ]);
  });

  test("id が無ければ注文番号を使う。打刻が無ければ null", () => {
    const mapped = stackOrders([order(7, [blend])]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].id).toBe("7");
    expect(mapped[0].ready).toBeNull();
    expect(mapped[0].cancelled).toBeNull();
  });

  test("ドリンク杯数は getDrinkCups() と同じ（セットは構成品、グッズは数えない）", () => {
    const orders = [order(1, [tote]), order(2, [bag]), order(3, [blend, tote])];
    const mapped = stackOrders(orders);
    expect(mapped.map((o) => o.drinkCups)).toEqual([1, 0, 2]);
    expect(mapped.map((o) => o.drinkCups)).toEqual(
      orders.map((o) => o.getDrinkCups().length),
    );
  });

  test("受付時刻が有限でない注文は捨て、ほかの打刻が有限でなければ null にする", () => {
    const mapped = stackOrders([
      order(1, [blend], { createdAt: new Date(Number.NaN) }),
      order(2, [blend], {
        readyAt: new Date(Number.NaN),
        cancelledAt: new Date(Number.NaN),
      }),
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].number).toBe(2);
    expect(mapped[0].ready).toBeNull();
    expect(mapped[0].cancelled).toBeNull();
  });

  test("同じ id が複数あれば後のものを使う", () => {
    const mapped = stackOrders([
      order(1, [blend], { id: "same" }),
      order(2, [blend, blend], { id: "same" }),
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].number).toBe(2);
    expect(mapped[0].drinkCups).toBe(2);
  });
});

describe("[unit] stackObservations", () => {
  const orders: StackOrder[] = [
    // 受付の順は stackObservations が並べ直す。わざと崩しておく。
    so("E7", at("10:25:00")),
    so("A1", at("10:00:00"), { ready: at("10:10:00"), cups: 2 }),
    so("C4", at("10:10:00"), { ready: at("10:30:00") }),
    // 壊れた記録（提供可能が受付より前）
    so("X2", at("10:02:00"), { ready: at("09:58:00") }),
    so("B3", at("10:05:00"), { cancelled: at("10:20:00") }),
    // グッズのみ
    so("G5", at("10:12:00"), { cups: 0 }),
    so("D6", at("10:15:00"), { ready: at("10:40:00") }),
    // 前日: 未完了・提供済み・取消済み
    so("P1", at("23:50:00", "2026-11-06"), { cups: 3 }),
    so("P2", at("23:40:00", "2026-11-06"), {
      ready: at("23:45:00", "2026-11-06"),
    }),
    so("P3", at("23:30:00", "2026-11-06"), {
      cancelled: at("23:35:00", "2026-11-06"),
    }),
    // 翌日
    so("N8", at("00:10:00", "2026-11-08")),
  ];
  const { observations, otherDays } = stackObservations(orders, "2026-11-07");

  test("選択日の注文だけを受付の昇順で返す", () => {
    expect(observations.map((o) => o.id)).toEqual([
      "A1",
      "X2",
      "B3",
      "C4",
      "G5",
      "D6",
      "E7",
    ]);
  });

  test("受付の瞬間に未完了だった先行注文の杯数を足す", () => {
    expect(stackOf(observations, "A1")).toBe(0); // 前日の未完了は数えない
    expect(stackOf(observations, "X2")).toBe(2); // A1
    expect(stackOf(observations, "B3")).toBe(2); // A1（X2 は壊れた記録）
    expect(stackOf(observations, "C4")).toBe(1); // B3（A1 は ready === created なので数えない）
    expect(stackOf(observations, "G5")).toBe(2); // B3・C4
    expect(stackOf(observations, "D6")).toBe(2); // B3・C4（G5 は 0 杯）
    expect(stackOf(observations, "E7")).toBe(2); // C4・D6（B3 は取消の後）
  });

  test("壊れた記録だけが brokenTime", () => {
    expect(observations.filter((o) => o.brokenTime).map((o) => o.id)).toEqual([
      "X2",
    ]);
  });

  test("グッズのみの注文も観測に入る", () => {
    expect(observations.find((o) => o.id === "G5")?.drinkCups).toBe(0);
  });

  test("前日の未完了だけが otherDays に入る（翌日は入らない）", () => {
    expect(otherDays.map((o) => o.id)).toEqual(["P1"]);
  });
});

describe("[unit] SC-001: 雙峰祭2025 の当てはめ", () => {
  test("解析リポジトリの係数と有効数字 3 桁で一致する", () => {
    const points = ["2025-11-02", "2025-11-03"].flatMap((day) =>
      stackObservations(baselineOrders, day)
        .observations.filter((o) => o.ready !== null && !o.brokenTime)
        .map((o) => ({
          stack: o.stack,
          minutes: ((o.ready as number) - o.created) / 60_000,
        })),
    );
    const fit = fitStackModel(points);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.nObs).toBe(978);
    expect(sig3(fit.a1)).toBe(7.28);
    expect(sig3(fit.b1)).toBe(-0.554);
    expect(sig3(fit.c1)).toBe(5.99);
    expect(sig3(fit.b)).toBe(0.444);
  });
});

/** 2026-11-07 の 10:00〜12:00 を 11:00 時点で見る、分類の確かめ用の注文 */
const classifyOrders: StackOrder[] = [
  // 期間の開始前（stack には数えるが、当てはめ・件数には入れない）
  so("O1", at("09:50:00"), { ready: at("10:05:00") }),
  so("O2", at("09:55:00"), { cups: 2 }),
  // 当てはめの対象
  so("F1", at("10:00:00"), { ready: at("10:08:00") }),
  so("F2", at("10:10:00"), { ready: at("10:20:00") }),
  // 取消（提供可能のあとの取消を含む）
  so("C1", at("10:15:00"), { cancelled: at("10:30:00") }),
  so("C2", at("10:20:00"), {
    ready: at("10:25:00"),
    cancelled: at("10:40:00"),
  }),
  // 時点より後の取消は、その時点ではまだ取消されていない
  so("C3", at("10:30:00"), { cancelled: at("11:30:00") }),
  // 壊れた記録
  so("B1", at("10:35:00"), { ready: at("10:30:00") }),
  // 未完了（時点より後に提供可能・提供可能なし）
  so("P1", at("10:40:00"), { ready: at("11:05:00") }),
  so("P2", at("10:50:00")),
  // 時点より後の受付
  so("L1", at("11:10:00"), { ready: at("11:20:00") }),
  // 前日の未完了
  so("Y1", at("23:00:00", "2026-11-06")),
];
const classifyInput = stackObservations(classifyOrders, "2026-11-07");
const classifyWindow: TimeWindow = {
  start: at("10:00:00"),
  end: at("12:00:00"),
  now: at("11:00:00"),
};
const classifyAsOf = at("11:00:00");

/** 2025-11-02 13:00 時点の入力（R の asof-20251102-1300 と同じ） */
const asOf1300 = Date.parse("2025-11-02T13:00:00+09:00");
const input1102 = stackObservations(baselineOrders, "2025-11-02");
const window1102 = dayWindow("2025-11-02", asOf1300);

/** 当てはめの対象が n 件ある入力（グッズのみなので stack はすべて 0） */
const fittedOnly = (n: number) =>
  stackObservations(
    Array.from({ length: n }, (_, i) =>
      so(`Q${i + 1}`, at("10:00:00") + i * 60_000, {
        ready: at("10:00:00") + (i + 5 + (i % 4)) * 60_000,
        cups: 0,
      }),
    ),
    "2026-11-07",
  );

describe("[unit] stackModelView: 分類と件数", () => {
  const view = stackModelView(classifyInput, classifyWindow, classifyAsOf);

  test("時点での分類ごとの件数", () => {
    expect(view.counts).toMatchObject({
      fitted: 2,
      pending: 3,
      cancelled: 2,
      broken: 1,
    });
  });

  test("当てはめの件数と fit.nObs が一致する", () => {
    expect(view.fit.nObs).toBe(view.counts.fitted);
    expect(view.fit).toEqual({
      ok: false,
      reason: "insufficient",
      nObs: 2,
      needed: 20,
    });
  });

  test("最後に反映した打刻は、期間の観測のうち時点より前の最大", () => {
    expect(view.counts.latestTimestamp).toBe(at("10:50:00"));
  });

  test("期間の観測が無ければ最後の打刻は null", () => {
    const empty = stackModelView(
      classifyInput,
      { start: at("13:00:00"), end: at("14:00:00"), now: at("13:30:00") },
      at("13:30:00"),
    );
    expect(empty.counts.latestTimestamp).toBeNull();
    expect(empty.counts).toMatchObject({
      fitted: 0,
      pending: 0,
      cancelled: 0,
      broken: 0,
    });
  });

  test("asOf と live", () => {
    expect(view.asOf).toBe(classifyAsOf);
    expect(view.live).toBe(true);
    const ended = stackModelView(
      classifyInput,
      classifyWindow,
      classifyWindow.end,
    );
    expect(ended.asOf).toBe(classifyWindow.end);
    expect(ended.live).toBe(false);
  });

  test("時点を進めると、提供可能・取消が付いた注文の分類が変わる", () => {
    const later = stackModelView(classifyInput, classifyWindow, at("11:40:00"));
    // P1 が当てはめ、C3 が取消、L1 が当てはめに加わる
    expect(later.counts).toMatchObject({
      fitted: 4,
      pending: 1,
      cancelled: 3,
      broken: 1,
    });
  });
});

describe("[unit] stackModelView: 2025-11-02 13:00 時点の切り詰め", () => {
  test("解析リポジトリの係数と有効数字 3 桁で一致する", () => {
    const view = stackModelView(input1102, window1102, asOf1300);
    expect(view.fit.ok).toBe(true);
    expect(view.fit.nObs).toBe(154);
    if (!view.fit.ok) return;
    expect(sig3(view.fit.a1)).toBe(5.4);
    expect(sig3(view.fit.b1)).toBe(-0.803);
    expect(sig3(view.fit.c1)).toBe(6.89);
    expect(sig3(view.fit.b)).toBe(0.346);
  });
});

describe("[unit] stackModelView: いまの状況", () => {
  const view = stackModelView(classifyInput, classifyWindow, classifyAsOf);

  test("時点で未完了の注文の杯数・件数・いちばん古い経過時間", () => {
    // O2（期間の開始前）2 杯 + C3・P1・P2 各 1 杯
    expect(view.now.stack).toBe(5);
    expect(view.now.pendingOrders).toBe(4);
    expect(view.now.oldestWaitMinutes).toBe(65);
    expect(view.now.asOf).toBe(classifyAsOf);
    expect(view.now.live).toBe(true);
  });

  test("固定モデルの予測は predictReadyMinutes と一致する", () => {
    expect(view.now.predictedFixed).toBe(predictReadyMinutes(view.now.stack));
  });

  test("前日以前の未完了の件数", () => {
    expect(view.now.otherDayPending).toBe(classifyInput.otherDays.length);
    expect(view.now.otherDayPending).toBe(1);
  });

  test("未完了が無ければ経過時間は null", () => {
    const empty = stackModelView(
      fittedOnly(3),
      { start: at("10:00:00"), end: at("12:00:00"), now: at("11:00:00") },
      at("11:00:00"),
    );
    expect(empty.now.stack).toBe(0);
    expect(empty.now.pendingOrders).toBe(0);
    expect(empty.now.oldestWaitMinutes).toBeNull();
  });

  test("19 件では当てはめず、固定モデルの予測だけを出す", () => {
    const few = stackModelView(
      fittedOnly(19),
      { start: at("10:00:00"), end: at("12:00:00"), now: at("11:00:00") },
      at("11:00:00"),
    );
    expect(few.fit).toEqual({
      ok: false,
      reason: "insufficient",
      nObs: 19,
      needed: 20,
    });
    expect(few.now.predictedFit).toBeNull();
    expect(few.now.predictedFixed).toBe(predictReadyMinutes(0));
    expect(few.now.extrapolated).toBe(false);
  });

  test("当てはめ済みなら当てはめの予測と外挿の判定を出す", () => {
    const view1300 = stackModelView(input1102, window1102, asOf1300);
    expect(view1300.fit.ok).toBe(true);
    if (!view1300.fit.ok) return;
    expect(view1300.now.predictedFit).toBe(
      predictWithFit(view1300.fit, view1300.now.stack),
    );
    expect(view1300.now.extrapolated).toBe(
      view1300.now.stack > view1300.fit.stackMax,
    );
  });

  test("固定モデルは STACK_MODEL そのもの", () => {
    expect(view.fixed).toBe(STACK_MODEL);
  });
});

describe("[unit] stackWarnings", () => {
  const fit = (overrides: Partial<Extract<StackFit, { ok: true }>> = {}) =>
    ({
      ok: true,
      a1: 7,
      b1: -0.5,
      c1: 6,
      nStaff: 6,
      b: 0.5,
      nObs: 100,
      iterations: 5,
      start: { a1: 5, b1: 0.1, c1: 2 },
      stackMin: 0,
      stackMax: 20,
      ...overrides,
    }) satisfies StackFit;

  test("どれにも当たらなければ空", () => {
    expect(stackWarnings(fit(), 10, 0)).toEqual([]);
  });

  test("a1 が観測の範囲外", () => {
    expect(stackWarnings(fit({ a1: 25 }), 10, 0)).toEqual([
      { kind: "a1-out-of-range", a1: 25, stackMin: 0, stackMax: 20 },
    ]);
    expect(stackWarnings(fit({ a1: -1 }), 10, 0)).toEqual([
      { kind: "a1-out-of-range", a1: -1, stackMin: 0, stackMax: 20 },
    ]);
  });

  test("a1 がちょうど端なら範囲内", () => {
    expect(stackWarnings(fit({ a1: 0 }), 10, 0)).toEqual([]);
    expect(stackWarnings(fit({ a1: 20 }), 10, 0)).toEqual([]);
  });

  test("傾き b が 0 以下", () => {
    expect(stackWarnings(fit({ b: -0.1 }), 10, 0)).toEqual([
      { kind: "non-positive-slope", b: -0.1 },
    ]);
    expect(stackWarnings(fit({ b: 0 }), 10, 0)).toEqual([
      { kind: "non-positive-slope", b: 0 },
    ]);
  });

  test("いまの stack が観測の最大を超える（外挿）", () => {
    expect(stackWarnings(fit(), 21, 0)).toEqual([
      { kind: "extrapolation", stack: 21, stackMax: 20 },
    ]);
    expect(stackWarnings(fit(), 20, 0)).toEqual([]);
  });

  test("前日以前の未完了は当てはめが不能でも出す", () => {
    expect(stackWarnings(fit(), 10, 2)).toEqual([
      { kind: "other-day-pending", count: 2 },
    ]);
    expect(
      stackWarnings(
        { ok: false, reason: "insufficient", nObs: 3, needed: 20 },
        100,
        2,
      ),
    ).toEqual([{ kind: "other-day-pending", count: 2 }]);
  });

  test("当てはめが不能なら係数の警告は出さない", () => {
    expect(
      stackWarnings({ ok: false, reason: "no-convergence", nObs: 40 }, 100, 0),
    ).toEqual([]);
  });

  test("stackModelView の warnings は stackWarnings と一致する", () => {
    const view = stackModelView(classifyInput, classifyWindow, classifyAsOf);
    expect(view.warnings).toEqual(
      stackWarnings(view.fit, view.now.stack, view.now.otherDayPending),
    );
    expect(view.warnings).toEqual([{ kind: "other-day-pending", count: 1 }]);
  });
});

/** stack と提供時間（分）を手で書いた、当てはめ対象だけの入力 */
const handInput = (
  rows: [stack: number, minutes: number][],
  waitingCups = 0,
) => {
  const observations: StackObservation[] = rows.map(([stack, minutes], i) => {
    const created = at("10:00:00") + i * 60_000;
    return {
      id: `H${i + 1}`,
      number: i + 1,
      created,
      ready: created + minutes * 60_000,
      cancelled: null,
      drinkCups: 0,
      stack,
      brokenTime: false,
    };
  });
  if (waitingCups > 0) {
    observations.push({
      id: "W",
      number: 999,
      created: at("11:50:00"),
      ready: null,
      cancelled: null,
      drinkCups: waitingCups,
      stack: 0,
      brokenTime: false,
    });
  }
  return { observations, otherDays: [] };
};
const handWindow: TimeWindow = {
  start: at("10:00:00"),
  end: at("14:00:00"),
  now: at("12:00:00"),
};
const handAsOf = at("12:00:00");

describe("[unit] stackModelView: 散布図", () => {
  const rows: [number, number][] = [
    [0, 5],
    [1, 6],
    [2, 5.5],
    [3, 6.5],
    [6, 7],
    [7, 8],
    [8, 7.5],
    [9, 9],
    [10, 8.5],
    [11, 60],
  ];
  const view = stackModelView(handInput(rows), handWindow, handAsOf);

  test("当てはめの対象 1 件につき 1 点", () => {
    expect(view.points).toHaveLength(10);
    expect(view.points[0]).toEqual({
      number: 1,
      stack: 0,
      minutes: 5,
      predictedFit: null,
      predictedFixed: predictReadyMinutes(0),
      clipped: false,
    });
    for (const point of view.points) {
      expect(point.predictedFixed).toBe(predictReadyMinutes(point.stack));
    }
  });

  test("曲線は 0 から観測の最大の stack まで 0.5 杯刻み", () => {
    expect(view.curve).toHaveLength(23);
    expect(view.curve[0].stack).toBe(0);
    expect(view.curve[1].stack).toBe(0.5);
    expect(view.curve.at(-1)?.stack).toBe(11);
    for (const point of view.curve) {
      expect(point.fit).toBeNull();
      expect(point.fixed).toBe(predictReadyMinutes(point.stack));
    }
  });

  test("いまの stack が大きければ、曲線をそこまで延ばす", () => {
    const waiting = stackModelView(handInput(rows, 15), handWindow, handAsOf);
    expect(waiting.now.stack).toBe(15);
    expect(waiting.curve.at(-1)?.stack).toBe(15);
  });

  test("縦軸の上限は Q3 + 3 × IQR と曲線の最大の大きい方を 5 分単位に切り上げる", () => {
    // Q1 = 6.125、Q3 = 8.375、IQR = 2.25 → 15.125。曲線の最大は約 7.6 分
    expect(view.yMax).toBe(20);
    expect(view.yMax % 5).toBe(0);
  });

  test("上限を超える点だけが clipped", () => {
    expect(view.clippedCount).toBe(1);
    expect(view.points.filter((p) => p.clipped).map((p) => p.minutes)).toEqual([
      60,
    ]);
  });

  test("2025-11-02 13:00 時点では 154 点で、すべてに当てはめの予測がある", () => {
    const view1300 = stackModelView(input1102, window1102, asOf1300);
    expect(view1300.points).toHaveLength(154);
    expect(
      view1300.points.every((p) => typeof p.predictedFit === "number"),
    ).toBe(true);
    expect(view1300.fit.ok).toBe(true);
    if (!view1300.fit.ok) return;
    expect(view1300.curve.at(-1)?.stack).toBe(
      Math.max(view1300.fit.stackMax, view1300.now.stack),
    );
    for (const point of view1300.curve) {
      expect(point.fit).toBe(predictWithFit(view1300.fit, point.stack));
    }
  });
});

describe("[unit] stackModelView: 精度の要約", () => {
  // 19 件（当てはめ不能）。stack はすべて 0 なので固定モデルの予測は c1
  const rows: [number, number][] = [
    ...Array.from({ length: 10 }, (): [number, number] => [0, 6]),
    ...Array.from({ length: 9 }, (): [number, number] => [0, 8]),
  ];
  const view = stackModelView(handInput(rows), handWindow, handAsOf);

  test("この当てはめ・固定モデル・一律に平均の 3 行", () => {
    expect(view.accuracy.map((row) => row.method)).toEqual([
      "fit",
      "fixed",
      "mean",
    ]);
  });

  test("当てはめ不能なら「この当てはめ」の値は null", () => {
    expect(view.accuracy[0]).toEqual({
      method: "fit",
      n: 19,
      meanResidual: null,
      mae: null,
      medianAbsError: null,
    });
  });

  test("固定モデルの行", () => {
    const c1 = STACK_MODEL.c1;
    expect(view.accuracy).toHaveLength(3);
    const row = view.accuracy[1];
    expect(row.n).toBe(19);
    const mean = (10 * (6 - c1) + 9 * (8 - c1)) / 19;
    expect(row.meanResidual).toBeCloseTo(mean, 10);
    expect(row.mae).toBeCloseTo(mean, 10);
    expect(row.medianAbsError).toBeCloseTo(6 - c1, 10);
  });

  test("一律に平均の行（予測は実測の平均）", () => {
    const average = (10 * 6 + 9 * 8) / 19;
    expect(view.accuracy).toHaveLength(3);
    const row = view.accuracy[2];
    expect(row.n).toBe(19);
    expect(row.meanResidual).toBeCloseTo(0, 10);
    expect(row.mae).toBeCloseTo(
      (10 * (average - 6) + 9 * (8 - average)) / 19,
      10,
    );
    expect(row.medianAbsError).toBeCloseTo(average - 6, 10);
  });

  test("2025-11-02 13:00 時点の「この当てはめ」の行", () => {
    const view1300 = stackModelView(input1102, window1102, asOf1300);
    expect(view1300.fit.ok).toBe(true);
    const errors = view1300.points.map(
      (p) => p.minutes - (predictWithFit(view1300.fit, p.stack) as number),
    );
    const absolute = errors.map(Math.abs).sort((a, b) => a - b);
    expect(view1300.accuracy).toHaveLength(3);
    const row = view1300.accuracy[0];
    expect(row.n).toBe(154);
    expect(row.meanResidual).toBeCloseTo(
      errors.reduce((sum, e) => sum + e, 0) / errors.length,
      10,
    );
    expect(row.mae).toBeCloseTo(
      absolute.reduce((sum, e) => sum + e, 0) / absolute.length,
      10,
    );
    expect(row.medianAbsError).toBeCloseTo(
      quantile(absolute, 0.5) as number,
      10,
    );
  });
});

describe("[unit] stackModelView: stack の区間表", () => {
  const rows: [number, number][] = [
    [0, 5],
    [1, 6],
    [1, 7],
    [2, 6],
    [3, 8],
    [3, 9],
    [3, 10],
    [6, 12],
    [7, 14],
  ];
  const view = stackModelView(handInput(rows), handWindow, handAsOf);

  test("観測のある区間だけを lo の昇順に並べる", () => {
    expect(view.bins.map((bin) => [bin.lo, bin.hi])).toEqual([
      [0, 1],
      [2, 3],
      [6, 7],
    ]);
  });

  test("件数と分位点（type 7）", () => {
    expect(view.bins).toHaveLength(3);
    const [a, b, c] = view.bins;
    expect(a.n).toBe(3);
    expect(a.p10).toBeCloseTo(5.2, 10);
    expect(a.median).toBeCloseTo(6, 10);
    expect(a.p90).toBeCloseTo(6.8, 10);
    expect(b.n).toBe(4);
    expect(b.p10).toBeCloseTo(6.6, 10);
    expect(b.median).toBeCloseTo(8.5, 10);
    expect(b.p90).toBeCloseTo(9.7, 10);
    expect(c.n).toBe(2);
    expect(c.p10).toBeCloseTo(12.2, 10);
    expect(c.median).toBeCloseTo(13, 10);
    expect(c.p90).toBeCloseTo(13.8, 10);
  });

  test("予測は区間の中央で求める", () => {
    expect(view.bins).toHaveLength(3);
    for (const bin of view.bins) {
      expect(bin.predictedFit).toBeNull();
      expect(bin.predictedFixed).toBe(predictReadyMinutes(bin.lo + 0.5));
    }
  });

  test("当てはめ済みなら区間の中央での当てはめの予測", () => {
    const view1300 = stackModelView(input1102, window1102, asOf1300);
    expect(view1300.bins.length).toBeGreaterThan(0);
    for (const bin of view1300.bins) {
      expect(bin.predictedFit).toBe(predictWithFit(view1300.fit, bin.lo + 0.5));
    }
    expect(view1300.bins.reduce((sum, bin) => sum + bin.n, 0)).toBe(154);
  });
});

describe("[unit] trendPointFromFit", () => {
  test("当てはめ済みなら係数を写す", () => {
    const fit: StackFit = {
      ok: true,
      a1: 7,
      b1: -0.5,
      c1: 6,
      nStaff: 6,
      b: 0.5,
      nObs: 120,
      iterations: 5,
      start: { a1: 5, b1: 0.1, c1: 2 },
      stackMin: 0,
      stackMax: 20,
    };
    expect(trendPointFromFit(fit, 1000, false)).toEqual({
      asOf: 1000,
      partial: false,
      nObs: 120,
      a1: 7,
      c1: 6,
      b: 0.5,
      reason: null,
    });
  });

  test("当てはめ不能なら係数は null で、理由を入れる", () => {
    expect(
      trendPointFromFit(
        { ok: false, reason: "insufficient", nObs: 12, needed: 20 },
        2000,
        true,
      ),
    ).toEqual({
      asOf: 2000,
      partial: true,
      nObs: 12,
      a1: null,
      c1: null,
      b: null,
      reason: "insufficient",
    });
    expect(
      trendPointFromFit(
        { ok: false, reason: "no-convergence", nObs: 40 },
        3000,
        false,
      ),
    ).toEqual({
      asOf: 3000,
      partial: false,
      nObs: 40,
      a1: null,
      c1: null,
      b: null,
      reason: "no-convergence",
    });
  });
});

describe("[unit] stackModelTrend", () => {
  const MINUTE = 60_000;

  test("13:00 時点・60 分ごと: 区切りの終わりの 13 点", () => {
    const trend = stackModelTrend(input1102, window1102, asOf1300, 60);
    expect(trend.map((p) => p.asOf)).toEqual(
      Array.from(
        { length: 13 },
        (_, k) => window1102.start + (k + 1) * 60 * MINUTE,
      ),
    );
    expect(trend.every((p) => p.partial === false)).toBe(true);
    const last = trend.at(-1);
    expect(last?.nObs).toBe(154);
    expect(sig3(last?.a1 ?? Number.NaN)).toBe(5.4);
    expect(sig3(last?.c1 ?? Number.NaN)).toBe(6.89);
    expect(sig3(last?.b ?? Number.NaN)).toBe(0.346);
  });

  test("13:10 時点・15 分ごと: 最後だけが途中の点で、係数の欄と一致する", () => {
    const asOf = Date.parse("2025-11-02T13:10:00+09:00");
    const window = dayWindow("2025-11-02", asOf);
    const trend = stackModelTrend(input1102, window, asOf, 15);
    expect(trend).toHaveLength(53);
    for (let i = 1; i < trend.length - 1; i++) {
      expect(trend[i].asOf - trend[i - 1].asOf).toBe(15 * MINUTE);
    }
    expect(trend.slice(0, -1).every((p) => p.partial === false)).toBe(true);
    const last = trend.at(-1);
    expect(last?.partial).toBe(true);
    expect(last?.asOf).toBe(asOf);
    expect(last).toEqual(
      trendPointFromFit(
        stackModelView(input1102, window, asOf).fit,
        asOf,
        true,
      ),
    );
  });

  test("各点は、その時点の当てはめと一致する（後の打刻を使わない）", () => {
    const asOf = Date.parse("2025-11-02T13:10:00+09:00");
    const window = dayWindow("2025-11-02", asOf);
    const trend = stackModelTrend(input1102, window, asOf, 15);
    expect(trend.length).toBeGreaterThan(0);
    for (const point of trend) {
      expect(point).toEqual(
        trendPointFromFit(
          stackModelView(input1102, window, point.asOf).fit,
          point.asOf,
          point.partial,
        ),
      );
    }
  });

  test("件数の足りない早い時刻の点は null で、理由は件数不足", () => {
    const trend = stackModelTrend(input1102, window1102, asOf1300, 60);
    expect(trend.length).toBeGreaterThan(0);
    expect(trend[0]).toMatchObject({
      a1: null,
      c1: null,
      b: null,
      reason: "insufficient",
    });
  });

  test("期間の開始ちょうどなら点は無い", () => {
    expect(
      stackModelTrend(input1102, window1102, window1102.start, 15),
    ).toEqual([]);
  });
});
