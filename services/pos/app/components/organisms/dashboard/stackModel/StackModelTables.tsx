import type { AccuracyRow, StackModelView } from "~/lib/analytics/stackModel";

const METHOD_NAMES: Record<AccuracyRow["method"], string> = {
  fit: "この当てはめ",
  fixed: "固定モデル",
  mean: "一律に平均",
};

const minutesCell = (value: number | null, missing: string) =>
  value === null ? missing : value.toFixed(2);

export function StackModelTables({ view }: { view: StackModelView }) {
  return (
    <div className="grid min-w-0 gap-8 xl:grid-cols-2">
      <div className="min-w-0">
        <h4 className="font-bold">精度の要約</h4>
        <p className="mt-1 text-stone-500 text-xs">
          当てはめに使った注文で、予測のしかたごとに比べます。単位は分です。
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-sm tabular-nums">
            <thead className="text-stone-600 text-xs">
              <tr>
                <th scope="col" className="p-2">
                  予測のしかた
                </th>
                <th scope="col" className="p-2">
                  件数
                </th>
                <th scope="col" className="p-2">
                  平均残差（分、実測 − 予測。正なら予測より遅い）
                </th>
                <th scope="col" className="p-2">
                  平均絶対誤差（分）
                </th>
                <th scope="col" className="p-2">
                  絶対誤差の中央値（分）
                </th>
              </tr>
            </thead>
            <tbody>
              {view.accuracy.map((row) => {
                const missing =
                  row.method === "fit" && !view.fit.ok ? "当てはめ不能" : "–";
                return (
                  <tr key={row.method} className="border-t">
                    <th scope="row" className="p-2 font-bold">
                      {METHOD_NAMES[row.method]}
                    </th>
                    <td className="p-2">{row.n}</td>
                    <td className="p-2">
                      {minutesCell(row.meanResidual, missing)}
                    </td>
                    <td className="p-2">{minutesCell(row.mae, missing)}</td>
                    <td className="p-2">
                      {minutesCell(row.medianAbsError, missing)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="min-w-0">
        <h4 className="font-bold">stack の区間ごとの提供時間</h4>
        <p className="mt-1 text-stone-500 text-xs">
          当てはめに使った注文を stack 2
          杯ごとに区切ります。予測は区間の中央の値です。単位は分です。
        </p>
        <div className="mt-3 max-h-96 overflow-auto">
          <table className="w-full whitespace-nowrap text-left text-sm tabular-nums">
            <thead className="text-stone-600 text-xs">
              <tr>
                <th scope="col" className="p-2">
                  stack（杯）
                </th>
                <th scope="col" className="p-2">
                  件数
                </th>
                <th scope="col" className="p-2">
                  10%点
                </th>
                <th scope="col" className="p-2">
                  中央値
                </th>
                <th scope="col" className="p-2">
                  90%点
                </th>
                <th scope="col" className="p-2">
                  予測（当てはめ）
                </th>
                <th scope="col" className="p-2">
                  予測（固定）
                </th>
              </tr>
            </thead>
            <tbody>
              {view.bins.map((bin) => (
                <tr key={bin.lo} className="border-t">
                  <th scope="row" className="p-2 font-bold">
                    {bin.lo}〜{bin.hi}
                  </th>
                  <td className="p-2">{bin.n}</td>
                  <td className="p-2">{minutesCell(bin.p10, "–")}</td>
                  <td className="p-2">{minutesCell(bin.median, "–")}</td>
                  <td className="p-2">{minutesCell(bin.p90, "–")}</td>
                  <td className="p-2">
                    {minutesCell(bin.predictedFit, "当てはめ不能")}
                  </td>
                  <td className="p-2">{bin.predictedFixed.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!view.bins.length && (
            <p className="p-2 text-stone-500 text-xs">
              当てはめに使える注文がまだありません。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
