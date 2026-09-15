import { type MenuEntity, type WithId, menuRepository } from "@cafeore/common";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "~/components/ui/button";

export default function MenusPage() {
  const navigate = useNavigate();
  const [menus, setMenus] = useState<WithId<MenuEntity>[]>([]);
  const load = useCallback(
    async () => setMenus(await menuRepository.findAll()),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="grid gap-4 p-4">
      <h1 className="font-bold text-xl">メニュー一覧</h1>
      {menus.map((menu) => (
        <div
          key={menu.id}
          className="flex items-center justify-between rounded border p-3"
        >
          <div>
            <strong>{menu.name}</strong>（{menu.abbr}） ￥{menu.price}
            <div className="text-sm">
              {menu.items
                .map(({ item, quantity }) => `${item.name} × ${quantity}`)
                .join("、")}
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => navigate(`/menus/${menu.id}/edit`)}>
              編集
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (confirm("このメニューを削除しますか？")) {
                  await menuRepository.delete(menu.id);
                  await load();
                }
              }}
            >
              削除
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
