import { jstClock, useInventory, useMenuMaster } from "@cafeore/common";
import { useState } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  type AvailabilityObservation,
  availabilityComparison,
  availabilitySchema,
} from "~/lib/analytics/availability";
import type { BucketMinutes, FlowBucket } from "~/lib/analytics/operations";

export function AvailabilityReview({
  buckets,
  intervalMinutes = 15,
}: { buckets: FlowBucket[]; intervalMinutes?: BucketMinutes }) {
  const { menus, error: menuError, isLoading: menuLoading } = useMenuMaster();
  const { statuses, error, isLoading } = useInventory();
  const [observations, setObservations] = useState<AvailabilityObservation[]>(
    [],
  );
  const [failure, setFailure] = useState("");
  const compared = availabilityComparison(
    observations,
    buckets,
    intervalMinutes,
  ).filter((b) => b.availableMenus !== null);
  return (
    <div className="space-y-5">
      <section className="space-y-2 rounded-xl border p-4">
        <h3 className="font-bold">いまの在庫</h3>
        <p className="text-sm">
          在庫は現在の値です。過去の期間を選んでも変わりません。数え直し・入荷は
          <a href="/inventory" className="underline">
            在庫管理
          </a>
          へ。
        </p>
        {isLoading && <p>在庫を読み込み中…</p>}
        {error && <p role="alert">在庫を取得できません。</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {statuses.map((stock) => (
            <div
              key={stock.resource.id}
              className={`rounded-2xl border p-4 ${stock.level === "critical" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-teal-100 bg-teal-50 text-teal-950"}`}
            >
              <h4 className="font-bold text-sm">{stock.resource.name}</h4>
              <p className="mt-2 font-bold text-2xl tabular-nums">
                {stock.remaining_servings === null ||
                stock.remaining_servings === undefined
                  ? "未確認"
                  : `約${Math.max(0, stock.remaining_servings).toFixed(0)}杯分`}
              </p>
              <p className="mt-1 text-xs">
                {stock.level === "critical" ? "残量に注意" : "現在の残量"} ／{" "}
                {stock.remaining === null || stock.remaining === undefined
                  ? "量は未確認"
                  : `${stock.remaining.toFixed(1)}${stock.resource.unit}`}
              </p>
            </div>
          ))}
        </div>
        <details>
          <summary className="cursor-pointer text-sm">在庫の詳しい記録</summary>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>対象</th>
                  <th>残量</th>
                  <th>残り回数</th>
                  <th>推定残り時間</th>
                  <th>最終棚卸し</th>
                </tr>
              </thead>
              <tbody>
                {statuses.map((s) => (
                  <tr
                    key={s.resource.id}
                    className={`border-t ${s.level === "critical" ? "text-red-700" : ""}`}
                  >
                    <td className="py-2">{s.resource.name}</td>
                    <td>
                      {s.remaining === null || s.remaining === undefined
                        ? "未計測"
                        : `${s.remaining.toFixed(1)}${s.resource.unit}`}
                    </td>
                    <td>{s.remaining_servings?.toFixed(1) ?? "未計測"}</td>
                    <td>
                      {s.remaining_servings !== null &&
                      s.remaining_servings !== undefined &&
                      s.servings_last_hour > 0
                        ? `推定 ${Math.max(0, s.remaining_servings / s.servings_last_hour).toFixed(1)}時間`
                        : "推定不可"}
                    </td>
                    <td>
                      {s.counted_at
                        ? new Date(s.counted_at).toLocaleString("ja-JP", {
                            timeZone: "Asia/Tokyo",
                          })
                        : "未計測"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        {!isLoading && !statuses.length && !error && (
          <p>在庫の記録がありません。残りゼロという意味ではありません。</p>
        )}
      </section>
      <section className="space-y-3 rounded-xl border p-4">
        <h3 className="font-bold">メニュー数と注文の量</h3>
        <p className="text-sm">
          登録しているメニュー：
          {menuLoading
            ? "読込中"
            : menuError
              ? "取得不可"
              : `${menus.length}件`}
          。実際に売れた品数とは異なります。品切れなどの記録がある時間だけ比較します。
        </p>
        <label className="block text-sm">
          売れるメニュー数の記録を開く
          <input
            type="file"
            className="ml-2 max-w-60"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                setObservations(
                  availabilitySchema.parse(JSON.parse(await file.text())),
                );
                setFailure("");
              } catch {
                setFailure(
                  "日時付きの販売可能数配列を選んでください。形式は下の例を参照してください。",
                );
              }
              e.target.value = "";
            }}
          />
        </label>
        <code className="block break-all text-xs">
          {'[{"at":"2026-11-01T09:00:00+09:00","availableMenus":8}]'}
        </code>
        <p className="text-muted-foreground text-xs">
          記録は次の変更まで続くものとして平均します。記録がない時間は埋めません。メニュー数だけが注文の増減の原因とは限りません。
        </p>
        {failure && (
          <p role="alert" className="text-red-700">
            {failure}
          </p>
        )}
        {compared.length ? (
          <div className="space-y-3">
            <div
              className="h-64"
              aria-label={`売れるメニュー数と${intervalMinutes}分ごとの注文杯数の関係`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ bottom: 12, right: 20 }}>
                  <CartesianGrid stroke="#e7e5e4" strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="availableMenus"
                    name="売れるメニュー"
                    unit="品"
                  />
                  <YAxis
                    type="number"
                    dataKey="received"
                    name={`${intervalMinutes}分の注文`}
                    unit="杯"
                  />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                  <Scatter
                    data={compared}
                    fill="#0d9488"
                    isAnimationActive={false}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <details>
              <summary className="cursor-pointer text-sm">
                時間ごとの数値を見る
              </summary>
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th>{intervalMinutes}分枠</th>
                      <th>売れる品数（平均）</th>
                      <th>{intervalMinutes}分の注文</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compared.map((b) => (
                      <tr key={b.at} className="border-t">
                        <td className="py-1">{jstClock(b.at).slice(0, 5)}</td>
                        <td>{b.availableMenus?.toFixed(1)}件</td>
                        <td>
                          {b.received}杯/{intervalMinutes}分
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            この期間の品切れ・切替の記録がありません。現在の登録数では代用しません。
          </p>
        )}
      </section>
    </div>
  );
}
