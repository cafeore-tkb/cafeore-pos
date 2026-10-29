import { useId } from "react";
import {
  type ComparisonSettings,
  type compareProductCups,
  comparisonChange,
} from "~/lib/analytics/yearComparison";

export function YearComparisonSettings({
  settings,
  onChange,
  currentProducts,
  historicalProducts,
  referenceDays,
  referenceDate,
  loading,
  failure,
  storageMessage,
  disabled,
}: {
  settings: ComparisonSettings;
  onChange: (settings: ComparisonSettings) => void;
  currentProducts: { key: string; name: string }[];
  historicalProducts: string[];
  referenceDays: string[];
  referenceDate: string;
  loading: boolean;
  failure: string;
  storageMessage: string;
  disabled: boolean;
}) {
  const listId = useId();
  const groups = [
    ...new Set(
      [
        ...Object.values(settings.current),
        ...Object.values(settings.historical),
      ]
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ].sort();
  return (
    <div className="space-y-2 text-stone-600 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2">
          前年の比較日
          <select
            aria-label="前年の比較日"
            value={referenceDate}
            disabled={disabled || loading || !referenceDays.length}
            onChange={(e) =>
              onChange({ ...settings, referenceDate: e.target.value })
            }
            className="min-h-9 rounded border border-stone-200 bg-white px-2 text-stone-700 disabled:opacity-50"
          >
            {referenceDays.map((date) => (
              <option key={date} value={date}>
                {date}
              </option>
            ))}
          </select>
        </label>
        <span>同じ時間帯・同じ時刻まで比較 / 注文の受信時と10秒ごとに更新</span>
      </div>
      {loading && <output className="block">前年データを読み込み中…</output>}
      {failure && <p role="alert">{failure}</p>}
      <details className="border-stone-100 border-b pb-3">
        <summary className="min-h-9 cursor-pointer py-2 font-medium">
          商品の対応付けを編集
        </summary>
        <p className="mb-3 leading-relaxed">
          比較したい商品に同じグループ名を入力してください。複数商品をまとめられます。空欄は未対応として残します。商品名や区分からの自動判定はしません。
        </p>
        <datalist id={listId}>
          {groups.map((group) => (
            <option key={group} value={group} />
          ))}
        </datalist>
        <div className="grid gap-5 md:grid-cols-2">
          {(["current", "historical"] as const).map((side) => (
            <fieldset key={side} disabled={disabled} className="min-w-0">
              <legend className="mb-2 font-bold text-stone-800">
                {side === "current" ? "今年の商品" : "前年の商品"} →
                比較グループ
              </legend>
              <div className="space-y-2">
                {(side === "current"
                  ? currentProducts
                  : historicalProducts.map((name) => ({ key: name, name }))
                ).map((product) => (
                  <label
                    key={product.key}
                    className="grid grid-cols-2 items-center gap-2"
                  >
                    <span className="break-words">{product.name}</span>
                    <input
                      aria-label={`${side === "current" ? "今年" : "前年"}の${product.name}の比較グループ`}
                      list={listId}
                      value={settings[side][product.key] ?? ""}
                      maxLength={80}
                      placeholder="未対応"
                      autoComplete="off"
                      onChange={(e) =>
                        onChange({
                          ...settings,
                          [side]: {
                            ...settings[side],
                            [product.key]: e.target.value,
                          },
                        })
                      }
                      className="min-h-10 min-w-0 rounded border border-stone-200 bg-white px-2 text-sm text-stone-800"
                    />
                  </label>
                ))}
              </div>
              {side === "current" && currentProducts.length === 0 && (
                <p>今年の商品が読み込まれると表示します。</p>
              )}
            </fieldset>
          ))}
        </div>
        <output className="mt-4 block">
          {storageMessage ||
            "変更はこのブラウザに自動保存します。次回も同じ設定を使います。"}
        </output>
        <p className="mt-1">
          商品別はドリンクの杯数を比較します。前年の請求額は注文単位のため、商品別の売上には割り振りません。
        </p>
      </details>
      {storageMessage && <p role="alert">{storageMessage}</p>}
    </div>
  );
}

export function YearProductComparison({
  data,
}: { data: ReturnType<typeof compareProductCups> }) {
  return (
    <div className="mt-4 text-stone-600 text-xs">
      <p className="font-medium">対応付けた商品の前年比較（杯）</p>
      {data.rows.length > 0 ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left tabular-nums">
            <thead>
              <tr>
                {["比較グループ", "今年", "前年・同時刻まで", "前年差"].map(
                  (name) => (
                    <th scope="col" key={name} className="p-2 font-medium">
                      {name}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.name} className="border-stone-100 border-t">
                  <th scope="row" className="p-2 font-medium">
                    {row.name}
                  </th>
                  <td className="p-2">
                    {row.hasCurrent ? (
                      <strong className="font-extrabold text-blue-950">
                        {row.current}杯
                      </strong>
                    ) : (
                      "未対応"
                    )}
                  </td>
                  <td className="p-2">
                    {row.hasHistorical ? (
                      <strong className="font-bold text-green-950">
                        {row.historical}杯
                      </strong>
                    ) : (
                      "未対応"
                    )}
                  </td>
                  <td className="p-2">
                    {row.hasCurrent && row.hasHistorical ? (
                      <strong className="font-extrabold text-blue-950">
                        {comparisonChange(row.current, row.historical, "杯")}
                      </strong>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2">
          「商品の対応付けを編集」で比較グループを設定すると表示します。
        </p>
      )}
      <p className="mt-2">
        未対応：今年 {data.unmappedCurrent}杯 / 前年 {data.unmappedHistorical}
        杯（全体の売上・杯数には含みます）
      </p>
    </div>
  );
}
