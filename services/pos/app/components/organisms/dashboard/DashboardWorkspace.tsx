import { jstClock, jstDate } from "@cafeore/common";
import {
  Activity,
  Banknote,
  BarChart3,
  CircleDollarSign,
  Clock3,
  Coffee,
  LayoutDashboard,
  ListOrdered,
  Radio,
  ReceiptText,
  ShoppingBag,
  Timer,
  WalletCards,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  type BucketMinutes,
  dayWindow,
  liveAnalysisOrders,
  operationsReport,
} from "~/lib/analytics/operations";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";
import { OrderList } from "./OrderList";
import { DurationCharts, minutes } from "./operations/DurationCharts";
import { DurationTrend } from "./operations/DurationTrend";
import { FlowCharts } from "./operations/FlowCharts";
import { ProductTimeChart } from "./operations/OverviewVisuals";

const SECTIONS = [
  {
    id: "overview",
    name: "概要",
    description: "営業状況をひと目で確認",
    icon: LayoutDashboard,
  },
  {
    id: "sales",
    name: "売上",
    description: "金額と決済の内訳",
    icon: Banknote,
  },
  {
    id: "details",
    name: "詳細",
    description: "注文ごとの記録",
    icon: ListOrdered,
  },
  {
    id: "analysis",
    name: "分析",
    description: "流量と提供時間のグラフ",
    icon: BarChart3,
  },
] as const;

type DashboardSection = (typeof SECTIONS)[number]["id"];
const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;
const squarePaymentLabel = (type: string) => {
  if (type === "CARD_PRESENT") return "カード";
  if (type === "QR_CODE") return "QRコード";
  if (type === "unknown") return "決済種別の記録なし";
  return "その他のSquare決済";
};

