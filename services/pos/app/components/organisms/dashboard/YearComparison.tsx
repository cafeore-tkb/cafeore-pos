import {
  type ComparisonSettings,
  type compareProductCups,
  comparisonChange,
} from "~/lib/analytics/yearComparison";
import { ComparisonCardBoard } from "./ComparisonCardBoard";

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
        <ComparisonCardBoard
          settings={settings}
          onChange={onChange}
          currentProducts={currentProducts}
          historicalProducts={historicalProducts}
          disabled={disabled || loading}
        />
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
