import { Link, Outlet } from "react-router";
import { AdminOnly } from "~/components/functional/AdminOnly";
import { AdminPageHeader } from "~/components/molecules/AdminPageHeader";

// 本番では管理者だけが開ける。在庫の各ページ（子のルート）もここで弾く
export default function InventoryLayoutRoute() {
  return (
    <AdminOnly>
      <InventoryLayout />
    </AdminOnly>
  );
}

function InventoryLayout() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <AdminPageHeader
        group="admin"
        title="在庫"
        description="棚卸しの実数から、その後の入荷と使った分（抽出が要るものは提供可能にしたとき、ほかは注文を受けたとき）を差し引いて残量を推定します"
        actions={
          // 在庫の設定は商品管理にまとめている
          <Link
            to="/products?tab=stock"
            className="text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
          >
            在庫の設定 →
          </Link>
        }
      />
      <Outlet />
    </div>
  );
}