export function DashboardWorkspace() {
  const {
    allOrders,
    orders: activeOrders,
    isOrdersLoaded,
    status,
  } = useOrdersWSContext();
  const [now, setNow] = useState(() => Date.now());
  const [selectedDate, setSelectedDate] = useState(() => jstDate(Date.now()));
  const [section, setSection] = useState<DashboardSection>("overview");
  const [intervalMinutes, setIntervalMinutes] = useState<BucketMinutes>(15);
  const tabId = useId();

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  const sourceOrders = allOrders ?? activeOrders ?? [];
  const window = useMemo(
    () => dayWindow(selectedDate, now),
    [selectedDate, now],
  );
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
  const finance = useMemo(() => {
    const validOrders = selectedOrders.filter((order) => {
      const cancelledAt = order.cancelledAt?.getTime();
      return cancelledAt == null || cancelledAt >= cutoff;
    });
    let cash = 0;
    let square = 0;
    const squareByType = new Map<string, number>();
    const addSquare = (amount: number, paymentType?: string) => {
      square += amount;
      const key = paymentType ?? "unknown";
      squareByType.set(key, (squareByType.get(key) ?? 0) + amount);
    };
    for (const order of validOrders) {
      if (order.payments.length > 0) {
        for (const payment of order.payments) {
          if (payment.method === "square")
            addSquare(payment.amount, payment.squarePaymentType);
          else cash += payment.amount;
        }
      } else if (order.paymentMethod === "square") {
        addSquare(order.billingAmount);
      } else {
        cash += order.billingAmount;
      }
    }
    const hourly = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      revenue: 0,
      orders: 0,
    }));
    for (const order of validOrders) {
      const hour = Number(jstClock(order.createdAt.getTime()).slice(0, 2));
      hourly[hour].revenue += order.billingAmount;
      hourly[hour].orders++;
    }
    const activeHours = hourly.filter(
      (item, index) =>
        item.revenue > 0 ||
        item.orders > 0 ||
        (selectedDate === jstDate(now) &&
          index === Number(jstClock(now).slice(0, 2))),
    );
    return {
      cash,
      square,
      squareDetails: [...squareByType.entries()]
        .map(([type, amount]) => ({
          type,
          label: squarePaymentLabel(type),
          amount,
        }))
        .sort((a, b) => b.amount - a.amount),
      discount: validOrders.reduce((sum, order) => sum + order.discount, 0),
      cancelled: selectedOrders.length - validOrders.length,
      average:
        validOrders.length > 0
          ? Math.round(report.revenue / validOrders.length)
          : 0,
      hourly: activeHours.length > 0 ? activeHours : hourly.slice(8, 19),
      peak: [...hourly].sort((a, b) => b.revenue - a.revenue)[0],
    };
  }, [selectedOrders, cutoff, report.revenue, selectedDate, now]);

  const selectedSection =
    SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];
  const live = isOrdersLoaded && status === "open";

  return (
    <div className="min-h-full bg-stone-100 p-2 text-stone-900 sm:p-4 lg:p-6">
      <div className="mx-auto max-w-[1600px] overflow-hidden rounded-[2rem] border border-stone-200 bg-[#f8f7f3] shadow-[0_24px_80px_-46px_rgba(28,25,23,0.55)]">
        <header className="relative overflow-hidden bg-teal-950 px-4 py-6 text-white sm:px-7 lg:px-9 lg:py-8">
          <div
            className="-top-24 -right-16 pointer-events-none absolute h-72 w-72 rounded-full bg-teal-400/20 blur-3xl"
            aria-hidden="true"
          />
          <div
            className="-bottom-28 pointer-events-none absolute left-1/3 h-56 w-56 rounded-full bg-sky-400/10 blur-3xl"
            aria-hidden="true"
          />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-bold text-[11px] text-teal-200 uppercase tracking-[0.24em]">
                Cafe Operations
              </p>
              <h1 className="mt-2 font-black text-3xl tracking-tight sm:text-4xl">
                ダッシュボード
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-teal-100/75">
                売上、注文、提供状況をひとつの画面から確認できます。
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1">
                <span className="block font-bold text-[11px] text-teal-100">
                  表示する日
                </span>
                <input
                  type="date"
                  max={jstDate(now)}
                  value={selectedDate}
                  onChange={(event) => {
                    if (event.target.value) setSelectedDate(event.target.value);
                  }}
                  className="min-h-11 rounded-xl border border-white/15 bg-white/10 px-3 font-bold text-sm text-white shadow-inner outline-none [color-scheme:dark] focus:border-teal-300"
                />
              </label>
              <div className="rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 backdrop-blur">
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
                <p className="mt-1 text-[10px] text-teal-100/65">
                  現在 {jstClock(now).slice(0, 5)}
                </p>
              </div>
            </div>
          </div>
        </header>

        <nav
          className="grid grid-cols-2 gap-2 border-stone-200 border-b bg-white p-2 sm:grid-cols-4 sm:p-3"
          role="tablist"
          aria-label="ダッシュボードの表示"
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
                onClick={() => setSection(item.id)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % SECTIONS.length
                      : event.key === "ArrowLeft"
                        ? (index + SECTIONS.length - 1) % SECTIONS.length
                        : null;
                  if (next === null) return;
                  event.preventDefault();
                  const nextSection = SECTIONS[next];
                  setSection(nextSection.id);
                  document
                    .getElementById(`${tabId}-tab-${nextSection.id}`)
                    ?.focus();
                }}
                className={`group flex min-h-16 items-center gap-3 rounded-2xl px-3 py-3 text-left transition sm:px-4 ${selected ? "bg-teal-950 text-white shadow-lg shadow-teal-950/15" : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"}`}
              >
                <span
                  className={`rounded-xl p-2 ${selected ? "bg-white/10 text-teal-200" : "bg-stone-100 text-stone-500 group-hover:bg-white"}`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block font-black text-sm">{item.name}</span>
                  <span
                    className={`mt-0.5 hidden truncate text-[10px] sm:block lg:text-xs ${selected ? "text-teal-100/70" : "text-stone-400"}`}
                  >
                    {item.description}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <main
          role="tabpanel"
          id={`${tabId}-panel`}
          aria-labelledby={`${tabId}-tab-${section}`}
          className="min-w-0 p-3 sm:p-5 lg:p-7"
        >
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-bold text-[11px] text-teal-700 uppercase tracking-[0.18em]">
                {selectedDate === jstDate(now) ? "Today" : "Archive"}
              </p>
              <h2 className="mt-1 font-black text-2xl tracking-tight">
                {selectedSection.name}
              </h2>
            </div>
            <p className="rounded-full border border-stone-200 bg-white px-4 py-2 text-stone-500 text-xs shadow-sm">
              {selectedDate} 00:00〜
              {selectedDate === jstDate(now)
                ? jstClock(now).slice(0, 5)
                : "24:00"}
            </p>
          </div>

          {!isOrdersLoaded ? (
            <LoadingState />
          ) : section === "overview" ? (
            <OverviewSection report={report} />
          ) : section === "sales" ? (
            <SalesSection report={report} finance={finance} />
          ) : section === "details" ? (
            <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
              <SectionHeading
                icon={ReceiptText}
                title="注文一覧"
                description="注文番号、商品、状態から記録を探し、詳細を確認できます。"
              />
              <div className="mt-5">
                <OrderList orders={selectedOrders} />
              </div>
            </section>
          ) : (
            <AnalysisSection
              report={report}
              intervalMinutes={intervalMinutes}
              onIntervalChange={setIntervalMinutes}
            />
          )}
        </main>
      </div>
    </div>
  );
}

