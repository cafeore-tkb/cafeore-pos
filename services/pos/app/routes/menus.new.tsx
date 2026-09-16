import {
  type ItemEntity,
  MenuEntity,
  type WithId,
  itemRepository,
  menuRepository,
} from "@cafeore/common";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { MenuForm } from "~/components/organisms/menuForm";

export default function NewMenuPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<WithId<ItemEntity>[]>([]);
  useEffect(() => {
    void itemRepository.findAll().then(setItems);
  }, []);
  return (
    <MenuForm
      items={items}
      onSubmit={async (values) => {
        await menuRepository.save(MenuEntity.createNew(values));
        navigate("/menus");
      }}
    />
  );
}
