import type { ItemEntity, MenuEntity, WithId } from "@cafeore/common";
import { useMemo, useState } from "react";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { RowActions, type RowHandlers } from "./RowActions";

export function MenusTab({
  menus,
  items,
  ...handlers
}: RowHandlers & {
  menus: WithId<MenuEntity>[];
  items: WithId<ItemEntity>[];
}) {
  const [query, setQuery] = useState("");
  // 削除済みのアイテムはメニューに残っても一覧には無い
  const itemIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (q === "") return menus;
    return menus.filter(
      (menu) => menu.name.includes(q) || menu.abbr.includes(q),
    );
  }, [menus, query]);

  return (
    <div className="grid gap-3">
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="名前・略称で絞り込む"
        className="max-w-xs"
      />
      {filtered.length === 0 && (
        <p className="py-8 text-center text-muted-foreground text-sm">
          {menus.length === 0
            ? "メニューがありません。「＋ 追加」から作れます"
            : "一致するメニューがありません"}
        </p>
      )}
      {filtered.map((menu) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: キーボードでは編集ボタンを使う
        <div
          key={menu.id}
          className="flex cursor-pointer items-center justify-between gap-4 rounded-md border p-3 hover:bg-muted/50"
          onClick={() => handlers.onEdit(menu.id)}
        >
          <div className="grid gap-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-bold">{menu.name}</span>
              <span className="text-muted-foreground text-sm">{menu.abbr}</span>
              <span className="font-medium">
                ￥{menu.price.toLocaleString()}
              </span>
              <span className="text-muted-foreground text-sm">
                キー{" "}
                <kbd className="rounded border bg-muted px-1.5 font-mono text-foreground">
                  {menu.key}
                </kbd>
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {menu.items.map(({ item, quantity }) => {
                const deleted = !itemIds.has(item.id);
                return (
                  <span
                    key={item.id}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs",
                      deleted
                        ? "border-destructive text-destructive"
                        : "bg-muted",
                    )}
                  >
                    {deleted ? "削除済みのアイテム" : item.name} × {quantity}
                  </span>
                );
              })}
            </div>
          </div>
          <RowActions id={menu.id} {...handlers} />
        </div>
      ))}
    </div>
  );
}
