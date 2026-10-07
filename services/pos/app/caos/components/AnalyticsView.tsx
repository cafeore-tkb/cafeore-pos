import {
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  BarChart3,
  CheckCircle2,
  Clock3,
  Coffee,
  ShoppingCart,
  Target,
  Timer,
} from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import type { Barista, OrderTicket, SalesOrder } from "../types";
import { laneTitle } from "../utils/lanes";
import { SeniorMark } from "./LaneName";

interface AnalyticsViewProps {
  baristas: Barista[];
  /** 実データテストの練習の注文（準備完了は練習の中で付いた時刻） */
  salesOrders?: SalesOrder[];
  periodStartMs?: number;
  periodEndMs?: number;
}

interface CompletedPart {
  ticket: OrderTicket;
  bayNumber: number;
  finishedAt: number;
}

interface SplitResult {
  orderId: string;
  expectedParts: number;
  totalCups: number;
  deltaSec: number;
  firstFinishedAt: number;
  lastFinishedAt: number;
  bayNumbers: number[];
}

const formatClock = (seconds: number) => {
  const normalized = ((seconds % 86400) + 86400) % 86400;
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const secs = Math.floor(normalized % 60);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

const deltaStatus = (deltaSec: number) => {
  if (deltaSec <= 15)
    return {
      label: "良好",
      className: "bg-emerald-100 text-emerald-800 border-emerald-300",
    };
  if (deltaSec <= 30)
    return {
      label: "許容",
      className: "bg-amber-100 text-amber-900 border-amber-300",
    };
  return {
    label: "要確認",
    className: "bg-red-100 text-red-800 border-red-300",
  };
};

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  baristas,
  salesOrders = [],
  periodStartMs,
  periodEndMs,
}) => {
  const rebrewSummary = useMemo(() => {
    const history = baristas.flatMap((barista) => barista.pastTickets || []);
    const rebrews = history.filter(
      (ticket) => ticket.isRebrew && !ticket.isInterrupted,
    );
    const interrupted = history.filter((ticket) => ticket.isInterrupted);
    const rebrewCups = rebrews.reduce(
      (sum, ticket) => sum + ticket.cupCount,
      0,
    );
    // 入れ直しで余分に使った豆は CaOS では数えない（豆の在庫は POS の在庫で見る）
    return {
      rebrewCount: rebrews.length,
      rebrewCups,
      interruptedCount: interrupted.length,
    };
  }, [baristas]);
  const completedParts = useMemo<CompletedPart[]>(
    () =>
      baristas.flatMap((barista) =>
        (barista.pastTickets || []).flatMap((ticket) => {
          const finishedAt = ticket.completedAtSec ?? ticket.endTimeSec;
          return !ticket.isInterrupted &&
            !ticket.isRebrew &&
            ticket.totalItemsInOrder &&
            ticket.totalItemsInOrder > 1 &&
            finishedAt !== undefined
            ? [{ ticket, bayNumber: barista.bayNumber, finishedAt }]
            : [];
        }),
      ),
    [baristas],
  );

  const splitResults = useMemo<SplitResult[]>(() => {
    const groups = new Map<string, CompletedPart[]>();
    completedParts.forEach((part) => {
      const current = groups.get(part.ticket.id) || [];
      current.push(part);
      groups.set(part.ticket.id, current);
    });

    return Array.from(groups, ([orderId, parts]) => {
      const expectedParts = Math.max(
        ...parts.map((part) => part.ticket.totalItemsInOrder || 1),
      );
      if (parts.length < expectedParts) return null;
      const sorted = [...parts].sort((a, b) => a.finishedAt - b.finishedAt);
      const firstFinishedAt = sorted[0].finishedAt;
      const lastFinishedAt = sorted[sorted.length - 1].finishedAt;
      return {
        orderId,
        expectedParts,
        totalCups: Math.max(
          ...parts.map(
            (part) => part.ticket.totalOrderCups || part.ticket.cupCount,
          ),
        ),
        deltaSec: lastFinishedAt - firstFinishedAt,
        firstFinishedAt,
        lastFinishedAt,
        bayNumbers: [...new Set(parts.map((part) => part.bayNumber))].sort(
          (a, b) => a - b,
        ),
      };
    })
      .filter((result): result is SplitResult => result !== null)
      .sort((a, b) => b.lastFinishedAt - a.lastFinishedAt);
  }, [completedParts]);

  const pendingSplitOrders = useMemo(() => {
    const groups = new Map<
      string,
      { expected: number; assigned: number; bays: Set<number> }
    >();
    baristas.forEach((barista) => {
      barista.queue.forEach((ticket) => {
        if (!ticket.totalItemsInOrder || ticket.totalItemsInOrder <= 1) return;
        const current = groups.get(ticket.id) || {
          expected: ticket.totalItemsInOrder,
          assigned: 0,
          bays: new Set<number>(),
        };
        current.expected = Math.max(current.expected, ticket.totalItemsInOrder);
        current.assigned += 1;
        current.bays.add(barista.bayNumber);
        groups.set(ticket.id, current);
      });
    });
    return Array.from(groups, ([orderId, value]) => ({
      orderId,
      ...value,
      bays: [...value.bays].sort((a, b) => a - b),
    }));
  }, [baristas]);

  const averageDelta = splitResults.length
    ? Math.round(
        splitResults.reduce((sum, result) => sum + result.deltaSec, 0) /
          splitResults.length,
      )
    : null;
  const within15Count = splitResults.filter(
    (result) => result.deltaSec <= 15,
  ).length;
  const within15Rate = splitResults.length
    ? Math.round((within15Count / splitResults.length) * 100)
    : null;
  const maxDelta = splitResults.length
    ? Math.max(...splitResults.map((result) => result.deltaSec))
    : null;
  const sameLaneCount = splitResults.filter(
    (result) => result.bayNumbers.length === 1,
  ).length;

  const salesAnalysis = useMemo(() => {
    if (salesOrders.length === 0) return null;
    const menuMap = new Map<string, { cups: number; sales: number }>();
    const typeMap = new Map<string, number>();
    const bucketMap = new Map<
      number,
      { orders: number; sales: number; cups: number }
    >();
    const leadTimes: number[] = [];
    let cups = 0;
    salesOrders.forEach((order) => {
      const createdMs = new Date(order.createdAt).getTime();
      const bucket = Math.floor(createdMs / 600_000) * 600_000;
      const bucketValue = bucketMap.get(bucket) || {
        orders: 0,
        sales: 0,
        cups: 0,
      };
      bucketValue.orders += 1;
      bucketValue.sales += order.billingAmount;
      order.items.forEach((item) => {
        if (item.type === "others") return;
        cups += 1;
        bucketValue.cups += 1;
        const menu = menuMap.get(item.name) || { cups: 0, sales: 0 };
        menu.cups += 1;
        menu.sales += item.price;
        menuMap.set(item.name, menu);
        typeMap.set(item.type, (typeMap.get(item.type) || 0) + 1);
      });
      bucketMap.set(bucket, bucketValue);
      if (order.readyAt)
        leadTimes.push(
          (new Date(order.readyAt).getTime() - createdMs) / 60_000,
        );
    });
    const buckets = Array.from(bucketMap, ([time, value]) => ({
      time,
      ...value,
    })).sort((a, b) => a.time - b.time);
    const peak = [...buckets].sort(
      (a, b) => b.orders - a.orders || b.sales - a.sales,
    )[0];
    return {
      revenue: salesOrders.reduce((sum, order) => sum + order.billingAmount, 0),
      orderCount: salesOrders.length,
      cups,
      averageOrder: Math.round(
        salesOrders.reduce((sum, order) => sum + order.billingAmount, 0) /
          salesOrders.length,
      ),
      averageLeadMinutes: leadTimes.length
        ? leadTimes.reduce((sum, value) => sum + value, 0) / leadTimes.length
        : null,
      menuRanking: Array.from(menuMap, ([name, value]) => ({ name, ...value }))
        .sort((a, b) => b.cups - a.cups)
        .slice(0, 8),
      typeMix: Array.from(typeMap, ([type, count]) => ({ type, count })).sort(
        (a, b) => b.count - a.count,
      ),
      buckets,
      peak,
    };
  }, [salesOrders]);

  const baristaResults = useMemo(
    () =>
      baristas.map((barista) => {
        const completed = barista.pastTickets || [];
        const durations = completed.flatMap((ticket) =>
          ticket.startTimeSec !== undefined && ticket.endTimeSec !== undefined
            ? [Math.max(0, ticket.endTimeSec - ticket.startTimeSec)]
            : [],
        );
        return {
          bayNumber: barista.bayNumber,
          name: barista.name,
          cups: completed.reduce((sum, ticket) => sum + ticket.cupCount, 0),
          drips: completed.length,
          averageSec: durations.length
            ? Math.round(
                durations.reduce((sum, duration) => sum + duration, 0) /
                  durations.length,
              )
            : null,
          // 上級生（限定を淹れられる）か。サーバーの列の担当者の判定
          senior: barista.senior,
        };
      }),
    [baristas],
  );

  const typeLabel = (type: string) =>
    type === "hot"
      ? "ホット"
      : type === "iceOre"
        ? "アイスオレ"
        : type === "ice"
          ? "アイス"
          : type === "milk"
            ? "ミルク"
            : type;
  // 時刻は日本時間で出す（端末の時刻帯によらない。盤面の時計と同じ）
  const formatBucket = (timestamp: number) =>
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(timestamp));

  return (
    <div className="space-y-3">
      <div className="border-slate-200 border-b pb-3">
        <h2 className="flex items-center gap-2 font-black text-[18px] text-slate-950">
          <BarChart3 className="h-5 w-5 text-blue-700" />
          割り当て品質
        </h2>
        <p className="mt-1 font-medium text-[12px] text-slate-500">
          分割オーダーを、どれだけ同時に仕上げられたか
        </p>
      </div>

      {salesAnalysis && (
        <>
          <section className="rounded-xl border border-slate-300 bg-white p-3 shadow-xs">
            <div className="flex items-center justify-between gap-2 border-slate-200 border-b pb-2">
              <div>
                <h3 className="flex items-center gap-2 font-black text-[16px] text-slate-950">
                  <Banknote className="h-5 w-5 text-emerald-700" />
                  店舗売上
                </h3>
                {periodStartMs && periodEndMs && (
                  <p className="mt-0.5 font-bold text-[11px] text-slate-500">
                    {formatBucket(periodStartMs)}〜{formatBucket(periodEndMs)}{" "}
                    の実績データ（完成は練習の結果）
                  </p>
                )}
              </div>
              <span className="font-black font-mono text-[24px] text-emerald-800">
                ¥{salesAnalysis.revenue.toLocaleString()}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="flex items-center gap-1 font-bold text-[10px] text-slate-500">
                  <ShoppingCart className="h-3.5 w-3.5" />
                  注文
                </div>
                <div className="font-black font-mono text-[22px]">
                  {salesAnalysis.orderCount}
                  <span className="text-[11px]">件</span>
                </div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="flex items-center gap-1 font-bold text-[10px] text-slate-500">
                  <Coffee className="h-3.5 w-3.5" />
                  ドリンク
                </div>
                <div className="font-black font-mono text-[22px]">
                  {salesAnalysis.cups}
                  <span className="text-[11px]">杯</span>
                </div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="font-bold text-[10px] text-slate-500">
                  客単価
                </div>
                <div className="font-black font-mono text-[22px]">
                  ¥{salesAnalysis.averageOrder.toLocaleString()}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between font-bold text-[11px] text-slate-600">
                <span>10分ごとの注文数</span>
                {salesAnalysis.peak && (
                  <span>
                    ピーク {formatBucket(salesAnalysis.peak.time)}・
                    {salesAnalysis.peak.orders}件
                  </span>
                )}
              </div>
              <div className="flex h-[92px] items-end gap-1 rounded-lg bg-slate-50 p-2">
                {salesAnalysis.buckets.map((bucket) => {
                  const maxOrders = Math.max(
                    ...salesAnalysis.buckets.map((item) => item.orders),
                    1,
                  );
                  return (
                    <div
                      key={bucket.time}
                      className="group relative flex min-w-0 flex-1 flex-col items-center justify-end"
                    >
                      <div
                        className="w-full rounded-t bg-blue-600"
                        style={{
                          height: `${Math.max(5, (bucket.orders / maxOrders) * 64)}px`,
                        }}
                        title={`${formatBucket(bucket.time)} ${bucket.orders}件 / ¥${bucket.sales.toLocaleString()}`}
                      />
                      {salesAnalysis.buckets.length <= 8 && (
                        <span className="mt-1 font-mono text-[8px] text-slate-500">
                          {formatBucket(bucket.time)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-300 bg-white p-3 shadow-xs">
            <h3 className="font-black text-[15px] text-slate-950">
              商品・オペレーション分析
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 font-bold text-[11px] text-slate-500">
                  商品ランキング
                </div>
                <div className="space-y-1">
                  {salesAnalysis.menuRanking.map((menu, index) => (
                    <div
                      key={menu.name}
                      className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1.5 text-[11px]"
                    >
                      <span className="w-4 font-black font-mono text-slate-400">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-bold">
                        {menu.name}
                      </span>
                      <span className="font-black font-mono">
                        {menu.cups}杯
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 font-bold text-[11px] text-slate-500">
                  提供構成
                </div>
                <div className="space-y-1.5">
                  {salesAnalysis.typeMix.map((item) => (
                    <div key={item.type}>
                      <div className="flex justify-between font-bold text-[11px]">
                        <span>{typeLabel(item.type)}</span>
                        <span>{item.count}杯</span>
                      </div>
                      <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-slate-800"
                          style={{
                            width: `${(item.count / Math.max(salesAnalysis.cups, 1)) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="mt-3 rounded-lg bg-blue-50 p-2 font-bold text-[11px] text-blue-950">
                    <Timer className="mr-1 inline h-3.5 w-3.5" />
                    注文→完成 平均{" "}
                    {salesAnalysis.averageLeadMinutes === null
                      ? "—"
                      : `${salesAnalysis.averageLeadMinutes.toFixed(1)}分`}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {(rebrewSummary.rebrewCount > 0 ||
        rebrewSummary.interruptedCount > 0) && (
        <section className="rounded-xl border border-red-200 bg-red-50 p-3 shadow-xs">
          <h3 className="flex items-center gap-2 font-black text-[15px] text-red-900">
            <AlertTriangle className="h-4 w-4" />
            緊急入れ直し
          </h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-red-100 bg-white p-2">
              <div className="font-bold text-[10px] text-slate-500">
                完了した入れ直し
              </div>
              <div className="font-black font-mono text-[22px] text-red-700">
                {rebrewSummary.rebrewCount}
                <span className="text-[11px]">
                  件 / {rebrewSummary.rebrewCups}杯
                </span>
              </div>
            </div>
            <div className="rounded-lg border border-red-100 bg-white p-2">
              <div className="font-bold text-[10px] text-slate-500">中断</div>
              <div className="font-black font-mono text-[22px] text-red-700">
                {rebrewSummary.interruptedCount}
                <span className="text-[11px]">件</span>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-300 bg-white p-3 shadow-xs">
          <div className="flex items-center gap-1.5 font-bold text-[11px] text-slate-500">
            <Clock3 className="h-4 w-4 text-blue-700" />
            平均仕上がりΔ
          </div>
          <div className="mt-1 font-black font-mono text-[30px] text-slate-950">
            {averageDelta === null ? "—" : `${averageDelta}秒`}
          </div>
        </div>
        <div className="rounded-xl border border-slate-300 bg-white p-3 shadow-xs">
          <div className="flex items-center gap-1.5 font-bold text-[11px] text-slate-500">
            <Target className="h-4 w-4 text-emerald-700" />
            15秒以内率
          </div>
          <div className="mt-1 font-black font-mono text-[30px] text-slate-950">
            {within15Rate === null ? "—" : `${within15Rate}%`}
          </div>
        </div>
        <div className="rounded-xl border border-slate-300 bg-white p-3 shadow-xs">
          <div className="flex items-center gap-1.5 font-bold text-[11px] text-slate-500">
            <CheckCircle2 className="h-4 w-4 text-indigo-700" />
            分析済み
          </div>
          <div className="mt-1 font-black font-mono text-[30px] text-slate-950">
            {splitResults.length}
            <span className="ml-1 text-[13px] text-slate-500">オーダー</span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-300 bg-white p-3 shadow-xs">
          <div className="flex items-center gap-1.5 font-bold text-[11px] text-slate-500">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            最大Δ
          </div>
          <div className="mt-1 font-black font-mono text-[30px] text-slate-950">
            {maxDelta === null ? "—" : `${maxDelta}秒`}
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-slate-300 bg-white p-3 shadow-xs">
        <div className="flex items-center justify-between gap-2 border-slate-200 border-b pb-2">
          <div>
            <h3 className="font-black text-[15px] text-slate-950">
              分割オーダー別 仕上がりΔ
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              最初と最後のカップが仕上がった時刻差
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 font-bold text-[11px] text-slate-600">
            目標 ≤ 15秒
          </span>
        </div>

        {splitResults.length > 0 ? (
          <div className="mt-2 space-y-2">
            {splitResults.slice(0, 12).map((result) => {
              const status = deltaStatus(result.deltaSec);
              return (
                <article
                  key={result.orderId}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-black font-mono text-[22px] text-slate-950">
                      {result.orderId}
                    </span>
                    <span className="font-bold text-[11px] text-slate-500">
                      計{result.totalCups}杯・{result.expectedParts}分割
                    </span>
                    <span
                      className={`ml-auto rounded border px-2 py-0.5 font-black text-[11px] ${status.className}`}
                    >
                      {status.label}
                    </span>
                    <span className="min-w-[54px] text-right font-black font-mono text-[20px] text-slate-950">
                      Δ{result.deltaSec}秒
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full ${result.deltaSec <= 15 ? "bg-emerald-600" : result.deltaSec <= 30 ? "bg-amber-500" : "bg-red-600"}`}
                      style={{
                        width: `${Math.min(100, Math.max(5, (result.deltaSec / 60) * 100))}%`,
                      }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 font-bold text-[11px] text-slate-600">
                    <span>
                      レーン{" "}
                      {result.bayNumbers.map((bay) => `#${bay}`).join(" + ")}
                    </span>
                    <span className="font-mono">
                      {formatClock(result.firstFinishedAt)} →{" "}
                      {formatClock(result.lastFinishedAt)}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-slate-300 border-dashed bg-slate-50 px-4 py-8 text-center">
            <div className="font-black text-[14px] text-slate-700">
              まだ分析できる完了データがありません
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              分割された全カードを「次へ」で完了すると、仕上がりΔを自動集計します。
            </p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-300 bg-white p-3 shadow-xs">
        <h3 className="flex items-center gap-2 font-black text-[15px] text-slate-950">
          <ArrowRightLeft className="h-4 w-4 text-blue-700" />
          割り当て結果の読み取り
        </h3>
        <div className="mt-2 space-y-2 text-[12px]">
          {splitResults.length === 0 ? (
            <p className="rounded-lg bg-blue-50 p-3 font-bold text-blue-900">
              評価待ちです。分割カードを別レーンへ割り当て、仕上がりΔが15秒以内になるか確認できます。
            </p>
          ) : (
            <>
              <p
                className={`rounded-lg p-3 font-bold ${averageDelta !== null && averageDelta <= 15 ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}
              >
                平均Δは {averageDelta}秒。
                {averageDelta !== null && averageDelta <= 15
                  ? "割り当てタイミングは良好です。"
                  : "開始時刻または割り当て先の待ち時間を見直す余地があります。"}
              </p>
              {maxDelta !== null && maxDelta > 30 && (
                <p className="rounded-lg bg-red-50 p-3 font-bold text-red-900">
                  最大Δが30秒を超えています。該当オーダーのレーン組み合わせを上の一覧で確認してください。
                </p>
              )}
              {sameLaneCount > 0 && (
                <p className="rounded-lg bg-amber-50 p-3 font-bold text-amber-950">
                  {sameLaneCount}
                  件が同じレーン内で分割されています。同時仕上げを狙う場合は別レーンへの分散が有効です。
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-300 bg-white p-3 shadow-xs">
        <div className="border-slate-200 border-b pb-2">
          <h3 className="font-black text-[15px] text-slate-950">
            バリスタ別 テストプレイ結果
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            個人の優劣ではなく、割り当て後の担当量と偏りを確認
          </p>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {baristaResults.map((result) => (
            <div
              key={result.bayNumber}
              className="rounded-lg border border-slate-200 bg-slate-50 p-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-black text-slate-950">
                  {laneTitle(result)}
                </span>
                {result.senior && <SeniorMark />}
              </div>
              <div className="mt-2 flex items-end gap-3">
                <span className="font-black font-mono text-[23px]">
                  {result.cups}
                  <small className="ml-0.5 text-[10px]">杯</small>
                </span>
                <span className="pb-1 font-bold text-[10px] text-slate-500">
                  {result.drips}ドリップ
                </span>
                <span className="ml-auto pb-1 font-bold font-mono text-[10px] text-slate-600">
                  平均{" "}
                  {result.averageSec === null ? "—" : `${result.averageSec}秒`}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {pendingSplitOrders.length > 0 && (
        <section className="rounded-xl border border-slate-300 bg-white p-3 shadow-xs">
          <h3 className="font-black text-[14px] text-slate-950">
            評価待ちの分割オーダー
          </h3>
          <div className="mt-2 space-y-1.5">
            {pendingSplitOrders.map((order) => (
              <div
                key={order.orderId}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 font-bold text-[11px] text-slate-600"
              >
                <span className="font-black font-mono text-[16px] text-slate-900">
                  {order.orderId}
                </span>
                <span>
                  {order.assigned}/{order.expected}カード割当済み
                </span>
                <span>
                  レーン {order.bays.map((bay) => `#${bay}`).join(" + ")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
