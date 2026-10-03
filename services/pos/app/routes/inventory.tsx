import { Link, Outlet } from "react-router";

export default function InventoryLayout() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-4">
      <div className="flex flex-wrap items-end justify-between gap-4 p-4">
        <div className="space-y-1">
          <h1 className="font-semibold text-2xl tracking-tight">在庫</h1>
          <p className="text-muted-foreground text-sm">
            棚卸しの実数から、その後の入荷と注文での消費を差し引いて残量を推定します
          </p>
        </div>
        {/* 在庫対象と使用量の設定は商品管理にまとめている */}
        <Link
          to="/products?tab=stock"
          className="text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
        >
          在庫対象・使用量の設定 →
        </Link>
      </div>
      <Outlet />
    </div>
  );
}
