import { describe, expect, test } from "vitest";
import { availabilityComparison, availabilitySchema } from "./availability";
import { evidenceRows, reviewEvidence } from "./evidence";
import { flowCsv } from "./flowCsv";
import { historicalOrders, load2025Baseline } from "./historical";
import {
  type AnalysisOrder,
  QUARTER_MS,
  dayWindow,
  distribution,
  operationsReport,
} from "./operations";

const T = Date.parse("2026-11-01T09:00:00+09:00");
const order = (
  id: string,
  created: number,
  cups: AnalysisOrder["cups"],
  cancelled: number | null = null,
): AnalysisOrder => ({
  id,
  number: Number(id),
  created,
  cancelled,
  revenue: 500,
  cups,
  comments: [],
});
const cup = (
  id: string,
  ready: number | null = null,
  served: number | null = null,
) => ({ id, product: "ブレンド", ready, served, orderTiming: false });
const window = { start: T, end: T + 4 * QUARTER_MS, now: T + 4 * QUARTER_MS };
describe("unit operations analytics", () => {
  test("15分境界で受注と提供を別々の枠に計上し、空の枠も残す", () => {
    const r = operationsReport(
      [
        order("1", T, [cup("a", T + 60_000, T + QUARTER_MS)]),
        order("2", T + QUARTER_MS, [cup("b")]),
      ],
      window,
    );
    expect(r.buckets.map((b) => [b.received, b.served, b.backlog])).toEqual([
      [1, 0, 1],
      [1, 1, 1],
      [0, 0, 1],
      [0, 0, 1],
    ]);
    expect(r.buckets.map((b) => b.acceleration)).toEqual([null, -1, 0, 0]);
  });
  test("部分提供とキャンセルは残っていた杯だけを減らす。売上は取り消す", () => {
    const r = operationsReport(
      [order("1", T, [cup("a", T + 1, T + 2), cup("b")], T + QUARTER_MS)],
      window,
    );
    expect(r.received).toBe(2);
    expect(r.served).toBe(1);
    expect(r.cancelledCups).toBe(1);
    expect(r.backlog).toBe(0);
    expect(r.revenue).toBe(0);
  });
  test("まだ起きていないキャンセル・提供を使わない", () => {
    const r = operationsReport(
      [order("1", T, [cup("a", T + 3_000_000, T + 3_100_000)], T + 3_200_000)],
      { ...window, now: T + QUARTER_MS },
    );
    expect(r.backlog).toBe(1);
    expect(r.revenue).toBe(500);
    expect(r.total.count).toBe(0);
  });
  test("前日からの持越しと当日の受注コホートを混同しない", () => {
    const r = operationsReport(
      [order("1", T - 60_000, [cup("a", T, T + 1)]), order("2", T, [cup("b")])],
      window,
    );
    expect(r.openingBacklog).toBe(1);
    expect(r.received).toBe(1);
    expect(r.served).toBe(1);
    expect(r.backlog).toBe(1);
    expect(r.orderCount).toBe(1);
  });
  test("準備完了だけでは未提供を減らさず未提供は分布の0分にしない", () => {
    const r = operationsReport(
      [
        order("1", T, [
          cup("a", T + 60_000),
          cup("b", T + 60_000, T + 120_000),
        ]),
      ],
      window,
    );
    expect(r.pending).toBe(1);
    expect(r.censored).toBe(1);
    expect(r.backlog).toBe(1);
    expect(r.total.count).toBe(1);
    expect(r.total.p50).toBe(2);
    expect(r.products[0].prep.count).toBe(2);
    expect(r.products[0].handoff.p50).toBe(1);
  });
  test("不完全な枠の加速度を確定枠と比較しない", () => {
    const r = operationsReport([order("1", T, [cup("a")])], {
      ...window,
      now: T + QUARTER_MS + 1,
    });
    expect(r.buckets).toHaveLength(2);
    expect(r.buckets[1].complete).toBe(false);
    expect(r.buckets[1].acceleration).toBeNull();
    expect(r.latest?.at).toBe(T);
  });
  test("重複注文を除き、グッズ注文の売上は残し杯数に加えない", () => {
    const a = order("1", T, [cup("a")]);
    const r = operationsReport([a, a, order("2", T, [])], window);
    expect(r.received).toBe(1);
    expect(r.revenue).toBe(1000);
    expect(r.orderCount).toBe(2);
  });
  test("時刻逆転を検知し負の時間を集計しない", () => {
    const r = operationsReport(
      [order("1", T, [cup("a", T - 1, T - 1)])],
      window,
    );
    expect(r.invalidTimes).toBe(1);
    expect(r.total.count).toBe(0);
    expect(r.products[0].prep.count).toBe(0);
  });
  test("JSTの日付境界と終了時刻の排他", () => {
    const w = dayWindow("2026-11-01", Date.parse("2026-11-02T00:10:00+09:00"));
    expect(w.start).toBe(Date.parse("2026-10-31T15:00:00Z"));
    const r = operationsReport(
      [order("1", w.start, [cup("a")]), order("2", w.end, [cup("b")])],
      w,
    );
    expect(r.received).toBe(1);
    expect(r.backlog).toBe(1);
  });
  test("分位点、ヒストグラム、同値CDF、外れ値を整合させる", () => {
    const d = distribution([1, 1, 2, 3, 100, -1, Number.NaN]);
    expect(d.count).toBe(5);
    expect(d.p50).toBe(2);
    expect(d.q1).toBe(1);
    expect(d.q3).toBe(3);
    expect(d.outliers).toEqual([100]);
    expect(d.max).toBe(3);
    expect(d.histogram.reduce((n, b) => n + b.count, 0)).toBe(5);
    expect(d.cdf.at(-1)?.percent).toBe(100);
    expect(d.cdf[0].percent).toBe(40);
    expect(distribution([]).p90).toBeNull();
  });
  test("全枠で受注−提供−取消の保存則が成り立つ", () => {
    const input = Array.from({ length: 80 }, (_, i) => {
      const created = T + (i % 30) * 60_000;
      return order(
        String(i),
        created,
        [
          cup(
            String(i),
            created + 60_000,
            i % 3 === 0 ? created + 120_000 : null,
          ),
        ],
        i % 5 === 0 ? created + 180_000 : null,
      );
    });
    const r = operationsReport(input, window);
    let expected = 0;
    for (const bucket of r.buckets) {
      expected += bucket.received - bucket.served - bucket.cancelled;
      expect(bucket.backlog).toBe(expected);
      expect(bucket.backlog).toBeGreaterThanOrEqual(0);
    }
  });
  test("販売可否の変更は時間加重。最初の記録前は未計測", () => {
    const buckets = operationsReport([], window).buckets;
    const rows = availabilityComparison(
      [
        { at: new Date(T + QUARTER_MS / 2).toISOString(), availableMenus: 8 },
        {
          at: new Date(T + QUARTER_MS + QUARTER_MS / 2).toISOString(),
          availableMenus: 4,
        },
      ],
      buckets,
    );
    expect(rows[0].availableMenus).toBeNull();
    expect(rows[1].availableMenus).toBe(6);
    expect(rows[2].availableMenus).toBe(4);
    expect(
      availabilitySchema.safeParse([{ at: "invalid", availableMenus: -1 }])
        .success,
    ).toBe(false);
  });
  test("端末の再送とサーバーの成功履歴を分離し練習を除く", () => {
    const e = {
      tabId: "tab",
      sequence: 1,
      at: new Date(T).toISOString(),
      event: "ui.click",
      details: { page: "/master-sheet" },
    };
    const rows = evidenceRows(
      [
        e,
        e,
        { ...e, sequence: 2, event: "operation.rejected" },
        { ...e, sequence: 3, event: "practice.operation.succeeded" },
      ],
      [
        {
          id: "op",
          kind: "board.place",
          occurred_at: new Date(T).toISOString(),
        },
      ],
      T,
      T + QUARTER_MS,
    );
    expect(rows).toHaveLength(3);
    expect(reviewEvidence(rows)).toHaveLength(2);
    expect(
      reviewEvidence(rows).filter((r) => r.source === "server"),
    ).toHaveLength(1);
  });
  test("2025年は注文打刻の代理値として扱い、個人情報を取り込まない", () => {
    const [value] = historicalOrders({
      orders: [
        {
          orderId: 1,
          createdAt: "2025-11-02T00:00:00Z",
          billingAmount: 1000,
          items: [
            { name: "hot", type: "hot" },
            { name: "goods", type: "others" },
          ],
          comments: [{ text: "personal" }],
        },
      ],
    });
    expect(value.cups).toHaveLength(1);
    expect(value.cups[0].orderTiming).toBe(true);
    expect(value.comments).toEqual([]);
    expect(() =>
      historicalOrders({
        orders: [
          {
            orderId: 1,
            createdAt: "2026-11-02T00:00:00Z",
            items: [{ name: "a", type: "hot" }],
          },
        ],
      }),
    ).toThrow();
  });
  test("過去データの請求額欠損・不正日時・未知の商品種別を黙って0にしない", () => {
    const row = {
      orderId: 1,
      createdAt: "2025-11-02T00:00:00Z",
      billingAmount: 500,
      items: [{ name: "test", type: "hot" }],
    };
    expect(() =>
      historicalOrders({ orders: [{ ...row, billingAmount: undefined }] }),
    ).toThrow();
    expect(() =>
      historicalOrders({ orders: [{ ...row, servedAt: "bad" }] }),
    ).toThrow();
    expect(() =>
      historicalOrders({
        orders: [{ ...row, items: [{ name: "test", type: "unknown" }] }],
      }),
    ).toThrow();
  });
  test("公開2025実データの978注文・1494杯・694700円に一致する", async () => {
    const baseline = await load2025Baseline();
    expect(baseline.orders).toHaveLength(978);
    expect(baseline.orders.reduce((n, o) => n + o.revenue, 0)).toBe(694700);
    expect(baseline.orders.reduce((n, o) => n + o.cups.length, 0)).toBe(1494);
    const reports = ["2025-11-02", "2025-11-03"].map((day) =>
      operationsReport(
        baseline.orders,
        dayWindow(day, Date.parse("2025-11-04T00:00:00+09:00")),
      ),
    );
    expect(reports.map((r) => r.orderCount)).toEqual([512, 466]);
    expect(reports.reduce((n, r) => n + r.received, 0)).toBe(1494);
    for (const report of reports) {
      expect(report.total.count).toBe(report.received);
      expect(report.backlog).toBe(0);
      expect(report.total.cdf.at(-1)?.percent).toBe(100);
    }
  });
});

