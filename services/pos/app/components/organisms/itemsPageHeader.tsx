import { Link, useLocation } from "react-router";
import { cn } from "~/lib/utils";

type NavItem = {
  label: string;
  to: string;
  exact?: boolean;
};

const navItems: NavItem[] = [
  { label: "アイテム一覧", to: "/items", exact: true },
  { label: "アイテム新規作成", to: "/items/new" },
  { label: "タイプ一覧", to: "/item-types", exact: true },
  { label: "タイプ新規作成", to: "/item-types/new" },
];

export function ItemsPageHeader() {
  const location = useLocation();

  const isActive = (item: NavItem) => {
    if (item.exact) {
      return location.pathname === item.to;
    }
    return location.pathname.startsWith(item.to);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">商品管理</h1>
        <p className="text-muted-foreground text-sm">
          アイテムとアイテムタイプの作成・編集・削除を行います
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
              isActive(item)
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
