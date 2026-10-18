import { jstClock, jstDate } from "@cafeore/common";
import { useEffect, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { historicalOrders, load2025Baseline } from "~/lib/analytics/historical";
import {
  type AnalysisOrder,
  availableDays,
  dayWindow,
  liveAnalysisOrders,
  operationsReport,
} from "~/lib/analytics/operations";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";
import { AvailabilityReview } from "./AvailabilityReview";
import { DurationCharts, minutes } from "./DurationCharts";
import { FlowCharts } from "./FlowCharts";
import { LogReview } from "./LogReview";

const MODES = [
  { id: "floor", name: "現場統括" },
  { id: "owner", name: "遠隔オーナー" },
  { id: "handoff", name: "毎時引き継ぎ" },
  { id: "inventory", name: "棚卸し" },
  { id: "review", name: "営業後の振り返り" },
] as const;
type Mode = (typeof MODES)[number]["id"];
const money = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
const signed = (n: number | null) =>
  n === null ? "比較待ち" : `${n > 0 ? "+" : ""}${n}`;

export function OperationsDashboard({
  compact = false,
}: { compact?: boolean }) {
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
  const days = availableDays(orders, now);
  const date = selectedDate || jstDate(now);
  const window = useMemo(() => dayWindow(date, now), [date, now]);
  const report = useMemo(
    () => operationsReport(orders, window),
    [orders, window],
  );
  const handoffEnd = Math.min(
    window.end,
    Math.floor(now / 3_600_000) * 3_600_000,
  );
  const handoffStart = Math.max(window.start, handoffEnd - 3_600_000);
  const handoff = useMemo(
    () =>
      operationsReport(orders, { start: handoffStart, end: handoffEnd, now }),
    [orders, handoffStart, handoffEnd, now],
  );
  const baseline = useMemo(
    () =>
      referenceDate
        ? operationsReport(
            reference,
            dayWindow(
              referenceDate,
              Date.parse(`${referenceDate}T23:59:59.999+09:00`),
            ),
          )
        : null,
    [reference, referenceDate],
  );
  useEffect(() => {
    if (isOrdersLoaded) setSnapshot({ at: Date.now(), orders: orders.length });
  }, [orders, isOrdersLoaded]);
  const last = report.latest;
  const trend = last
    ? last.net > 0
      ? "未提供が増えています"
      : last.net < 0
        ? "未提供を解消しています"
        : "未提供は横ばいです"
    : "完了した15分枠のデータ待ち";
  const loadBaseline = async () => {
    setLoading(true);
    setFailure("");
    try {
      const data = await load2025Baseline();
      setReference(data.orders);
      setReferenceDate(jstDate(data.orders[0].created));
      setReferenceInfo(
        `2025年の実測（注文打刻） / sohosai-analysis ${data.commit.slice(0, 8)}`,
      );
    } catch {
      setFailure("2025年データを読み込めませんでした。");
    } finally {
      setLoading(false);
    }
  };
  const exportFlow = () => {
    const csv = [
      "日時(JST),受注杯数,提供杯数,未提供杯数,キャンセル未提供杯数,未提供増減,混み合い加速度,枠確定",
      ...report.buckets.map((b) =>
        [
          `${date} ${jstClock(b.at)}`,
          b.received,
          b.served,
          b.backlog,
          b.cancelled,
          b.net,
          b.acceleration ?? "",
          b.complete ? "確定" : "途中",
        ].join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `operations-${date}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className={`space-y-5 text-slate-900 ${compact ? "text-sm" : ""}`}>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-xl">店舗運営ダッシュボード</h2>
            <p className="mt-1 text-muted-foreground text-xs">
              注文API・カップ打刻の実測 / JST /
              15分単位。操作履歴・過去の参考値・推定は別表示。
            </p>
          </div>
          <label className="text-sm">
            対象日{" "}
            <select
              className="rounded-md border bg-background p-2"
              aria-label="分析の対象日"
              value={date}
              onChange={(e) => setSelectedDate(e.target.value)}
            >
              {days.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="利用場面">
          {MODES.map((m) => (
            <Button
              key={m.id}
              size="sm"
              variant={mode === m.id ? "default" : "outline"}
              aria-pressed={mode === m.id}
              onClick={() => setMode(m.id)}
            >
              {m.name}
            </Button>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          {!isOrdersLoaded
            ? "注文を読込中…"
            : status === "open"
              ? "注文は接続中・リアルタイム更新"
              : "接続が途切れています。最後に受信した注文を表示しています。"}{" "}
          最終観測{" "}
          {snapshot
            ? `${jstClock(snapshot.at)} / ${snapshot.orders}注文`
            : "未受信"}{" "}
          / 集計時刻 {jstClock(now)}
        </p>
      </header>
      {isOrdersLoaded && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Metric
              label="受注カップ"
              value={`${report.received}杯`}
              note="対象日に受注した全カップ（取消前を含む）"
            />
            <Metric
              label="提供カップ"
              value={`${report.served}杯`}
              note="対象時間帯に提供打刻された杯数（前日受注含む）"
            />
            <Metric
              label="未提供カップ"
              value={`${report.backlog}杯`}
              note={`期首持越し${report.openingBacklog}杯を含む。キャンセル分を除外。`}
            />
            <Metric
              label="売上"
              value={money(report.revenue)}
              note={`受注日基準・キャンセル除外 / ${report.orderCount}注文`}
            />
          </div>
          {mode !== "inventory" && mode !== "review" && (
            <section className="rounded-xl border bg-white p-4">
              <h3 className="font-bold">{trend}</h3>
              <p className="mt-1 text-sm">
                直近の確定枠 {last ? `${jstClock(last.at).slice(0, 5)}〜` : "—"}
                ：未提供 {signed(last?.net ?? null)}杯 / 混み合い加速度{" "}
                {signed(last?.acceleration ?? null)}杯/15分²
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                加速度＝（受注−提供−キャンセル未提供）の前枠との差。プラスは増加側、マイナスは解消側への変化です。加速度がマイナスでも未提供はまだ増える場合があります。集計途中の枠は比較しません。
              </p>
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
                  15分集計CSVを保存
                </button>
              </div>
              <FlowCharts buckets={report.buckets} />
              <p className="text-xs">
                取消注文 {report.cancelledOrders}件 / 時間内の未提供取消{" "}
                {report.cancelledCups}
                杯。流量は受注−提供−取消＝未提供の増減。準備完了だけでは未提供を減らしません。
              </p>
            </section>
          )}
          {mode === "floor" && (
            <section className="rounded-xl border p-4">
              <h3 className="font-bold">先に確認する注文</h3>
              <p className="mt-1 text-sm">
                待ち時間の長い未提供。これから受ける注文の予測提供時間ではありません。
              </p>
              <ul className="mt-3 space-y-2">
                {report.longest.slice(0, 8).map((v, i) => (
                  <li
                    key={`${v.number}:${i}`}
                    className={
                      v.minutes >= 20
                        ? "font-bold text-red-700"
                        : v.minutes >= 15
                          ? "text-amber-800"
                          : ""
                    }
                  >
                    #{String(v.number).padStart(3, "0")} · {v.product} ·{" "}
                    {v.minutes.toFixed(1)}分
                  </li>
                ))}
              </ul>
              {!report.longest.length && (
                <p className="mt-2">未提供カップはありません。</p>
              )}
            </section>
          )}
          {mode === "owner" && (
            <section className="space-y-3 rounded-xl border p-4">
              <h3 className="font-bold">受注と売上の状況</h3>
              <p>
                平均注文単価{" "}
                {report.orderCount
                  ? money(Math.round(report.revenue / report.orderCount))
                  : "未計測"}{" "}
                / 提供時間P90 {minutes(report.total.p90)}
              </p>
              <p className="text-sm">
                売上は注文に記録された請求額です。返金の実行時刻別収支・原価・利益・現金過不足はこの指標に含みません。
                <a className="underline" href="/dashboard">
                  詳細と注文一覧
                </a>
              </p>
            </section>
          )}
          {mode === "handoff" && (
            <section className="space-y-3 rounded-xl border p-4">
              <h3 className="font-bold">確定した直前1時間の引き継ぎ</h3>
              {handoffStart < handoffEnd ? (
                <>
                  <p>
                    {date} {jstClock(handoffStart).slice(0, 5)}〜
                    {jstClock(handoffEnd).slice(0, 5)}
                    （受注日と流量の定義は上と同じ）
                  </p>
                  <p>
                    受注 {handoff.received}杯 / 提供 {handoff.served}杯 /
                    終了時の未提供 {handoff.backlog}杯 / 売上{" "}
                    {money(handoff.revenue)}
                  </p>
                  <p className="text-sm">
                    現在の最長未提供{" "}
                    {minutes(report.longest[0]?.minutes ?? null)}
                    。下の業務連絡と失敗・緊急ログ、棚卸し欄の在庫を確認して引き継いでください。確認済み・解決済みは打刻していないため自動判定しません。
                  </p>
                </>
              ) : (
                <p>対象日の確定した時間枠がまだありません。</p>
              )}
            </section>
          )}
          {(mode === "owner" || mode === "review") && (
            <section className="space-y-4 rounded-xl border bg-white p-4">
              <h3 className="font-bold">提供時間とばらつき</h3>
              <p className="text-muted-foreground text-xs">
                受注日コホート・提供済みの杯のみ。未提供{report.censored}
                杯は右打切りとして分布から除外。時刻逆転{report.invalidTimes}
                杯は異常として保持し、負の所要時間は採用しません。
              </p>
              <DurationCharts stats={report.total} />
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th>商品</th>
                      <th>受注/未提供</th>
                      <th>受注→準備完了 中央値/P90（n）</th>
                      <th>準備完了→提供 中央値/P90（n）</th>
                      <th>受注→提供 中央値/P90（n）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.products.map((p) => (
                      <tr key={p.name} className="border-t">
                        <td className="py-2">{p.name}</td>
                        <td>
                          {p.received}/{p.pending}
                        </td>
                        {[p.prep, p.handoff, p.total].map((s, i) => (
                          <td key={["prep", "handoff", "total"][i]}>
                            {minutes(s.p50)} / {minutes(s.p90)}（{s.count}）
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details>
                <summary className="cursor-pointer">
                  外れ値を確認（{report.outlierCups.length}
                  杯・集計から除外しない）
                </summary>
                <ul className="max-h-52 overflow-y-auto">
                  {report.outlierCups.map((c, i) => (
                    <li key={`${c.orderNo}:${i}`} className="mt-1 text-sm">
                      #{String(c.orderNo).padStart(3, "0")} · {c.product} ·{" "}
                      {minutes(c.minutes)}
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}
          {mode === "inventory" && (
            <AvailabilityReview buckets={report.buckets} />
          )}
          {(mode === "handoff" || mode === "review") && (
            <section className="space-y-4 rounded-xl border p-4">
              <h3 className="font-bold">注文に残った業務連絡</h3>
              <p className="text-muted-foreground text-xs">
                書き手は役割名です。返信やコメント件数で個人の評価・ランキングは行いません。
              </p>
              <ul className="max-h-72 space-y-2 overflow-y-auto">
                {report.comments.slice(0, 100).map((c, i) => (
                  <li
                    key={`${c.at}:${c.orderNo}:${i}`}
                    className="rounded-md bg-stone-50 p-2 text-sm"
                  >
                    <span className="font-bold">
                      #{String(c.orderNo).padStart(3, "0")} · {c.author} ·{" "}
                      {jstClock(c.at)}
                    </span>
                    <p className="whitespace-pre-wrap break-words">{c.text}</p>
                  </li>
                ))}
              </ul>
              {!report.comments.length && (
                <p className="text-sm">
                  対象日に受注した注文のコメントはありません。
                </p>
              )}
              <LogReview start={window.start} end={Math.min(window.end, now)} />
            </section>
          )}
          {(mode === "owner" || mode === "review") && (
            <section className="space-y-3 rounded-xl border p-4">
              <h3 className="font-bold">2025年との比較</h3>
              <p className="text-sm">
                同じ営業日ではないため参考比較です。2025年は注文のready/servedを各杯に展開し、2026年の杯別実打刻とは区別します。売上は全商品、杯数はhot・ice・iceOre・milkのみです。
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  disabled={loading}
                  onClick={() => void loadBaseline()}
                >
                  {loading ? "読込中…" : "2025年の実測を開く"}
                </Button>
                <label className="text-sm">
                  別の2025年注文JSON{" "}
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
                        if (!data.length) throw new Error("注文がありません。");
                        setReference(data);
                        setReferenceDate(jstDate(data[0].created));
                        setReferenceInfo(
                          `2025年の実測（注文打刻） / ${file.name}`,
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
                    {[...new Set(reference.map((o) => jstDate(o.created)))]
                      .sort()
                      .map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                  </select>
                  <div className="grid grid-cols-2 gap-3">
                    <Metric
                      label={`${date} 注文API実測`}
                      value={money(report.revenue)}
                      note={`${report.received}杯 / 総提供時間中央値${minutes(report.total.p50)}`}
                    />
                    <Metric
                      label={`${referenceDate} 2025実測・注文打刻`}
                      value={money(baseline.revenue)}
                      note={`${baseline.received}杯 / 総提供時間中央値${minutes(baseline.total.p50)}`}
                    />
                  </div>
                  <FlowCharts buckets={baseline.buckets} />
                  <DurationCharts stats={baseline.total} />
                </>
              )}
            </section>
          )}
          <details className="rounded-xl border p-4 text-xs">
            <summary className="cursor-pointer font-bold">
              定義・計測範囲・未計測
            </summary>
            <p className="mt-2">
              時刻はJST、枠は開始を含み終了を含まない15分。受注は作るカップだけを数え、グッズ・入れ直しを新しい受注杯に足しません。キャンセル前の受注は流量に残し、未提供分を取消時刻で減らします。提供時間と売上は受注日で集計します。商品構成の編集・提供取消は現行の注文に基づく再集計であり、過去の全打刻履歴の復元ではありません。オフライン時の未受信操作は含みません。
            </p>
            <p className="mt-2">
              未計測：全レジ・提供のUI操作履歴、販売可否の全変更履歴（別途履歴を読込可）、スタッフの本人認証と勤務実時間、作業の難易度、原価・利益。ログ欠落・打刻忘れは起こり得ます。個人評価・因果関係・今後の客足を推測しません。
            </p>
          </details>
        </>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  note,
}: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-bold text-2xl tabular-nums">{value}</p>
      <p className="mt-2 text-muted-foreground text-xs">{note}</p>
    </div>
  );
}