describe("unit 可変の集計間隔", () => {
  test.each([5, 60] as const)(
    "%i分境界で注文・提供を分け、終端を含めず空枠も残す",
    (minutes) => {
      const width = minutes * 60000;
      const end = T + 3 * width;
      const report = operationsReport(
        [
          order("1", T, [cup("a", T + 1, T + width)]),
          order("2", T + width, [cup("b")]),
          order("3", end, [cup("excluded")]),
        ],
        { start: T, end, now: end },
        minutes,
      );
      expect(report.intervalMinutes).toBe(minutes);
      expect(
        report.buckets.map((b) => [
          b.at,
          b.received,
          b.served,
          b.backlog,
          b.complete,
        ]),
      ).toEqual([
        [T, 1, 0, 1, true],
        [T + width, 1, 1, 1, true],
        [T + 2 * width, 0, 0, 1, true],
      ]);
      expect(report.buckets.map((b) => b.acceleration)).toEqual([null, -1, 0]);
      expect(report.received).toBe(2);
      expect(report.served).toBe(1);
    },
  );

  test.each([5, 60] as const)(
    "%i分枠と揃わない開始でも持越し・提供・取消を欠落させない",
    (minutes) => {
      const width = minutes * 60000;
      const start = T + 7 * 60000 + 123;
      const end = start + 2 * width;
      const report = operationsReport(
        [
          order("1", start - 1, [cup("carry", start, start + 1)]),
          order("2", start, [cup("a", start + 1, start + width)]),
          order("3", start + width, [cup("b")], start + width + 1),
          order("4", end, [cup("excluded")]),
        ],
        { start, end, now: end },
        minutes,
      );
      expect(report.openingBacklog).toBe(1);
      expect(
        report.buckets.map((b) => [
          b.at,
          b.received,
          b.served,
          b.cancelled,
          b.backlog,
        ]),
      ).toEqual([
        [start, 1, 1, 0, 1],
        [start + width, 1, 1, 1, 0],
      ]);
      expect(report.received).toBe(2);
      expect(report.served).toBe(2);
      expect(report.cancelledCups).toBe(1);
      expect(report.backlog).toBe(0);
    },
  );

  test.each([5, 60] as const)(
    "%i分でも未完了の枠は前枠との差から除く",
    (minutes) => {
      const width = minutes * 60000;
      const report = operationsReport(
        [order("1", T, [cup("a", T + 1, T + width + 1)])],
        {
          start: T,
          end: T + 3 * width,
          now: T + 1.5 * width,
        },
        minutes,
      );
      expect(
        report.buckets.map((b) => [b.served, b.complete, b.acceleration]),
      ).toEqual([
        [0, true, null],
        [1, false, null],
      ]);
      expect(report.latest?.at).toBe(T);
    },
  );

  test.each([5, 60] as const)(
    "販売可能数も%i分幅で時間加重し、境界・未計測・途中枠を区別する",
    (minutes) => {
      const width = minutes * 60000;
      const start = T + 7 * 60000 + 123;
      const buckets = operationsReport(
        [],
        { start, end: start + 3 * width, now: start + 2.5 * width },
        minutes,
      ).buckets;
      const observations = [
        { at: new Date(start).toISOString(), availableMenus: 8 },
        { at: new Date(start + width / 2).toISOString(), availableMenus: 4 },
        { at: new Date(start + width).toISOString(), availableMenus: 6 },
        { at: new Date(start + 1.5 * width).toISOString(), availableMenus: 2 },
      ];
      const compared = availabilityComparison(observations, buckets, minutes);
      expect(compared.map((b) => [b.at, b.availableMenus])).toEqual([
        [start, 6],
        [start + width, 4],
      ]);
      expect(
        availabilityComparison(observations.slice(1), buckets, minutes).map(
          (b) => b.availableMenus,
        ),
      ).toEqual([null, 4]);
    },
  );
});