type Report = ReturnType<typeof operationsReport>;
type Finance = {
  cash: number;
  square: number;
  squareDetails: { type: string; label: string; amount: number }[];
  discount: number;
  cancelled: number;
  average: number;
  hourly: { hour: number; label: string; revenue: number; orders: number }[];
  peak: { hour: number; label: string; revenue: number; orders: number };
};

function OverviewSection({ report }: { report: Report }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          icon={Banknote}
          label="売上"
          value={yen(report.revenue)}
          note="取消を除く注文金額"
          tone="emerald"
        />
        <MetricCard
          icon={ShoppingBag}
          label="注文"
          value={`${report.orderCount}件`}
          note={`取消 ${report.cancelledOrders}件`}
          tone="sky"
        />
        <MetricCard
          icon={Coffee}
          label="提供済み杯数"
          value={`${report.served}杯`}
          note={`注文 ${report.received}杯`}
          tone="indigo"
        />
        <MetricCard
          icon={Timer}
          label="お渡し待ち"
          value={`${report.backlog}杯`}
          note={
            report.longest[0]
              ? `最長 ${report.longest[0].minutes.toFixed(1)}分`
              : "待ちはありません"
          }
          tone={report.backlog > 0 ? "orange" : "emerald"}
        />
      </div>
    </div>
  );
}

