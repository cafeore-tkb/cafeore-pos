import { comparisonBoard, settingsFromBoard } from "./comparisonBoard";
import preset2026 from "./data/comparison-2026.json";
import { emptyComparisonSettings } from "./yearComparison";

/** 年度別の初期値。ユーザーの保存設定へのマイグレーションには使わない。 */
export function comparisonDefaults(
  year: string,
  currentProducts: readonly { key: string; name: string }[],
  historicalProducts: readonly string[],
) {
  if (year !== "2026" || !currentProducts.length || !historicalProducts.length)
    return null;
  const board = comparisonBoard(
    emptyComparisonSettings(),
    currentProducts.map((p) => p.key),
    historicalProducts,
  );
  for (const [index, row] of preset2026.entries()) {
    const matches = currentProducts.filter((p) => p.name === row.current);
    // 同名の商品が複数ある場合や、まだ一覧にない商品は推測しない。
    if (
      matches.length !== 1 ||
      !row.historical.every((name) => historicalProducts.includes(name))
    )
      continue;
    board.groups.push({
      id: `preset-2026-${index + 1}`,
      current: [matches[0].key],
      historical: [...row.historical],
    });
  }
  if (!board.groups.length) return null;
  const usedCurrent = new Set(board.groups.flatMap((g) => g.current));
  const usedHistorical = new Set(board.groups.flatMap((g) => g.historical));
  board.pendingCurrent = board.pendingCurrent.filter(
    (key) => !usedCurrent.has(key),
  );
  board.pendingHistorical = board.pendingHistorical.filter(
    (key) => !usedHistorical.has(key),
  );
  return settingsFromBoard(
    emptyComparisonSettings(),
    board,
    currentProducts,
    historicalProducts,
  );
}