test("unit CSVの既存8列を保ち、集計間隔だけ末尾に追加する", () => {
  const csv = flowCsv(
    [
      {
        at: T,
        received: 3,
        served: 1,
        backlog: 5,
        cancelled: 1,
        net: 1,
        acceleration: null,
        complete: false,
      },
    ],
    60,
  );
  const [header, row] = csv.split("\n").map((line) => line.split(","));
  expect(header.slice(0, 8)).toEqual([
    "日時(JST)",
    "受注杯数",
    "提供杯数",
    "未提供杯数",
    "キャンセル未提供杯数",
    "未提供増減",
    "混み合い加速度",
    "枠確定",
  ]);
  expect(row.slice(1, 8)).toEqual(["3", "1", "5", "1", "1", "", "途中"]);
  expect(header).toHaveLength(9);
  expect(row).toHaveLength(9);
  expect(header.at(-1)).toBe("集計間隔(分)");
  expect(row.at(-1)).toBe("60");
});

describe("時間帯ごとの提供時間", () => {
  test.each([5, 15, 60] as const)(
    "%i分枠ごとに受付時刻でまとめ、平均・中央値・実際の最大最小を出す",
    (interval) => {
      const step = interval * 60000;
      const start = T + 2 * 60000;
      const inputs = [
        order("1", start, [
          cup("a", null, start + 60000),
          cup("b", null, start + 3 * 60000),
          cup("c", null, start + 100 * 60000),
        ]),
        order("2", start + step, [cup("d", null, start + step + 10 * 60000)]),
      ];
      const report = operationsReport(
        inputs,
        { start, end: start + 4 * step, now: start + 4 * step },
        interval,
      );
      const first = report.durationBuckets[0];
      // 5分・15分の期間末を越える100分の杯は、まだ観測できない。
      const expected = interval === 60 ? [1, 3, 100] : [1, 3];
      expect(first.at).toBe(start);
      expect(first.count).toBe(expected.length);
      expect(first.mean).toBe(
        expected.reduce((a, b) => a + b, 0) / expected.length,
      );
      expect(first.median).toBe(interval === 60 ? 3 : 2);
      expect(first.min).toBe(1);
      expect(first.max).toBe(interval === 60 ? 100 : 3);
      expect(report.durationBuckets[1].mean).toBe(10);
      expect(report.durationBuckets[2]).toMatchObject({
        count: 0,
        mean: null,
        median: null,
        min: null,
        max: null,
      });
    },
  );
  test("未提供・逆転時刻・取消を除き、0分は有効。期間末と現在を越える提供は含めない", () => {
    const report = operationsReport(
      [
        order("1", T, [
          cup("zero", null, T),
          cup("pending"),
          cup("invalid", null, T - 1),
          cup("future", null, T + 15 * 60000),
        ]),
        order("2", T, [cup("cancelled", null, T + 60000)], T + 2 * 60000),
      ],
      { start: T, end: T + 30 * 60000, now: T + 15 * 60000 },
      15,
    );
    expect(report.durationBuckets).toEqual([
      { at: T, complete: true, count: 1, mean: 0, median: 0, min: 0, max: 0 },
    ]);
  });
});