function SalesSection({
  report,
  finance,
}: {
  report: Report;
  finance: Finance;
}) {
  const paymentTotal = finance.cash + finance.square;
  const cashRatio = paymentTotal > 0 ? (finance.cash / paymentTotal) * 100 : 0;
  const squareRatio =
    paymentTotal > 0 ? (finance.square / paymentTotal) * 100 : 0;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          icon={CircleDollarSign}
          label="売上"
          value={yen(report.revenue)}
          note={`${report.orderCount}件の注文`}
          tone="emerald"
        />
        <MetricCard
          icon={ReceiptText}
          label="客単価"
          value={yen(finance.average)}
          note="注文1件あたり"
          tone="sky"
        />
        <MetricCard
          icon={Banknote}
          label="現金"
          value={yen(finance.cash)}
          note={`売上の ${cashRatio.toFixed(0)}%`}
          tone="orange"
        />
        <MetricCard
          icon={WalletCards}
          label="Square"
          value={yen(finance.square)}
          note={`売上の ${squareRatio.toFixed(0)}%`}
          tone="indigo"
        />
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.7fr)]">
        <section className="min-w-0 rounded-3xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
          <SectionHeading
            icon={Activity}
            title="時間帯別の売上"
            description="注文を受けた時間ごとの売上金額です。"
          />
          <div className="mt-5 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={finance.hourly}
                margin={{ top: 12, right: 8, left: 8, bottom: 0 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) =>
                    value >= 1000 ? `${value / 1000}千` : String(value)
                  }
                  width={42}
                />
                <Tooltip
                  formatter={(value: number, name: string) =>
                    name === "売上" ? [yen(value), name] : [value, name]
                  }
                  cursor={{ fill: "#f5f5f4" }}
                />
                <Bar
                  dataKey="revenue"
                  name="売上"
                  fill="#0f766e"
                  radius={[7, 7, 0, 0]}
                  maxBarSize={46}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-stone-500 text-xs">
            売上が最も多い時間帯: {finance.peak.label}〜・
            {yen(finance.peak.revenue)}
          </p>
        </section>

        <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
          <SectionHeading
            icon={WalletCards}
            title="決済の内訳"
            description="個別会計も支払いごとに集計します。"
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
              <div className="space-y-2 rounded-2xl bg-indigo-50/70 p-3">
                <p className="font-bold text-indigo-950 text-xs">
                  Square決済の内訳
                </p>
                <dl className="space-y-2">
                  {finance.squareDetails.map((payment) => (
                    <div
                      key={payment.type}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <dt className="text-indigo-900/70">{payment.label}</dt>
                      <dd className="font-bold tabular-nums">
                        {yen(payment.amount)}
                        <span className="ml-2 font-normal text-[10px] text-indigo-900/55">
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
          <p className="mt-5 rounded-xl bg-stone-50 p-3 text-stone-500 text-xs leading-relaxed">
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
  onIntervalChange,
}: {
  report: Report;
  intervalMinutes: BucketMinutes;
  onIntervalChange: (minutes: BucketMinutes) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
        <div>
          <p className="font-bold text-sm">集計間隔</p>
          <p className="mt-1 text-stone-500 text-xs">
            グラフの時間単位を切り替えます。
          </p>
        </div>
        <fieldset
          className="inline-flex rounded-xl bg-stone-100 p-1"
          aria-label="分析グラフの集計間隔"
        >
          {([15, 30, 60] as const).map((minutes) => (
            <button
              key={minutes}
              type="button"
              aria-pressed={intervalMinutes === minutes}
              onClick={() => onIntervalChange(minutes)}
              className={`min-h-10 rounded-lg px-4 font-bold text-xs transition ${intervalMinutes === minutes ? "bg-teal-950 text-white shadow-sm" : "text-stone-500 hover:bg-white hover:text-stone-900"}`}
            >
              {minutes}分
            </button>
          ))}
        </fieldset>
      </div>
      <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
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
          />
        </div>
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
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

      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <section className="min-w-0 rounded-3xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
          <SectionHeading
            icon={BarChart3}
            title="提供時間の分布"
            description={`中央値 ${minutes(report.total.p50)}・90%が ${minutes(report.total.p90)} 以内`}
          />
          <div className="mt-5">
            <DurationCharts stats={report.total} hideBoxPlot />
          </div>
        </section>
        <section className="min-w-0 rounded-3xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
          <SectionHeading
            icon={Coffee}
            title="商品ごとの提供時間"
            description="商品ごとの中央値を比較します。"
          />
          <div className="mt-5">
            <ProductTimeChart products={report.products} />
          </div>
        </section>
      </div>
    </div>
  );
}

const METRIC_TONES = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
  sky: "border-sky-200 bg-sky-50 text-sky-950",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-950",
  orange: "border-orange-200 bg-orange-50 text-orange-950",
} as const;

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
  tone,
}: {
  icon: typeof Coffee;
  label: string;
  value: string;
  note: string;
  tone: keyof typeof METRIC_TONES;
}) {
  return (
    <article
      className={`relative overflow-hidden rounded-3xl border p-4 shadow-sm sm:p-5 ${METRIC_TONES[tone]}`}
    >
      <div
        className="-top-10 -right-10 absolute h-28 w-28 rounded-full bg-white/45"
        aria-hidden="true"
      />
      <div className="relative flex items-center justify-between gap-2">
        <p className="font-bold text-xs sm:text-sm">{label}</p>
        <span className="rounded-xl bg-white/65 p-2 shadow-sm">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <p className="relative mt-4 font-black text-2xl tabular-nums tracking-tight sm:text-3xl">
        {value}
      </p>
      <p className="relative mt-2 text-[11px] opacity-70 sm:text-xs">{note}</p>
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
      <span className="rounded-xl bg-teal-50 p-2.5 text-teal-800">
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
    <div className="flex min-h-80 flex-col items-center justify-center rounded-3xl border border-stone-200 bg-white text-center shadow-sm">
      <span className="rounded-2xl bg-teal-50 p-4 text-teal-700">
        <Radio className="h-7 w-7 animate-pulse" aria-hidden="true" />
      </span>
      <p className="mt-4 font-black">注文データを読み込んでいます</p>
      <p className="mt-1 text-sm text-stone-500">
        接続が完了すると自動的に表示されます。
      </p>
    </div>
  );
}
