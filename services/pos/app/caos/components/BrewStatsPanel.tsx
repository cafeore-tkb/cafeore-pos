import {
  apiClient,
  jstClock,
  jstDate,
  useCaosBrewModel,
  useCaosBrewRecords,
} from "@cafeore/common";
import { useState } from "react";

const kinds: Record<string, string> = {
  hot1: "ホット1杯",
  hot2: "ホット2杯",
  ice1: "アイス1杯",
  ice2: "アイス2杯",
};
const reasons: Record<string, string> = {
  rebrew: "淹れ直し",
  unknown_type: "種類不明",
  mixed_type: "ホット・アイス混合",
  invalid_cups: "杯数不正",
  duplicate_cups: "杯の重複",
  changed_cups: "抽出中に杯数変更",
  late_merge: "抽出中に統合",
  restarted_or_moved: "開始やり直し・移動",
  missing_start: "開始記録なし",
  non_next_finish: "通常の完了操作以外",
  duration_outlier: "時間の外れ値（60秒未満・900秒超）",
  assignee_changed: "途中交代",
  inconsistent_finish: "終了情報の不整合",
  inconsistent_dripper: "列の不整合",
  unknown_assignee: "担当者・学年不明",
  delayed_operation: "遅延送信",
};

export function BrewStatsPanel() {
  const [day, setDay] = useState(() => jstDate(Date.now()));
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportSuccess, setExportSuccess] = useState("");
  const { model } = useCaosBrewModel();
  const { data, error, isLoading } = useCaosBrewRecords(day, offset);
  const rows = data?.entries ?? [];
  const completed = rows.filter(
    (row) => row.actual_seconds !== null && !row.excluded_reason,
  );
  const mae = completed.length
    ? completed.reduce(
        (sum, row) =>
          sum + Math.abs((row.actual_seconds ?? 0) - row.predicted_seconds),
        0,
      ) / completed.length
    : null;
  const fixedMae = completed.length
    ? completed.reduce(
        (sum, row) =>
          sum +
          Math.abs(
            (row.actual_seconds ?? 0) - (row.kind.endsWith("2") ? 360 : 300),
          ),
        0,
      ) / completed.length
    : null;
  const exportDay = async () => {
    setExporting(true);
    setExportError("");
    setExportSuccess("");
    try {
      const entries = [];
      let snapshot: string | undefined;
      for (let page = 0; ; page += 500) {
        const result = await apiClient.GET("/api/caos/brew-records", {
          params: {
            query: { day, offset: page, limit: 500, snapshot_at: snapshot },
          },
        });
        if (!result.response.ok || !result.data)
          throw new Error("抽出実績を書き出せませんでした");
        snapshot = result.data.snapshot_at;
        entries.push(...result.data.entries);
        if (!result.data.has_more) break;
      }
      const url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              { day, exported_at: new Date().toISOString(), entries },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `caos-brew-${day}.json`;
      anchor.click();
      setExportSuccess(`${day}の${entries.length}件を書き出しました。`);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "書き出しに失敗しました");
    } finally {
      setExporting(false);
    }
  };
  return (
    <section className="space-y-3 rounded-xl border border-slate-300 bg-white p-3 text-slate-900">
      <h2 className="font-black text-lg">抽出終了の予測と実績</h2>
      <p className="text-slate-600 text-xs">
        「次へ」が押されるまでの時間です。開始時の予測を保存し、完了後も同じ値と比較します。
      </p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {Object.entries(kinds).map(([kind, label]) => (
          <div key={kind} className="rounded-lg bg-slate-100 p-2">
            <div className="text-xs">{label}の店舗基準</div>
            <strong>
              {Math.round(
                model?.standards[kind]?.standard_seconds ??
                  (kind.endsWith("2") ? 360 : 300),
              )}
              秒
            </strong>
            <span className="ml-2 text-xs">
              {model?.standards[kind]?.standard_samples ?? 0}件
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          記録の日付{" "}
          <input
            aria-label="抽出実績の日付"
            type="date"
            value={day}
            onChange={(event) => {
              setDay(event.target.value);
              setOffset(0);
            }}
            className="min-h-11 rounded border p-2"
          />
        </label>
        <button
          type="button"
          onClick={() => void exportDay()}
          disabled={exporting || !day}
          className="min-h-11 rounded border px-3 text-sm disabled:opacity-50"
        >
          {exporting ? "書き出し中…" : "この日のJSONを書き出す"}
        </button>
      </div>
      {exportSuccess && (
        <output className="block text-sm">{exportSuccess}</output>
      )}
      {(error || exportError) && (
        <p role="alert" className="text-red-700 text-sm">
          {exportError ||
            "抽出実績を取得できませんでした。接続と権限を確認してください。"}
        </p>
      )}
      {isLoading && <p className="text-sm">読み込み中…</p>}
      <p className="text-slate-600 text-xs">
        表示中の{rows.length}件：採用完了 {completed.length}件、除外{" "}
        {rows.filter((row) => row.excluded_reason).length}件。平均絶対誤差{" "}
        {mae === null ? "—" : `${mae.toFixed(0)}秒`}（固定300/360秒なら{" "}
        {fixedMae === null ? "—" : `${fixedMae.toFixed(0)}秒`}）。
      </p>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-xs">
          <caption className="sr-only">
            抽出開始時の店舗基準、個人係数、予測秒数と実測秒数
          </caption>
          <thead>
            <tr>
              {[
                "開始（日本時間）",
                "列・担当者",
                "種類",
                "店舗基準（秒）",
                "個人係数",
                "予測（秒）",
                "実測（秒）",
                "差（実測−予測・秒）",
                "採用・除外理由",
              ].map((label) => (
                <th key={label} className="border-b p-2">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.drip_id}:${row.started_at}`}>
                <td className="border-b p-2">
                  {jstClock(Date.parse(row.started_at))}
                </td>
                <td className="border-b p-2">
                  {row.dripper} {row.name || "担当者不明"} {row.grade}
                </td>
                <td className="border-b p-2">
                  {kinds[row.kind] ?? "種類不明"}
                </td>
                <td className="border-b p-2">
                  {row.standard_seconds.toFixed(0)}
                </td>
                <td className="border-b p-2">
                  {row.coefficient.toFixed(2)}（{row.person_samples}件）
                </td>
                <td className="border-b p-2">
                  {row.predicted_seconds.toFixed(0)}
                </td>
                <td className="border-b p-2">
                  {row.actual_seconds?.toFixed(0) ?? "抽出中・中断"}
                </td>
                <td className="border-b p-2">
                  {row.actual_seconds === null
                    ? "—"
                    : (row.actual_seconds - row.predicted_seconds).toFixed(0)}
                </td>
                <td className="border-b p-2">
                  {row.excluded_reason
                    ? (reasons[row.excluded_reason] ?? row.excluded_reason)
                    : row.actual_seconds === null
                      ? "抽出中"
                      : "全体に採用"}
                  {row.person_excluded_reason
                    ? `／個人は除外：${reasons[row.person_excluded_reason] ?? row.person_excluded_reason}`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && !error && rows.length === 0 && (
          <p className="p-3 text-slate-500 text-sm">
            この日の抽出記録はありません。
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 100))}
          className="min-h-11 rounded border px-3 disabled:opacity-50"
        >
          前へ
        </button>
        <button
          type="button"
          disabled={!data?.has_more}
          onClick={() => setOffset(offset + 100)}
          className="min-h-11 rounded border px-3 disabled:opacity-50"
        >
          次へ
        </button>
      </div>
    </section>
  );
}
