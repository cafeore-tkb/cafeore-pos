import { Link, Outlet, useLocation } from "react-router";
import { cn } from "~/lib/utils";

const navItems = [
  { label: "残量", to: "/inventory" },
  { label: "設定", to: "/inventory/settings" },
];

export default function InventoryLayout() {
  const location = useLocation();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-4">
      <div className="flex flex-col gap-4 p-4">
        <div className="space-y-1">
          <h1 className="font-semibold text-2xl tracking-tight">在庫</h1>
          <p className="text-muted-foreground text-sm">
            棚卸しの実数から、その後の入荷と注文での消費を差し引いて残量を推定します
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "inline-flex h-9 items-center justify-center rounded-md border px-4 font-medium text-sm transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                location.pathname === item.to
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
      <Outlet />
    </div>
  );
}
