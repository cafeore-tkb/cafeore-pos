import type { MenuEntity, WithId } from "@cafeore/common";
import { RowActions, type RowHandlers } from "./RowActions";

export function MenusTab({
  menus,
  ...handlers
}: RowHandlers & { menus: WithId<MenuEntity>[] }) {
  return (
    <div className="grid gap-4">
      {menus.map((menu) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: キーボードでは編集ボタンを使う
        <div
          key={menu.id}
          className="flex cursor-pointer items-center justify-between rounded border p-3 hover:bg-muted/50"
          onClick={() => handlers.onEdit(menu.id)}
        >
          <div>
            <strong>{menu.name}</strong>（{menu.abbr}） ￥{menu.price}
            <div className="text-sm">
              {menu.items
                .map(({ item, quantity }) => `${item.name} × ${quantity}`)
                .join("、")}
            </div>
          </div>
          <RowActions id={menu.id} {...handlers} />
        </div>
      ))}
    </div>
  );
}
