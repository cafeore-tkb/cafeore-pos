import {
  type OrderEntity,
  jstClock,
  jstDate,
  useItemMaster,
} from "@cafeore/common";
import {
  Activity,
  Banknote,
  BarChart3,
  CircleDollarSign,
  Clock3,
  Coffee,
  History,
  ListOrdered,
  Package,
  Radio,
  ReceiptText,
  ScrollText,
  Timer,
  WalletCards,
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AdminPageHeader } from "~/components/molecules/AdminPageHeader";
import { dashboardFinance } from "~/lib/analytics/dashboardFinance";
import { dashboardWindow } from "~/lib/analytics/dashboardWindow";
import { load2025Baseline } from "~/lib/analytics/historical";
import {
  type AnalysisOrder,
  type BucketMinutes,
  dayWindow,
  liveAnalysisOrders,
  operationsReport,
} from "~/lib/analytics/operations";
import {
  compareProductCups,
  comparisonChange,
  comparisonWindow,
  currentProductKey,
  historicalHourly,
} from "~/lib/analytics/yearComparison";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";
import { DashboardControls } from "./DashboardControls";
import { OrderStatusList } from "./MasterState";
import { OrderList } from "./OrderList";
import {
  YearComparisonSettings,
  YearProductComparison,
} from "./YearComparison";
import { AvailabilityReview } from "./operations/AvailabilityReview";
import { ChartValues } from "./operations/ChartValues";
import { DurationCharts, minutes } from "./operations/DurationCharts";
import { DurationTrend } from "./operations/DurationTrend";
import { FlowCharts } from "./operations/FlowCharts";
import { LogReview } from "./operations/LogReview";
import { OperationsDashboard } from "./operations/OperationsDashboard";
import {
  ProductCupChart,
  ProductTimeChart,
} from "./operations/OverviewVisuals";
import { SnapshotComparison } from "./operations/SnapshotComparison";
import {
  CURRENT_YEAR_COLOR,
  CurrentYearBar,
  PREVIOUS_YEAR_COLOR,
  YearChartLegend,
  YearChartTooltip,
} from "./operations/YearChartStyle";
import { useYearComparisonSettings } from "./useYearComparisonSettings";

const SECTIONS = [
  {
    id: "sales",
    name: "売り上げ",
    description: "金額・杯数・決済の内訳",
    icon: Banknote,
  },
  {
    id: "analysis",
    name: "提供パフォーマンス",
    description: "提供スピードと待ち時間",
    icon: BarChart3,
  },
  {
    id: "inventory",
    name: "消費量・在庫",
    description: "POS上の計算値と現在残量",
    icon: Package,
  },
  {
    id: "details",
    name: "個別データ",
    description: "注文ごとの記録",
    icon: ListOrdered,
  },
  {
    id: "records",
    name: "運用記録",
    description: "停止・再開と操作ログ",
    icon: ScrollText,
  },
  {
    id: "comparison",
    name: "25年度比較",
    description: "2025年度の実績と比較",
    icon: History,
  },
] as const;

type DashboardSection = (typeof SECTIONS)[number]["id"];
const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;
const EMPTY_ORDERS: OrderEntity[] = [];

