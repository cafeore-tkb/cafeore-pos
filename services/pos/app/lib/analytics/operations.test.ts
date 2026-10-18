import { describe, expect, test } from "vitest";
import { availabilityComparison, availabilitySchema } from "./availability";
import { evidenceRows, reviewEvidence } from "./evidence";
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
