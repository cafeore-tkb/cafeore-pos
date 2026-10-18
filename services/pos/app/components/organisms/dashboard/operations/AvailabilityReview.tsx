import { jstClock, useInventory, useMenuMaster } from "@cafeore/common";
import { useState } from "react";
import {
  type AvailabilityObservation,
  availabilityComparison,
  availabilitySchema,
} from "~/lib/analytics/availability";
import type { FlowBucket } from "~/lib/analytics/operations";

export function AvailabilityReview({ buckets }: { buckets: FlowBucket[] }) {
  const { menus, error: menuError, isLoading: menuLoading } = useMenuMaster();
  const { statuses, error, isLoading } = useInventory();
  const [observations, setObservations] = useState<AvailabilityObservation[]>(
    [],
  );
  const [failure, setFailure] = useState("");
  const compared = availabilityComparison(observations, buckets).filter(
    (b) => b.availableMenus !== null,
  );
  return (
    <div className="space-y-5">
      <section className="space-y-2 rounded-xl border p-4">
        <h3 className="font-bold">在庫と棚卸し</h3>
        <p className="text-sm">
          残量は在庫APIの現在値。残り時間は直近1時間の消費が続くと仮定した推定です。棚卸し・入荷は
          <a href="/inventory" className="underline">
            在庫管理
          </a>
          へ。
        </p>
        {isLoading && <p>在庫を読み込み中…</p>}
        {error && <p role="alert">在庫を取得できません。</p>}
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
        {!isLoading && !statuses.length && !error && (
          <p>在庫対象がありません。未計測を残量ゼロとは扱いません。</p>
        )}
      </section>
      <section className="space-y-3 rounded-xl border p-4">
        <h3 className="font-bold">販売可能メニュー数と受注速度</h3>
        <p className="text-sm">
          現在の商品マスタ登録数：
          {menuLoading
            ? "読込中"
            : menuError
              ? "取得不可"
              : `${menus.length}件`}
          。登録数は販売可能数ではありません。販売終了・品切れ・切替の履歴がない期間の販売可能数は未計測です。
        </p>
        <label className="block text-sm">
          販売可能数の変更履歴JSON
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
          各記録の値は次の変更まで有効として時間加重平均。最初の記録より前は補完しません。販売終了・品切れ・切替のたびに記録が必要です。商品数以外にも混雑・停止・商品構成が影響するため、因果関係は断定しません。
        </p>
        {failure && (
          <p role="alert" className="text-red-700">
            {failure}
          </p>
        )}
        {compared.length ? (
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>15分枠</th>
                  <th>販売可能数（時間平均）</th>
                  <th>受注速度</th>
                </tr>
              </thead>
              <tbody>
                {compared.map((b) => (
                  <tr key={b.at} className="border-t">
                    <td className="py-1">{jstClock(b.at).slice(0, 5)}</td>
                    <td>{b.availableMenus?.toFixed(1)}件</td>
                    <td>{b.received}杯/15分</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            この日の比較可能な履歴がありません。現在の登録数を過去の販売可能数として代用しません。
          </p>
        )}
      </section>
    </div>
  );
}