describe("今年の抽出開始時刻による区間分析", () => {
  test("受付→開始、開始→提供を同じ受付枠に各杯で集計する", () => {
    const r = operationsReport(
      [
        order("1", T, [
          { ...cup("a", null, T + 10 * 60000), brewStarted: T + 4 * 60000 },
          { ...cup("b"), brewStarted: T + 6 * 60000 },
        ]),
      ],
      window,
      15,
    );
    expect(r.startWaitBuckets[0]).toMatchObject({
      count: 2,
      mean: 5,
      median: 5,
      min: 4,
      max: 6,
    });
    expect(r.brewServeBuckets[0]).toMatchObject({
      count: 1,
      mean: 6,
      median: 6,
      min: 6,
      max: 6,
    });
    expect(r.startWaitBuckets[1]).toMatchObject({ count: 0, mean: null });
  });
  test("2025年の開始未計測と、不正・未来の開始を含めない", () => {
    const r = operationsReport(
      [
        order("1", T, [
          cup("legacy", null, T + 10 * 60000),
          { ...cup("invalid", null, T + 10 * 60000), brewStarted: T - 1 },
          { ...cup("future"), brewStarted: window.end },
        ]),
      ],
      window,
    );
    expect(r.startWaitBuckets.every((b) => b.count === 0)).toBe(true);
    expect(r.brewServeBuckets.every((b) => b.count === 0)).toBe(true);
  });
  test("開始より前の提供は除外し、ゼロ分は有効。取消も除外する", () => {
    const r = operationsReport(
      [
        order("1", T, [
          { ...cup("zero", null, T), brewStarted: T },
          { ...cup("backwards", null, T + 60000), brewStarted: T + 2 * 60000 },
        ]),
        order(
          "2",
          T,
          [
            {
              ...cup("cancelled", null, T + 10 * 60000),
              brewStarted: T + 2 * 60000,
            },
          ],
          T + 12 * 60000,
        ),
      ],
      window,
    );
    expect(r.brewServeBuckets[0]).toMatchObject({
      count: 1,
      mean: 0,
      min: 0,
      max: 0,
    });
  });
});
