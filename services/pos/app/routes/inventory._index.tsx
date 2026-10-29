import { useInventory } from "@cafeore/common";
import { Link, type MetaFunction } from "react-router";
import { StockCard } from "~/components/organisms/inventory/StockCard";

export const meta: MetaFunction = () => {
  return [{ title: "在庫 / 珈琲・俺POS" }];
};

export default function InventoryPage() {
  const { statuses, error, isLoading, mutateInventory } = useInventory();

  if (isLoading) return <div>読み込み中...</div>;
  if (error) return <div>エラー: {String(error)}</div>;

  if (statuses.length === 0) {
    return (
      <div>
        在庫対象がまだありません。
        <Link className="underline" to="/products">
          商品管理
        </Link>
        でアイテムやカップを追加してください。
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
