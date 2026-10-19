/** ホバーできない端末・キーボードでも、グラフの全値を確認する。 */
export function ChartValues({
  columns,
  rows,
}: {
  columns: string[];
  rows: (string | number | null)[][];
}) {
  return (
    <details className="mt-3 text-stone-600 text-xs">
      <summary className="cursor-pointer py-2 font-bold">
        グラフの数値を表で見る
      </summary>
      <div className="max-h-72 overflow-auto">
        <table className="w-full whitespace-nowrap text-left tabular-nums">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col" className="p-2">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row[0]}-${i}`} className="border-t">
                {row.map((v, j) => (
                  <td key={columns[j]} className="p-2">
                    {v === null ? "未計測" : v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
