import { jstClock, jstDate } from "@cafeore/common";
import {
  Activity,
  Archive,
  Banknote,
  BarChart3,
  CheckCheck,
  Coffee,
  History,
  LayoutDashboard,
  type LucideIcon,
  MessageSquareText,
  Timer,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { flowCsv } from "~/lib/analytics/flowCsv";
import { historicalOrders, load2025Baseline } from "~/lib/analytics/historical";
import {
  type AnalysisOrder,
  type BucketMinutes,
  type TimeWindow,
  dayWindow,
  liveAnalysisOrders,
  operationsReport,
} from "~/lib/analytics/operations";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";
import { AvailabilityReview } from "./AvailabilityReview";
import { DurationCharts, minutes } from "./DurationCharts";
import { DurationTrend } from "./DurationTrend";
import { FlowCharts } from "./FlowCharts";
import { LogReview } from "./LogReview";
import { OverviewVisuals, ProductTimeChart } from "./OverviewVisuals";
import { PeriodFilter } from "./PeriodFilter";

const MODES = [
  { id: "floor", name: "現場を見る" },
  { id: "owner", name: "全体を見る" },
  { id: "handoff", name: "引き継ぎ" },
  { id: "inventory", name: "在庫を見る" },
  { id: "review", name: "振り返り" },
] as const;
type Mode = (typeof MODES)[number]["id"];
const money = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
const signed = (n: number | null) =>
  n === null ? "比較待ち" : `${n > 0 ? "+" : ""}${n}`;

const VIEWS = [
  { id: "summary", name: "ひと目でわかる" },
  { id: "flow", name: "注文とお渡し" },
  { id: "acceleration", name: "混み具合の変化" },
  { id: "duration", name: "提供時間" },
  { id: "availability", name: "在庫とメニュー" },
  { id: "logs", name: "連絡と操作の記録" },
  { id: "baseline", name: "2025年との比較" },
] as const;
const VIEW_ICONS: Record<string, LucideIcon> = {
  summary: LayoutDashboard,
  flow: Coffee,
  acceleration: Activity,
  duration: Timer,
  availability: Archive,
  logs: MessageSquareText,
  baseline: History,
};
const SHORT_NAMES: Record<string, string> = {
  summary: "概要",
  flow: "流れ",
  acceleration: "混雑",
  duration: "時間",
  availability: "在庫",
  logs: "記録",
  baseline: "昨年",
};
export type DashboardPanel = { id: string; name: string; content: ReactNode };

export function OperationsDashboard({
  compact = false,
  additionalPanels,
}: {
  compact?: boolean;
  additionalPanels?: (window: TimeWindow) => DashboardPanel[];
}) {
  const {
    allOrders,
    orders: activeOrders,
    isOrdersLoaded,
    status,
  } = useOrdersWSContext();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  const [selectedDate, setSelectedDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("24:00");
  const [view, setView] = useState("summary");
  const panelId = useId();
  const [intervalMinutes, setIntervalMinutes] = useState<BucketMinutes>(15);
  const [mode, setMode] = useState<Mode>("floor");
  const [reference, setReference] = useState<AnalysisOrder[]>([]);
  const [referenceInfo, setReferenceInfo] = useState("");
  const [referenceDate, setReferenceDate] = useState("");
  const [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<{
    at: number;
    orders: number;
  } | null>(null);
  const orders = useMemo(
    () => liveAnalysisOrders(allOrders ?? activeOrders),
    [allOrders, activeOrders],
  );
  const date = selectedDate || jstDate(now);
  const throughDate = endDate || date;
  const window = useMemo(() => {
    const start =
      dayWindow(date, now).start +
      (Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3))) *
        60_000;
    const end =
      dayWindow(throughDate, now).start +
      (Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3))) * 60_000;
    return { start, end, now };
  }, [date, throughDate, startTime, endTime, now]);
  const validPeriod =
    Number.isFinite(window.start) &&
    Number.isFinite(window.end) &&
    window.start < window.end &&
    window.start <= now;
  const extraPanels = validPeriod ? (additionalPanels?.(window) ?? []) : [];
  const views = [...VIEWS, ...extraPanels];
  const report = useMemo(
    () => operationsReport(orders, window, intervalMinutes),
    [orders, window, intervalMinutes],
  );
  const handoffEnd =
    Math.floor(Math.min(window.end, now) / 3_600_000) * 3_600_000;
  const handoffStart = Math.max(window.start, handoffEnd - 3_600_000);
  const handoff = useMemo(
    () =>
      operationsReport(
        orders,
        { start: handoffStart, end: handoffEnd, now },
        intervalMinutes,
      ),
    [orders, handoffStart, handoffEnd, now, intervalMinutes],
  );
  const baseline = useMemo(
    () =>
      referenceDate
        ? operationsReport(
            reference,
            {
              start:
                dayWindow(referenceDate, now).start +
                (window.start - dayWindow(date, now).start),
              end:
                dayWindow(referenceDate, now).start +
                (window.end - dayWindow(date, now).start),
              now: Number.POSITIVE_INFINITY,
            },
            intervalMinutes,
          )
        : null,
    [reference, referenceDate, window, date, now, intervalMinutes],
  );
  useEffect(() => {
    if (isOrdersLoaded) setSnapshot({ at: Date.now(), orders: orders.length });
  }, [orders, isOrdersLoaded]);
  const outlierRecords = report.outlierCups.filter((cup) =>
    report.total.outliers.includes(cup.minutes),
  );
  const last = report.latest;
  const trend = last
    ? last.net > 0
      ? "待っている杯数が増えています"
      : last.net < 0
        ? "お渡し待ちを減らせています"
        : "待っている杯数は横ばいです"
    : `最初の${intervalMinutes}分を集計中`;
  const loadBaseline = async () => {
    setLoading(true);
    setFailure("");
    try {
      const data = await load2025Baseline();
      setReference(data.orders);
      setReferenceDate(jstDate(data.orders[0].created));
      setReferenceInfo(
        `2025年の記録（注文ごと） / sohosai-analysis ${data.commit.slice(0, 8)}`,
      );
    } catch {
      setFailure("2025年データを読み込めませんでした。");
    } finally {
      setLoading(false);
    }
  };
  const exportFlow = () => {
    const csv = flowCsv(report.buckets, intervalMinutes);
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `operations-${date}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const chooseMode = (next: Mode) => {
    setMode(next);
    setView(
      next === "inventory"
        ? "availability"
        : next === "review"
          ? "duration"
          : "summary",
    );
  };
  return (
    <div
      className={`space-y-5 rounded-3xl bg-[#f7f5f0] p-3 text-stone-800 sm:p-5 ${compact ? "text-sm" : ""}`}
    >
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-xl">お店のダッシュボード</h2>
            <p className="mt-1 text-muted-foreground text-xs">
              注文・お渡しの記録から、営業の様子を{intervalMinutes}分ごとに。
            </p>
          </div>
        </div>
        <details>
          <summary className="cursor-pointer rounded-xl border border-stone-200 bg-white px-3 py-2 font-bold text-xs">
            期間を変える：{date} {startTime}〜
            {throughDate !== date ? `${throughDate} ` : ""}
            {endTime}
          </summary>
          <PeriodFilter
            period={{ date, throughDate, startTime, endTime }}
            now={now}
            onChange={(period) => {
              setSelectedDate(period.date);
              setEndDate(period.throughDate);
              setStartTime(period.startTime);
              setEndTime(period.endTime);
            }}
          />
        </details>
        {!validPeriod && (
          <p role="alert" className="text-red-700">
            開始日時は現在以前、終了日時は開始日時より後にしてください。
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          {!isOrdersLoaded
            ? "注文を読込中…"
            : status === "open"
              ? "● 自動更新中"
              : "● 接続待ち・最後に届いた記録を表示中"}{" "}
          更新{" "}
          {snapshot
            ? `${jstClock(snapshot.at)} / ${snapshot.orders}注文`
            : "未受信"}{" "}
          / 現在 {jstClock(now)}
        </p>
      </header>
      <fieldset className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2">
        <legend className="px-1 font-bold text-xs">
          時系列グラフの集計間隔
        </legend>
        {([5, 15, 60] as const).map((minutes) => (
          <button
            key={minutes}
            type="button"
            aria-pressed={intervalMinutes === minutes}
            onClick={() => setIntervalMinutes(minutes)}
            className={`min-h-10 rounded-lg border px-3 font-bold text-xs ${intervalMinutes === minutes ? "border-teal-800 bg-teal-800 text-white" : "border-stone-300 bg-white"}`}
          >
            {minutes === 60 ? "1時間" : `${minutes}分`}
          </button>
        ))}
        <span className="text-stone-500 text-xs">
          注文・お渡し・混雑・提供時間の推移・メニュー比較に反映。提供時間の分布は変わりません。
        </span>
      </fieldset>
      <section>
        <div
          className="-mb-px relative z-[1] flex overflow-x-auto pt-1"
          role="tablist"
          aria-label="利用場面"
        >
          {MODES.map((m, index) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              id={`${panelId}-mode-${m.id}`}
              aria-selected={mode === m.id}
              aria-controls={`${panelId}-mode-content`}
              tabIndex={mode === m.id ? 0 : -1}
              onClick={() => chooseMode(m.id)}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % MODES.length
                    : event.key === "ArrowLeft"
                      ? (index + MODES.length - 1) % MODES.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? MODES.length - 1
                          : null;
                if (next === null) return;
                event.preventDefault();
                chooseMode(MODES[next].id);
                document
                  .getElementById(`${panelId}-mode-${MODES[next].id}`)
                  ?.focus();
              }}
              className={`min-h-12 shrink-0 rounded-t-xl border py-3 font-bold focus-visible:outline-2 focus-visible:outline-teal-700 ${compact ? "flex-1 px-2 text-[11px]" : "px-4 text-xs"} ${mode === m.id ? "border-stone-300 border-b-white bg-white text-teal-900" : "border-transparent border-b-stone-300 bg-[#eee9df] text-stone-500 hover:bg-stone-200"}`}
            >
              {m.name}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`${panelId}-mode-content`}
          aria-labelledby={`${panelId}-mode-${mode}`}
          className={`space-y-5 border border-stone-300 bg-white ${compact ? "p-2" : "p-4"}`}
        >
          {isOrdersLoaded && validPeriod && (
            <>
              <div
                className={`grid grid-cols-2 gap-3 ${compact ? "" : "xl:grid-cols-4"}`}
              >
                <Metric
                  label="注文"
                  tone="blue"
                  icon={Coffee}
                  value={`${report.received}杯`}
                  note="この期間の注文・取消前の分も含む"
                />
                <Metric
                  label="お渡し済み"
                  tone="green"
                  icon={CheckCheck}
                  value={`${report.served}杯`}
                  note="この期間にお渡し・前日からの分も含む"
                />
                <Metric
                  label="お渡し待ち"
                  tone="orange"
                  icon={Timer}
                  value={`${report.backlog}杯`}
                  note={`期間末の待ち・持越し${report.openingBacklog}杯を含む・取消は除く`}
                />
                <Metric
                  label="売上"
                  tone="brown"
                  icon={Banknote}
                  value={money(report.revenue)}
                  note={`${report.orderCount}注文・この期間の注文分・取消は除く`}
                />
              </div>
              <div
                className={`grid min-w-0 items-start gap-4 ${compact ? "grid-cols-[3.5rem_minmax(0,1fr)]" : "grid-cols-[10rem_minmax(0,1fr)]"}`}
              >
                <div
                  role="tablist"
                  aria-label="分析グラフ"
                  aria-orientation="vertical"
                  className="sticky top-2 flex max-h-[75vh] flex-col gap-1 overflow-y-auto rounded-2xl border border-stone-200 bg-white p-1.5 shadow-sm"
                >
                  {views.map((item, index) => {
                    const Icon = VIEW_ICONS[item.id] ?? BarChart3;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="tab"
                        title={item.name}
                        id={`${panelId}-tab-${item.id}`}
                        aria-controls={`${panelId}-content`}
                        aria-selected={view === item.id}
                        tabIndex={view === item.id ? 0 : -1}
                        onClick={() => setView(item.id)}
                        onKeyDown={(event) => {
                          const next =
                            event.key === "ArrowDown"
                              ? (index + 1) % views.length
                              : event.key === "ArrowUp"
                                ? (index + views.length - 1) % views.length
                                : event.key === "Home"
                                  ? 0
                                  : event.key === "End"
                                    ? views.length - 1
                                    : null;
                          if (next === null) return;
                          event.preventDefault();
                          setView(views[next].id);
                          document
                            .getElementById(`${panelId}-tab-${views[next].id}`)
                            ?.focus();
                        }}
                        className={`flex min-h-12 items-center gap-2 rounded-xl ${compact ? "flex-col px-1 py-2 text-center text-[10px]" : "px-2.5 py-3 text-left text-xs sm:text-sm"} ${view === item.id ? "bg-teal-900 font-bold text-white shadow-sm" : "text-stone-600 hover:bg-stone-100"}`}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>
                          {compact
                            ? (SHORT_NAMES[item.id] ?? item.name)
                            : item.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div
                  role="tabpanel"
                  id={`${panelId}-content`}
                  aria-labelledby={`${panelId}-tab-${view}`}
                  className="min-w-0 space-y-4"
                >
                  <h3 className="font-bold text-lg">
                    {views.find((item) => item.id === view)?.name}
                  </h3>
                  {view === "summary" && (
                    <OverviewVisuals
                      report={report}
                      onSelect={setView}
                      compact={compact}
                    />
                  )}
                  {(view === "flow" || view === "acceleration") && (
                    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                      <h3 className="font-bold">{trend}</h3>
                      <p className="mt-2 text-sm">
                        直近{intervalMinutes}分：待ち{" "}
                        {signed(last?.net ?? null)}杯 ／ 増え方の変化{" "}
                        {signed(last?.acceleration ?? null)}杯
                      </p>
                      <details className="mt-2 text-stone-500 text-xs">
                        <summary className="cursor-pointer">
                          この数字の見方
                        </summary>
                        <p className="mt-2">
                          待ちの増減＝注文−お渡し−まだ渡していない取消分。その増減を前の
                          {intervalMinutes}
                          分と比べた差が「混み合い加速度」です。マイナスでも待ちの杯数そのものは増える場合があります。途中の
                          {intervalMinutes}分は比較しません。直近枠：
                          {last
                            ? `${jstDate(last.at)} ${jstClock(last.at).slice(0, 5)}〜`
                            : "集計待ち"}
                        </p>
                      </details>
                      <div className="mt-3 flex flex-wrap gap-4 text-sm">
                        <a className="underline" href="/master-sheet">
                          管制盤で割当を確認
                        </a>
                        <a className="underline" href="/serve">
                          提供を確認
                        </a>
                        <a className="underline" href="/cashier">
                          レジを確認
                        </a>
                        <button
                          type="button"
                          className="underline"
                          onClick={exportFlow}
                        >
                          {intervalMinutes}分集計CSVを保存
                        </button>
                      </div>
                      <FlowCharts
                        intervalMinutes={intervalMinutes}
                        buckets={report.buckets}
                        chart={
                          view === "acceleration" ? "acceleration" : "flow"
                        }
                      />
                      <p className="text-xs">
                        取消 {report.cancelledOrders}件 /
                        まだ渡す前に取消になった分 {report.cancelledCups}
                        杯。「できあがり」だけでは、お渡し待ちは減りません。
                      </p>
                    </section>
                  )}
                  {view === "summary" &&
                    mode !== "owner" &&
                    mode !== "handoff" && (
                      <section className="rounded-2xl border border-stone-200 bg-white p-5">
                        <h3 className="font-bold">長く待っている注文</h3>
                        <p className="mt-1 text-sm">
                          期間末の待ち時間が長い順。予想の待ち時間ではありません。
                        </p>
                        <ul className="mt-3 space-y-2">
                          {report.longest.slice(0, 8).map((v, i) => (
                            <li
                              key={`${v.number}:${i}`}
                              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${v.minutes >= 20 ? "border-rose-200 bg-rose-50 text-rose-800" : v.minutes >= 15 ? "border-orange-200 bg-orange-50 text-orange-800" : "border-stone-100 bg-stone-50"}`}
                            >
                              <span className="font-bold font-mono">
                                #{String(v.number).padStart(3, "0")}
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                {v.product}
                              </span>
                              <strong className="tabular-nums">
                                {v.minutes.toFixed(1)}分
                              </strong>
                            </li>
                          ))}
                        </ul>
                        {!report.longest.length && (
                          <p className="mt-2">お渡し待ちはありません。</p>
                        )}
                      </section>
                    )}
                  {view === "summary" && mode === "owner" && (
                    <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-5">
                      <h3 className="font-bold">売上とお渡しの速さ</h3>
                      <p>
                        1注文あたり{" "}
                        {report.orderCount
                          ? money(
                              Math.round(report.revenue / report.orderCount),
                            )
                          : "未計測"}{" "}
                        / 9割を渡すまで {minutes(report.total.p90)}
                      </p>
                      <p className="text-sm">
                        売上は注文時の金額です。利益や手元の現金とは異なります。
                        <a className="underline" href="/dashboard">
                          詳細と注文一覧
                        </a>
                      </p>
                    </section>
                  )}
                  {view === "summary" && mode === "handoff" && (
                    <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-5">
                      <h3 className="font-bold">直前1時間の引き継ぎ</h3>
                      {handoffStart < handoffEnd ? (
                        <>
                          <p>
                            {jstDate(handoffStart)}{" "}
                            {jstClock(handoffStart).slice(0, 5)}〜
                            {jstClock(handoffEnd).slice(0, 5)}
                            （集計が終わった時間）
                          </p>
                          <p>
                            注文 {handoff.received}杯 / お渡し {handoff.served}
                            杯 / 終わりのお渡し待ち {handoff.backlog}杯 / 売上{" "}
                            {money(handoff.revenue)}
                          </p>
                          <p className="text-sm">
                            いちばん長いお渡し待ち{" "}
                            {minutes(report.longest[0]?.minutes ?? null)}
                            。「連絡と操作の記録」と「在庫とメニュー」も確認してください。対応済みかどうかは記録から自動で分かりません。
                          </p>
                        </>
                      ) : (
                        <p>この期間の1時間分の集計はまだありません。</p>
                      )}
                    </section>
                  )}
                  {view === "duration" && (
                    <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                      <h3 className="font-bold">お渡しまでにかかった時間</h3>
                      <p className="text-muted-foreground text-xs">
                        この期間に注文され、期間末までに渡した分です。まだ渡していない
                        {report.censored}
                        杯はグラフに含みません。時刻がおかしい
                        {report.invalidTimes}
                        杯も時間の集計から外しています。
                      </p>
                      <DurationTrend
                        buckets={report.durationBuckets}
                        intervalMinutes={intervalMinutes}
                      />
                      <h4 className="font-bold">期間全体の分布・ばらつき</h4>
                      <DurationCharts stats={report.total} />
                      <h4 className="font-bold">商品ごとの時間</h4>
                      <ProductTimeChart products={report.products} />
                      {view === "duration" && (
                        <details>
                          <summary className="cursor-pointer font-bold text-sm">
                            杯数と時間の詳しい表
                          </summary>
                          <p className="text-stone-500 text-xs">
                            棒は真ん中の時間。下の表は 真ん中 /
                            9割がここまで終わる時間（杯数）。記録がない時間は「未計測」です。
                          </p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr>
                                  <th>商品</th>
                                  <th>注文/待ち</th>
                                  <th>注文→できあがり</th>
                                  <th>できあがり→お渡し</th>
                                  <th>注文→お渡し</th>
                                </tr>
                              </thead>
                              <tbody>
                                {report.products.map((p) => (
                                  <tr key={p.name} className="border-t">
                                    <td className="py-2">{p.name}</td>
                                    <td>
                                      {p.received}/{p.pending}
                                    </td>
                                    {[p.prep, p.handoff, p.total].map(
                                      (s, i) => (
                                        <td
                                          key={["prep", "handoff", "total"][i]}
                                        >
                                          {minutes(s.p50)} / {minutes(s.p90)}（
                                          {s.count}）
                                        </td>
                                      ),
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      )}
                      {view === "duration" && (
                        <details>
                          <summary className="cursor-pointer">
                            特に時間が長い・短い記録（{outlierRecords.length}
                            杯・全体の集計にも含む）
                          </summary>
                          <ul className="max-h-52 overflow-y-auto">
                            {outlierRecords.map((c, i) => (
                              <li
                                key={`${c.orderNo}:${i}`}
                                className="mt-1 text-sm"
                              >
                                #{String(c.orderNo).padStart(3, "0")} ·{" "}
                                {c.product} · {minutes(c.minutes)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </section>
                  )}
                  {view === "availability" && (
                    <AvailabilityReview
                      buckets={report.buckets}
                      intervalMinutes={intervalMinutes}
                    />
                  )}
                  {view === "logs" && (
                    <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
                      <h3 className="font-bold">注文ごとの連絡</h3>
                      <p className="text-muted-foreground text-xs">
                        レジ・マスター・提供の連絡です。個人の成績表ではありません。
                      </p>
                      <ul className="max-h-72 space-y-2 overflow-y-auto">
                        {report.comments.slice(0, 100).map((c, i) => (
                          <li
                            key={`${c.at}:${c.orderNo}:${i}`}
                            className="rounded-md bg-stone-50 p-2 text-sm"
                          >
                            <span className="font-bold">
                              #{String(c.orderNo).padStart(3, "0")} · {c.author}{" "}
                              · {jstDate(c.at)} {jstClock(c.at)}
                            </span>
                            <p className="whitespace-pre-wrap break-words">
                              {c.text}
                            </p>
                          </li>
                        ))}
                      </ul>
                      {!report.comments.length && (
                        <p className="text-sm">
                          この期間の注文には連絡がありません。
                        </p>
                      )}
                      <LogReview
                        start={window.start}
                        end={Math.min(window.end, now)}
                      />
                    </section>
                  )}
                  {view === "baseline" && (
                    <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-5">
                      <h3 className="font-bold">2025年との比較</h3>
                      <p className="text-sm">
                        選択した開始時刻から同じ長さの期間を比較します（2025年の開始日は下で選択）。昨年は注文ごと、今年は1杯ごとの記録です。条件が違うため、目安として比べてください。売上は全商品、杯数は飲み物だけです。
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          variant="outline"
                          disabled={loading}
                          onClick={() => void loadBaseline()}
                        >
                          {loading ? "読込中…" : "昨年の記録を開く"}
                        </Button>
                        <label className="text-sm">
                          手元の昨年データ{" "}
                          <input
                            type="file"
                            className="max-w-52"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              try {
                                const data = historicalOrders(
                                  JSON.parse(await file.text()),
                                );
                                if (!data.length)
                                  throw new Error("注文がありません。");
                                setReference(data);
                                setReferenceDate(jstDate(data[0].created));
                                setReferenceInfo(
                                  `2025年の記録（注文ごと） / ${file.name}`,
                                );
                                setFailure("");
                              } catch (error) {
                                setFailure(
                                  error instanceof Error
                                    ? error.message
                                    : "読み込めませんでした。",
                                );
                              }
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                      {failure && (
                        <p role="alert" className="text-red-700">
                          {failure}
                        </p>
                      )}
                      {baseline && (
                        <>
                          <p className="text-xs">
                            {referenceInfo} ·{" "}
                            <a
                              className="underline"
                              href="https://github.com/cafeore-tkb/sohosai-analysis/tree/main/2025/data"
                              target="_blank"
                              rel="noreferrer"
                            >
                              出典
                            </a>
                          </p>
                          <select
                            aria-label="2025年の比較対象日"
                            className="rounded border p-2"
                            value={referenceDate}
                            onChange={(e) => setReferenceDate(e.target.value)}
                          >
                            {[
                              ...new Set(
                                reference.map((o) => jstDate(o.created)),
                              ),
                            ]
                              .sort()
                              .map((d) => (
                                <option key={d}>{d}</option>
                              ))}
                          </select>
                          <div
                            className={`grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-2"}`}
                          >
                            <Metric
                              label={`${date} 今年の記録`}
                              value={money(report.revenue)}
                              note={`${report.received}杯 / お渡しまでの真ん中${minutes(report.total.p50)}`}
                            />
                            <Metric
                              label={`${referenceDate} 2025年の記録・注文ごと`}
                              value={money(baseline.revenue)}
                              note={`${baseline.received}杯 / お渡しまでの真ん中${minutes(baseline.total.p50)}`}
                            />
                          </div>
                          <FlowCharts
                            buckets={baseline.buckets}
                            intervalMinutes={intervalMinutes}
                          />
                          <DurationCharts
                            stats={baseline.total}
                            compact={compact}
                          />
                        </>
                      )}
                    </section>
                  )}
                  {extraPanels.find((item) => item.id === view)?.content}
                </div>
              </div>
              <details className="rounded-2xl border border-stone-200 bg-white p-5 text-xs">
                <summary className="cursor-pointer font-bold">
                  数字の見方・分かること／分からないこと
                </summary>
                <p className="mt-2">
                  日本時間で{intervalMinutes}
                  分ごとに数えます。開始時刻ちょうどを含み、終了時刻ちょうどは次の期間に入ります。杯数は飲み物だけ。グッズと入れ直しは新しい杯数に足しません。取消前の注文も注文杯数に残し、まだ渡す前の取消分は待ちから減らします。売上と提供時間は、この期間に受けた注文が対象です。後から注文を直すと数字も変わります。まだ届いていない記録は含みません。
                </p>
                <p className="mt-2">
                  この画面だけでは分からないこと：すべてのボタン操作、品切れ・再開の全記録、誰が何時間働いたか、原価や利益。記録忘れもあり得ます。個人の評価や、これから何人来るかの予測はしません。
                </p>
              </details>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
const METRIC_TONES = {
  blue: "border-sky-200 bg-sky-50 text-sky-900",
  green: "border-teal-200 bg-teal-50 text-teal-900",
  orange: "border-orange-200 bg-orange-50 text-orange-900",
  brown: "border-stone-200 bg-[#eee8df] text-stone-800",
};
function Metric({
  label,
  value,
  note,
  tone = "brown",
  icon: Icon = Coffee,
}: {
  label: string;
  value: string;
  note: string;
  tone?: keyof typeof METRIC_TONES;
  icon?: LucideIcon;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-4 shadow-sm ${METRIC_TONES[tone]}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold text-xs sm:text-sm">{label}</p>
        <Icon className="h-5 w-5 shrink-0 opacity-60" aria-hidden="true" />
      </div>
      <p className="mt-3 font-bold text-2xl tabular-nums tracking-tight sm:text-3xl">
        {value}
      </p>
      <p className="mt-2 text-[11px] leading-relaxed opacity-75">{note}</p>
    </div>
  );
}
