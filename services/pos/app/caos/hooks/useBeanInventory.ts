import { useInventory, useStockUsages } from "@cafeore/common";
import { useMemo } from "react";
import { buildBeanIndex } from "../utils/beans";

// 豆の在庫は POS の在庫（GET /api/inventory）をそのまま使う。CaOS では在庫を持たず、減らしもしない。
// - beanStatuses：在庫対象のうち豆（kind が bean）の残量。豆のパネルに出す
// - beanIndex：商品 ID → 豆（在庫の設定の「商品ごとの使用量」）。カードがどの豆かを決める
// 使用量の取得に失敗すると全カードの豆が「なし」になるので、エラー・読み込み中は残量と合わせて返す。
// 使用量も残量と同じ間隔で取り直し、開いたあとの設定の変更をカードに反映する。
const USAGES_REFRESH_MS = 30 * 1000;

export const useBeanInventory = () => {
  const {
    statuses,
    error: statusesError,
    isLoading: statusesLoading,
  } = useInventory();
  const {
    usages,
    error: usagesError,
    isLoading: usagesLoading,
  } = useStockUsages({ refreshInterval: USAGES_REFRESH_MS });
  const error = statusesError ?? usagesError;
  const isLoading = statusesLoading || usagesLoading;
  const beanStatuses = useMemo(
    () => statuses.filter((status) => status.resource.kind === "bean"),
    [statuses],
  );
  const beanIndex = useMemo(
    () => buildBeanIndex(statuses, usages),
    [statuses, usages],
  );
  return { beanStatuses, beanIndex, error, isLoading };
};
