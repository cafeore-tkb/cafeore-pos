import { useInventory } from "@cafeore/common";
import { Link, type MetaFunction } from "react-router";
import { StockCard } from "~/components/organisms/inventory/StockCard";

export const meta: MetaFunction = () => {
  return [{ title: "在庫 / 珈琲・俺POS" }];
};

export default function InventoryPage() {
  const { statuses, error, isLoading, mutateInventory } = useInventory();

  if (isLoading) return <div className="p-4">読み込み中...</div>;
  if (error) return <div className="p-4">エラー: {String(error)}</div>;

  if (statuses.length === 0) {
    return (
      <div className="p-4">
        在庫対象がまだありません。
        <Link className="underline" to="/inventory/settings">
          設定
        </Link>
        からカップや豆を追加してください。
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
      {statuses.map((status) => (
        <StockCard
          key={status.resource.id}
          status={status}
          onRecorded={() => void mutateInventory()}
        />
      ))}
    </div>
  );
}
