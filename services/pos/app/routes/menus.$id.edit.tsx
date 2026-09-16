import {
  type ItemEntity,
  itemRepository,
  MenuEntity,
  menuRepository,
  type WithId,
} from "@cafeore/common";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { MenuForm } from "~/components/organisms/menuForm";

export default function EditMenuPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState<WithId<ItemEntity>[]>([]);
  const [menu, setMenu] = useState<WithId<MenuEntity> | null>(null);
  useEffect(() => {
    if (!id) return;
    void Promise.all([
      itemRepository.findAll(),
      menuRepository.findById(id),
    ]).then(([loadedItems, loadedMenu]) => {
      setItems(loadedItems);
      setMenu(loadedMenu);
    });
  }, [id]);
  if (!id || !menu) return <div>読み込み中...</div>;
  return (
    <MenuForm
      items={items}
      initialMenu={menu}
      onSubmit={async (values) => {
        await menuRepository.save(
          MenuEntity.fromMenu({ id, ...values, assignee: null }),
        );
        navigate("/menus");
      }}
    />
  );
}
