import type { ItemEntity, MenuEntity, WithId } from "@cafeore/common";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

export type MenuFormValues = {
  name: string;
  abbr: string;
  price: number;
  key: string;
  items: { item: WithId<ItemEntity>; quantity: number }[];
};

export function MenuForm({
  items,
  initialMenu,
  onSubmit,
}: {
  items: WithId<ItemEntity>[];
  initialMenu?: WithId<MenuEntity>;
  onSubmit: (values: MenuFormValues) => Promise<void>;
}) {
  const [name, setName] = useState(initialMenu?.name ?? "");
  const [abbr, setAbbr] = useState(initialMenu?.abbr ?? "");
  const [price, setPrice] = useState(initialMenu?.price ?? 0);
  const [key, setKey] = useState(initialMenu?.key ?? "");
  const [quantities, setQuantities] = useState<Record<string, number>>(
    Object.fromEntries(
      initialMenu?.items.map(({ item, quantity }) => [item.id, quantity]) ?? [],
    ),
  );

  return (
    <form
      className="grid max-w-2xl gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const selectedItems = items
          .filter((item) => (quantities[item.id] ?? 0) > 0)
          .map((item) => ({ item, quantity: quantities[item.id] }));
        if (selectedItems.length === 0) {
          alert("構成アイテムを1つ以上選択してください");
          return;
        }
        void onSubmit({ name, abbr, price, key, items: selectedItems });
      }}
    >
      <Label>
        名前
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Label>
      <Label>
        略称
        <Input
          value={abbr}
          onChange={(e) => setAbbr(e.target.value)}
          required
        />
      </Label>
      <Label>
        価格
        <Input
          type="number"
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          required
        />
      </Label>
      <Label>
        キー
        <Input value={key} onChange={(e) => setKey(e.target.value)} required />
      </Label>
      <fieldset className="grid gap-2">
        <legend className="font-medium">構成アイテム</legend>
        {items.map((item) => (
          <Label
            key={item.id}
            className="grid grid-cols-[1fr_8rem] items-center gap-3"
          >
            {item.name}（{item.item_type.display_name}）
            <Input
              type="number"
              min={0}
              value={quantities[item.id] ?? 0}
              onChange={(e) =>
                setQuantities((current) => ({
                  ...current,
                  [item.id]: Number(e.target.value),
                }))
              }
            />
          </Label>
        ))}
      </fieldset>
      <Button type="submit">保存</Button>
    </form>
  );
}