export function DashboardWorkspace() {
  const {
    allOrders,
    orders: activeOrders,
    isOrdersLoaded,
    status,
  } = useOrdersWSContext();
  const [now, setNow] = useState(() => Date.now());
  const [selectedDate, setSelectedDate] = useState(() => jstDate(Date.now()));
  const [section, setSection] = useState<DashboardSection>("sales");
  const [intervalMinutes, setIntervalMinutes] = useState<BucketMinutes>(15);
  const [referenceOrders, setReferenceOrders] = useState<AnalysisOrder[]>([]);
  const comparisonSettings = useYearComparisonSettings();
  const { items, error: itemsError, isLoading: itemsLoading } = useItemMaster();
  const [referenceInfo, setReferenceInfo] = useState("");
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [referenceFailure, setReferenceFailure] = useState("");
  const tabId = useId();
  const contentRef = useRef<HTMLElement>(null);
  const navigated = useRef<DashboardSection | null>(null);
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("24:00");
  const chooseSection = (next: DashboardSection) => {
    // Leave the old page's deep scroll position before its content height changes.
    contentRef.current?.scrollIntoView({ block: "start" });
    navigated.current = next;
    setSection(next);
  };
  useLayoutEffect(() => {
    if (navigated.current !== section) return;
    contentRef.current?.scrollIntoView({ block: "start" });
    navigated.current = null;
  }, [section]);
  const showFilters = () => {
    contentRef.current?.scrollIntoView({ block: "start" });
    contentRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    setReferenceLoading(true);
    load2025Baseline()
      .then((data) => {
        if (!active) return;
        setReferenceOrders(data.orders);
        setReferenceInfo(
          `2025/data/day12.json / sohosai-analysis ${data.commit.slice(0, 8)}`,
        );
        setReferenceFailure("");
      })
      .catch(() => {
        if (active)
          setReferenceFailure("2025年度の記録を読み込めませんでした。");
      })
      .finally(() => {
        if (active) setReferenceLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const sourceOrders = allOrders ?? activeOrders ?? EMPTY_ORDERS;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 注文受信を契機に集計の締切を進め、直近の注文も即座に含める。
  useEffect(() => setNow(Date.now()), [sourceOrders]);
  const selectedWindow = useMemo(
    () => dashboardWindow(selectedDate, startTime, endTime, now),
    [selectedDate, startTime, endTime, now],
  );
  // Hooks remain stable while an invalid filter is being edited; the report is hidden below.
  const window = selectedWindow ?? dayWindow(selectedDate, now);
  const cutoff = Math.min(window.end, now);
  const selectedOrders = useMemo(
    () =>
      sourceOrders.filter((order) => {
        const createdAt = order.createdAt.getTime();
        return createdAt >= window.start && createdAt < cutoff;
      }),
    [sourceOrders, window.start, cutoff],
  );
  const report = useMemo(
    () =>
      operationsReport(
        liveAnalysisOrders(sourceOrders),
        window,
        intervalMinutes,
      ),
    [sourceOrders, window, intervalMinutes],
  );
  const referenceDays = useMemo(
    () =>
      [
        ...new Set(referenceOrders.map((order) => jstDate(order.created))),
      ].sort(),
    [referenceOrders],
  );
  const referenceDate = referenceDays.includes(
    comparisonSettings.settings.referenceDate,
  )
    ? comparisonSettings.settings.referenceDate
    : (referenceDays[0] ?? "");
  const referenceWindow = useMemo(
    () => (referenceDate ? comparisonWindow(window, referenceDate) : null),
    [window, referenceDate],
  );
  const comparisonReport = useMemo(
    () =>
      referenceWindow
        ? operationsReport(referenceOrders, referenceWindow, intervalMinutes)
        : null,
    [referenceOrders, referenceWindow, intervalMinutes],
  );
  const referenceHourly = useMemo(
    () =>
      referenceWindow
        ? historicalHourly(referenceOrders, referenceWindow)
        : null,
    [referenceOrders, referenceWindow],
  );
  const currentProducts = useMemo(() => {
    const products = new Map<string, string>();
    for (const order of sourceOrders) {
      for (const cup of order.cups)
        products.set(currentProductKey(cup.item), cup.item.name);
    }
    // マスターに登録した直後の商品も、売れる前に設定できる。
    for (const item of items) {
      if (item.item_type.makes_cup)
        products.set(currentProductKey(item), item.name);
    }
    return [...products]
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }, [sourceOrders, items]);
  const historicalProducts = useMemo(
    () =>
      [
        ...new Set(
          referenceOrders.flatMap((order) =>
            order.cups.map((cup) => cup.product),
          ),
        ),
      ].sort((a, b) => a.localeCompare(b, "ja")),
    [referenceOrders],
  );
  const productComparison = useMemo(
    () =>
      referenceWindow
        ? compareProductCups(
            sourceOrders,
            referenceOrders,
            window,
            referenceWindow,
            comparisonSettings.settings,
            currentProducts.map((p) => p.key),
            historicalProducts,
          )
        : null,
    [
      sourceOrders,
      referenceOrders,
      window,
      referenceWindow,
      comparisonSettings.settings,
      currentProducts,
      historicalProducts,
    ],
  );
  const finance = useMemo(
    () => dashboardFinance(selectedOrders, cutoff, now, selectedDate, window),
    [selectedOrders, cutoff, now, selectedDate, window],
  );

  const selectedSection =
    SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];
  const live = isOrdersLoaded && status === "open";
  const yearSettings = (
    <YearComparisonSettings
      settings={comparisonSettings.settings}
      onChange={comparisonSettings.update}
      currentProducts={currentProducts}
      historicalProducts={historicalProducts}
      referenceDays={referenceDays}
      referenceDate={referenceDate}
      loading={referenceLoading}
      failure={referenceFailure}
      storageMessage={comparisonSettings.storageMessage}
      disabled={
        !comparisonSettings.loaded ||
        comparisonSettings.saveBlocked ||
        itemsLoading ||
        !!itemsError
      }
    />
  );

  return (
    <div className="min-h-full bg-white px-4 py-6 text-stone-900 [--dashboard-nav-height:4rem] [overflow-anchor:none] sm:px-6 lg:px-10 lg:[--dashboard-nav-height:0px]">
      <div className="mx-auto max-w-[1600px]">
        <div className="border-stone-200 border-b pb-6">
          <AdminPageHeader
            group="admin"
            title="ダッシュボード"
            description="売上、注文、提供状況をひとつの画面から確認できます。"
            actions={
              <div>
                <div className="flex items-center gap-2 font-bold text-xs">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${live ? "bg-emerald-400" : "bg-amber-400"}`}
                    aria-hidden="true"
                  />
                  {!isOrdersLoaded
                    ? "注文を読込中"
                    : live
                      ? "リアルタイム更新中"
                      : "接続待ち"}
                </div>
                <p className="mt-1 text-[10px] text-stone-500">
                  現在 {jstClock(now).slice(0, 5)}
                </p>
              </div>
            }
          />
        </div>

        <div
          className="sticky top-[var(--pos-status-height,0px)] z-20 flex items-center gap-3 border-stone-200 border-b bg-white py-2 lg:hidden"
          aria-label="ダッシュボードの切り替え"
        >
          <label htmlFor={`${tabId}-mobile-section`} className="sr-only">
            表示を切り替える
          </label>
          <select
            id={`${tabId}-mobile-section`}
            value={section}
            onChange={(e) => chooseSection(e.target.value as DashboardSection)}
            className="min-h-11 min-w-0 flex-1 rounded-md border border-teal-200 bg-teal-50 px-3 font-bold text-sm text-teal-950"
          >
            {SECTIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={showFilters}
            className="min-h-11 shrink-0 px-2 text-sm underline underline-offset-4"
          >
            表示条件へ
          </button>
        </div>
        <div className="mt-6 min-w-0 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8">
          <aside className="hidden lg:block">
            <div className="sticky top-[calc(var(--pos-status-height,0px)+1rem)] max-h-[calc(100dvh-var(--pos-status-height,0px)-2rem)] overflow-y-auto">
              <nav
                className="flex flex-col"
                role="tablist"
                aria-label="ダッシュボードの表示"
                aria-orientation="vertical"
              >
                {SECTIONS.map((item, index) => {
                  const Icon = item.icon;
                  const selected = section === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      id={`${tabId}-tab-${item.id}`}
                      aria-selected={selected}
                      aria-controls={`${tabId}-panel`}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => chooseSection(item.id)}
                      onKeyDown={(event) => {
                        const next =
                          event.key === "ArrowRight" ||
                          event.key === "ArrowDown"
                            ? (index + 1) % SECTIONS.length
                            : event.key === "ArrowLeft" ||
                                event.key === "ArrowUp"
                              ? (index + SECTIONS.length - 1) % SECTIONS.length
                              : null;
                        if (next === null) return;
                        event.preventDefault();
                        const nextSection = SECTIONS[next];
                        chooseSection(nextSection.id);
                        document
                          .getElementById(`${tabId}-tab-${nextSection.id}`)
                          ?.focus();
                      }}
                      className={`group flex min-h-14 items-center gap-3 border-l-2 px-3 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-stone-700 ${selected ? "border-teal-700 bg-teal-50 text-teal-950" : "border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-900"}`}
                    >
                      <span
                        className={`${selected ? "text-teal-700" : "text-stone-400"}`}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-black text-sm">
                          {item.name}
                        </span>
                        <span
                          className={`mt-0.5 hidden truncate text-[10px] sm:block lg:text-xs ${selected ? "text-stone-600" : "text-stone-500"}`}
                        >
                          {item.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </nav>

              <button
                type="button"
                onClick={showFilters}
                className="mt-4 min-h-11 px-3 text-sm underline underline-offset-4"
              >
                表示条件へ
              </button>
            </div>
          </aside>
          <main
            ref={contentRef}
            tabIndex={-1}
            role="tabpanel"
            id={`${tabId}-panel`}
            aria-label={selectedSection.name}
            className="min-w-0 scroll-mt-[calc(var(--pos-status-height,0px)+5rem)] focus:outline-none lg:scroll-mt-[calc(var(--pos-status-height,0px)+1rem)]"
          >
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="font-bold text-[11px] text-stone-500 uppercase tracking-[0.18em]">
                  {selectedDate === jstDate(now) ? "Today" : "Archive"}
                </p>
                <h2 className="mt-1 font-black text-2xl tracking-tight">
                  {selectedSection.name}
                </h2>
              </div>
              <p className="text-stone-500 text-xs">
                {section === "inventory"
                  ? "在庫は現在値 / 注文の比較期間："
                  : ""}
                {selectedDate} {startTime}〜{endTime}
                {selectedWindow && cutoff < window.end
                  ? `（集計は${jstClock(cutoff).slice(0, 5)}まで）`
                  : ""}
              </p>
            </div>

            <DashboardControls
              date={selectedDate}
              startTime={startTime}
              endTime={endTime}
              now={now}
              interval={intervalMinutes}
              showInterval={
                section === "analysis" ||
                section === "comparison" ||
                section === "inventory"
              }
              onDate={setSelectedDate}
              onStart={setStartTime}
              onEnd={setEndTime}
              onInterval={setIntervalMinutes}
            />
            <div className="pt-6">
              {(section === "sales" || section === "comparison") && (
                <div className="mb-5">
                  {yearSettings}
                  {itemsError && (
                    <output className="mt-2 block text-stone-600 text-xs">
                      商品マスターを取得できません。受信済みの商品を表示しています。対応付けの編集は取得後に再開します。
                    </output>
                  )}
                </div>
              )}
              {!selectedWindow ? (
                <p
                  role="alert"
                  className="border-red-600 border-l-2 pl-3 text-red-800 text-sm"
                >
                  開始・終了時刻を確認してください。終了は開始より後、開始は現在より前に設定してください。
                </p>
              ) : section === "inventory" ? (
                <AvailabilityReview
                  buckets={report.buckets}
                  intervalMinutes={intervalMinutes}
                />
              ) : !isOrdersLoaded ? (
                <LoadingState />
              ) : section === "records" ? (
                <div className="space-y-5">
                  <section className="border-stone-200 border-t pt-6">
                    <h3 className="mb-3 font-bold text-lg">
                      オーダーストップ・再開の記録
                    </h3>
                    <OrderStatusList start={window.start} end={cutoff} />
                  </section>
                  <section className="border-stone-200 border-t pt-6">
                    <h3 className="mb-3 font-bold text-lg">
                      操作ログ・サーバー成功履歴
                    </h3>
                    <LogReview start={window.start} end={cutoff} />
                  </section>
                  <details className="border-stone-200 border-t pt-6">
                    <summary className="cursor-pointer font-bold">
                      従来の運用分析（期間指定・引き継ぎ・CSV）
                    </summary>
                    <p className="mt-3 text-stone-500 text-xs">
                      この詳細画面は、内部で指定した期間・集計間隔を使います。
                    </p>
                    <OperationsDashboard />
                  </details>
                </div>
              ) : section === "sales" ? (
                <SalesSection
                  report={report}
                  finance={finance}
                  reference={comparisonReport}
                  referenceHourly={referenceHourly}
                  productComparison={productComparison}
                />
              ) : section === "details" ? (
                <section className="border-stone-200 border-t pt-6">
                  <SectionHeading
                    icon={ReceiptText}
                    title="注文一覧"
                    description="注文番号、商品、状態から記録を探し、詳細を確認できます。"
                  />
                  <div className="mt-5">
                    <OrderList orders={selectedOrders} />
                  </div>
                </section>
              ) : section === "analysis" ? (
                <AnalysisSection
                  report={report}
                  intervalMinutes={intervalMinutes}
                />
              ) : (
                <div className="space-y-5">
                  <SnapshotComparison current={report} window={window} />
                  <ComparisonSection
                    currentDate={selectedDate}
                    current={report}
                    referenceDate={referenceDate}
                    reference={comparisonReport}
                    referenceInfo={referenceInfo}
                    loading={referenceLoading}
                    failure={referenceFailure}
                    intervalMinutes={intervalMinutes}
                  />
                  {productComparison && (
                    <YearProductComparison data={productComparison} />
                  )}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

type Report = ReturnType<typeof operationsReport>;
type Finance = ReturnType<typeof dashboardFinance>;

function SalesSection({
  report,
  finance,
  reference,
  referenceHourly,
  productComparison,
}: {
  report: Report;
  finance: Finance;
  reference: Report | null;
  referenceHourly: Map<number, number> | null;
  productComparison: ReturnType<typeof compareProductCups> | null;
}) {
  const paymentTotal = finance.cash + finance.square;
  const cashRatio = paymentTotal > 0 ? (finance.cash / paymentTotal) * 100 : 0;
  const squareRatio =
    paymentTotal > 0 ? (finance.square / paymentTotal) * 100 : 0;
  const cups = report.products.reduce(
    (sum, product) => sum + product.received,
    0,
  );
  const referenceCups =
    reference?.products.reduce((sum, product) => sum + product.received, 0) ??
    0;
  const gradientId = `sales-excess-${useId().replace(/:/g, "")}`;
  const hourly = finance.hourly.map((hour) => ({
    ...hour,
    name: hour.label,
    current: hour.revenue,
    previous: referenceHourly ? (referenceHourly.get(hour.hour) ?? 0) : null,
    previousRevenue: referenceHourly
      ? (referenceHourly.get(hour.hour) ?? 0)
      : undefined,
  }));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-x-8 gap-y-5 xl:grid-cols-5">
        <MetricCard
          icon={Coffee}
          label="注文杯数"
          value={`${cups}杯`}
          note="取消を除く・ドリンクのみ"
          comparison={
            reference ? (
              <ComparisonNote
                reference={`${referenceCups}杯`}
                difference={comparisonChange(cups, referenceCups, "杯")}
              />
            ) : undefined
          }
        />
        <MetricCard
          icon={CircleDollarSign}
          label="売上"
          value={yen(report.revenue)}
          note={`${report.orderCount}件の注文`}
          comparison={
            reference ? (
              <ComparisonNote
                reference={yen(reference.revenue)}
                difference={comparisonChange(
                  report.revenue,
                  reference.revenue,
                  "円",
                )}
              />
            ) : undefined
          }
        />
        <MetricCard
          icon={ReceiptText}
          label="客単価"
          value={yen(finance.average)}
          note="注文1件あたり"
          comparison={
            reference ? (
              <ComparisonNote
                reference={
                  reference.orderCount
                    ? yen(Math.round(reference.revenue / reference.orderCount))
                    : "—（注文なし）"
                }
              />
            ) : undefined
          }
        />
        <MetricCard
          icon={Banknote}
          label="現金"
          value={yen(finance.cash)}
          note={`決済内訳合計の ${cashRatio.toFixed(1)}%`}
        />
        <MetricCard
          icon={WalletCards}
          label="Square"
          value={yen(finance.square)}
          note={`決済内訳合計の ${squareRatio.toFixed(1)}%`}
        />
      </div>

      <section className="border-stone-200 border-t pt-6">
        <SectionHeading
          icon={Coffee}
          title="商品別の注文杯数"
          description="選択日に受けた注文から取消を除外。金額とは別の軸で杯数を比較します。"
        />
        <ProductCupChart
          products={report.products}
          comparisonRows={productComparison?.chartRows}
        />
        {productComparison && (
          <YearProductComparison data={productComparison} />
        )}
      </section>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.7fr)]">
        <section className="min-w-0 border-stone-200 border-t pt-6">
          <SectionHeading
            icon={Activity}
            title="時間帯別の売上"
            description="選択期間内の売上を受付時刻ごとに表示。最初・最後の時間帯は一部だけの集計になる場合があります。"
          />
          <div className="mt-5 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={hourly}
                accessibilityLayer
                margin={{ top: 24, right: 8, left: 20, bottom: 24 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  label={{
                    value: "受付時間（JST・1時間ごと）",
                    position: "bottom",
                    offset: 4,
                  }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  label={{
                    value: "売上（円）",
                    angle: -90,
                    position: "insideLeft",
                    offset: -12,
                  }}
                  domain={[0, "auto"]}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) =>
                    value >= 1000 ? `${value / 1000}千` : String(value)
                  }
                  width={42}
                />
                <Tooltip
                  content={({ active, payload }) => (
                    <YearChartTooltip
                      active={active}
                      row={payload?.[0]?.payload}
                      unit="円"
                    />
                  )}
                  cursor={{ fill: "#f5f5f4" }}
                />
                <Bar
                  dataKey="current"
                  name="売上"
                  fill={CURRENT_YEAR_COLOR}
                  shape={<CurrentYearBar gradientId={gradientId} vertical />}
                  radius={[7, 7, 0, 0]}
                  maxBarSize={46}
                  isAnimationActive={false}
                />
                {reference && (
                  <Bar
                    dataKey="previousRevenue"
                    name="前年・同時刻までの売上"
                    fill={PREVIOUS_YEAR_COLOR}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={24}
                    isAnimationActive={false}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <YearChartLegend comparison={reference !== null} />
          <p className="mt-2 text-stone-500 text-xs">
            {finance.peak
              ? `売上が最も多い時間帯: ${finance.peak.label}〜・${yen(finance.peak.revenue)}`
              : "売上が0円のため、最多の時間帯は表示しません。"}
          </p>
          <ChartValues
            columns={
              reference
                ? [
                    "受付時間（JST）",
                    "売上（円）",
                    "注文（件）",
                    "前年売上（円）",
                  ]
                : ["受付時間（JST）", "売上（円）", "注文（件）"]
            }
            rows={hourly.map((h) =>
              reference
                ? [h.label, h.revenue, h.orders, h.previousRevenue ?? 0]
                : [h.label, h.revenue, h.orders],
            )}
          />
        </section>

        <section className="border-stone-200 border-t pt-6">
          <SectionHeading
            icon={WalletCards}
            title="決済の内訳"
            description="選択日に受けた注文の決済内訳。割合の分母は現金＋Squareの合計です。"
          />
          <div className="mt-6 space-y-6">
            <PaymentRow
              label="現金"
              amount={finance.cash}
              ratio={cashRatio}
              color="bg-amber-500"
            />
            <PaymentRow
              label="Square"
              amount={finance.square}
              ratio={squareRatio}
              color="bg-indigo-500"
            />
            {finance.squareDetails.length > 0 && (
              <div className="space-y-2 border-stone-200 border-t pt-4">
                <p className="font-bold text-stone-900 text-xs">
                  Square決済の内訳
                </p>
                <dl className="space-y-2">
                  {finance.squareDetails.map((payment) => (
                    <div
                      key={payment.type}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <dt className="text-stone-600">{payment.label}</dt>
                      <dd className="font-bold tabular-nums">
                        {yen(payment.amount)}
                        <span className="ml-2 font-normal text-[10px] text-stone-500">
                          {finance.square > 0
                            ? ((payment.amount / finance.square) * 100).toFixed(
                                0,
                              )
                            : 0}
                          %
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
          <dl className="mt-5 space-y-2 border-stone-200 border-t pt-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt>請求額合計（売上）</dt>
              <dd>{yen(report.revenue)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>決済内訳合計（現金＋Square）</dt>
              <dd>{yen(paymentTotal)}</dd>
            </div>
            <div className="flex justify-between gap-3 font-bold">
              <dt>差額（請求額 − 決済内訳）</dt>
              <dd>{yen(finance.difference)}</dd>
            </div>
            {finance.unclassified !== 0 && (
              <div className="flex justify-between gap-3">
                <dt>うち決済方法の記録がない請求額</dt>
                <dd>{yen(finance.unclassified)}</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-stone-500 text-xs">
            個別会計はpaymentsの記録額、一括会計は保存された決済方法と請求額で集計（一括会計{" "}
            {yen(finance.lumpSum)}
            ）。未記録の方法は現金とみなしません。差額は記録の不一致を示し、未収金とは断定しません。返金時刻別の入出金集計ではありません。
          </p>
          <dl className="mt-7 space-y-3 border-stone-100 border-t pt-5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-stone-500">値引き</dt>
              <dd className="font-bold">{yen(finance.discount)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-stone-500">取消注文</dt>
              <dd className="font-bold">{finance.cancelled}件</dd>
            </div>
          </dl>
          <p className="mt-5 text-stone-500 text-xs leading-relaxed">
            売上は取消済みを除く注文時の請求額です。返金の実施状況は金額から自動控除しません。
          </p>
        </section>
      </div>
    </div>
  );
}

function AnalysisSection({
  report,
  intervalMinutes,
}: {
  report: Report;
  intervalMinutes: BucketMinutes;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-x-8 gap-y-5 xl:grid-cols-4">
        <MetricCard
          icon={Clock3}
          label="提供時間の中央値"
          value={minutes(report.total.p50)}
          note={`提供済み ${report.total.count}杯の実測`}
        />
        <MetricCard
          icon={Timer}
          label="9割を渡すまで"
          value={minutes(report.total.p90)}
          note="提供済みのP90・待ち時間予測ではありません"
        />
        <MetricCard
          icon={Coffee}
          label="お渡し待ち"
          value={`${report.backlog}杯`}
          note="期間末・開始前の持越しを含む"
        />
        <MetricCard
          icon={Timer}
          label="最長の待ち時間"
          value={
            report.longest[0] ? minutes(report.longest[0].minutes) : "待ちなし"
          }
          note="期間末の未提供が対象"
        />
      </div>
      <section className="border-stone-200 border-t pt-6">
        <SectionHeading
          icon={Activity}
          title="カップステータス"
          description={`${intervalMinutes}分ごとの注文、お渡し、お渡し待ちの推移です。`}
        />
        <div className="mt-4">
          <FlowCharts
            buckets={report.buckets}
            chart="flow"
            intervalMinutes={intervalMinutes}
            flowStyle="line"
          />
        </div>
      </section>

      <section className="border-stone-200 border-t pt-6">
        <SectionHeading
          icon={Clock3}
          title="提供時間"
          description={`提供済み ${report.total.count}杯を分析。未提供 ${report.censored}杯は時間集計に含みません。`}
        />
        <div className="mt-5">
          <DurationTrend
            buckets={report.durationBuckets}
            intervalMinutes={intervalMinutes}
          />
        </div>
      </section>

      <div className="min-w-0 space-y-6">
        <section className="min-w-0 border-stone-200 border-t pt-6">
          <SectionHeading
            icon={BarChart3}
            title="提供時間の分布"
            description={`中央値 ${minutes(report.total.p50)}・90%が ${minutes(report.total.p90)} 以内`}
          />
          <div className="mt-5">
            <DurationCharts stats={report.total} hideBoxPlot />
          </div>
        </section>
        <section className="min-w-0 border-stone-200 border-t pt-6">
          <SectionHeading
            icon={Coffee}
            title="商品ごとの提供時間"
            description="抽出開始で分けた平均時間の内訳と各区間、準備完了で分けた中央値を比較します。"
          />
          <div className="mt-5">
            <ProductTimeChart products={report.products} />
          </div>
        </section>
      </div>
    </div>
  );
}

const signedYen = (value: number) =>
  `${value >= 0 ? "+" : "−"}¥${Math.abs(value).toLocaleString("ja-JP")}`;
const signedCups = (value: number) =>
  `${value >= 0 ? "+" : "−"}${Math.abs(value)}杯`;
const signedMinutes = (value: number | null) =>
  value === null
    ? "比較待ち"
    : `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}分`;

function ComparisonSection({
  currentDate,
  current,
  referenceDate,
  reference,
  referenceInfo,
  loading,
  failure,
  intervalMinutes,
}: {
  currentDate: string;
  current: Report;
  referenceDate: string;
  reference: Report | null;
  referenceInfo: string;
  loading: boolean;
  failure: string;
  intervalMinutes: BucketMinutes;
}) {
  const maximumCups = Math.max(
    1,
    ...[current, reference].flatMap((r) =>
      r ? r.buckets.flatMap((b) => [b.received, b.served, b.backlog]) : [],
    ),
  );
  const maximumCount = Math.max(
    1,
    ...[current, reference].flatMap((r) =>
      r ? r.total.histogram.map((b) => b.count) : [],
    ),
  );
  const maximumMinutes = Math.max(
    1,
    ...[current, reference].flatMap((r) =>
      r ? r.total.cdf.map((b) => b.minutes) : [],
    ),
  );
  const medianDifference =
    reference !== null &&
    current.total.p50 !== null &&
    reference.total.p50 !== null
      ? current.total.p50 - reference.total.p50
      : null;
  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 border-stone-200 border-t pt-6 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeading
          icon={History}
          title="2025年度の実績と比較"
          description="選択中の日付と同じ長さの時間帯を、2025年度の記録と比較します。"
        />
      </section>

      {failure && (
        <p
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 text-sm"
        >
          {failure}
        </p>
      )}
      {loading && !reference ? (
        <LoadingState />
      ) : reference ? (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <ComparisonMetric
              label="売上"
              currentLabel={currentDate}
              currentValue={yen(current.revenue)}
              referenceLabel={referenceDate}
              referenceValue={yen(reference.revenue)}
              difference={signedYen(current.revenue - reference.revenue)}
            />
            <ComparisonMetric
              label="注文された杯数"
              currentLabel={currentDate}
              currentValue={`${current.received}杯`}
              referenceLabel={referenceDate}
              referenceValue={`${reference.received}杯`}
              difference={signedCups(current.received - reference.received)}
            />
            <ComparisonMetric
              label="お渡しまでの中央値"
              currentLabel={currentDate}
              currentValue={minutes(current.total.p50)}
              referenceLabel={referenceDate}
              referenceValue={minutes(reference.total.p50)}
              difference={signedMinutes(medianDifference)}
            />
          </div>

          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            {[
              {
                label: `${currentDate}の記録`,
                report: current,
                year: "current" as const,
              },
              {
                label: `${referenceDate}の記録`,
                report: reference,
                year: "previous" as const,
              },
            ].map((item) => (
              <section
                key={item.label}
                className="min-w-0 border-stone-200 border-t pt-6"
              >
                <SectionHeading
                  icon={Activity}
                  title={item.label}
                  description={`${intervalMinutes}分ごとの注文、お渡し、お渡し待ちです。`}
                />
                <FlowCharts
                  maximumCups={maximumCups}
                  buckets={item.report.buckets}
                  chart="flow"
                  intervalMinutes={intervalMinutes}
                  flowStyle="line"
                  year={item.year}
                />
              </section>
            ))}
          </div>

          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            {[
              {
                label: `${currentDate}の提供時間`,
                report: current,
                year: "current" as const,
              },
              {
                label: `${referenceDate}の提供時間`,
                report: reference,
                year: "previous" as const,
              },
            ].map((item) => (
              <section
                key={item.label}
                className="min-w-0 border-stone-200 border-t pt-6"
              >
                <SectionHeading
                  icon={Clock3}
                  title={item.label}
                  description={`${item.report.total.count}杯の提供記録を比較します。`}
                />
                <div className="mt-5">
                  <DurationCharts
                    stats={item.report.total}
                    hideBoxPlot
                    maximumCount={maximumCount}
                    maximumMinutes={maximumMinutes}
                    year={item.year}
                  />
                </div>
              </section>
            ))}
          </div>

          <p className="border-stone-200 border-t pt-4 text-stone-600 text-xs leading-relaxed">
            並べたグラフの軸範囲は共通です。2025年度は注文単位、選択中の日付はカップ単位の記録です。売上は全商品、杯数はカップを作る商品のみを集計しているため、目安として比較してください。
            {referenceInfo ? ` データ: ${referenceInfo}` : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}

function ComparisonMetric({
  label,
  currentLabel,
  currentValue,
  referenceLabel,
  referenceValue,
  difference,
}: {
  label: string;
  currentLabel: string;
  currentValue: string;
  referenceLabel: string;
  referenceValue: string;
  difference: string;
}) {
  return (
    <article className="border-stone-200 border-t pt-6">
      <p className="font-black text-stone-900">{label}</p>
      <dl className="mt-4 space-y-3 text-sm">
        <div className="flex items-end justify-between gap-3">
          <dt className="text-stone-500">{currentLabel}</dt>
          <dd className="font-black text-2xl text-blue-950 tabular-nums">
            {currentValue}
          </dd>
        </div>
        <div className="flex items-end justify-between gap-3 border-stone-100 border-t pt-3">
          <dt className="text-stone-500">{referenceLabel}</dt>
          <dd className="font-bold text-green-950 text-lg tabular-nums">
            {referenceValue}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-stone-500 text-xs">
        2025年度との差{" "}
        <strong className="font-extrabold text-blue-950">{difference}</strong>
      </p>
    </article>
  );
}

function ComparisonNote({
  reference,
  difference,
}: { reference: string; difference?: string }) {
  return (
    <>
      前年 <strong className="font-bold text-green-950">{reference}</strong>
      {difference && (
        <>
          {" "}
          /{" "}
          <strong className="font-extrabold text-blue-950">{difference}</strong>
        </>
      )}
    </>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
  comparison,
}: {
  icon: typeof Coffee;
  label: string;
  value: string;
  note: string;
  comparison?: ReactNode;
}) {
  return (
    <article className="py-2">
      <div className="flex items-center gap-2 text-stone-600">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="font-bold text-xs sm:text-sm">{label}</p>
      </div>
      <p className="mt-3 font-black text-2xl text-blue-950 tabular-nums tracking-tight sm:text-3xl">
        {value}
      </p>
      <p className="mt-2 text-stone-500 text-xs">{note}</p>
      {comparison && (
        <p className="mt-1 text-[11px] text-stone-500 tabular-nums leading-relaxed">
          {comparison}
        </p>
      )}
    </article>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Coffee;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="pt-1 text-stone-500">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <h3 className="font-black text-lg tracking-tight">{title}</h3>
        <p className="mt-1 text-stone-500 text-xs">{description}</p>
      </div>
    </div>
  );
}

function PaymentRow({
  label,
  amount,
  ratio,
  color,
}: {
  label: string;
  amount: number;
  ratio: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-bold text-sm">{label}</p>
          <p className="mt-1 font-black text-xl tabular-nums">{yen(amount)}</p>
        </div>
        <span className="font-bold text-sm text-stone-500">
          {ratio.toFixed(0)}%
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${ratio}%` }}
        />
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center text-center">
      <span className="p-4 text-stone-500">
        <Radio className="h-7 w-7 animate-pulse" aria-hidden="true" />
      </span>
      <p className="mt-4 font-black">注文データを読み込んでいます</p>
      <p className="mt-1 text-sm text-stone-500">
        接続が完了すると自動的に表示されます。
      </p>
    </div>
  );
}
