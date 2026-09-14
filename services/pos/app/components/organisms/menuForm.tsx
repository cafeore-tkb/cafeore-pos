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
  const [price, setPrice] = useState(
    initialMenu ? String(initialMenu.price) : "",
  );
  const [key, setKey] = useState(initialMenu?.key ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);
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
        setValidationError(null);

        const parsedPrice = Number(price);
        if (price.trim() === "" || !Number.isInteger(parsedPrice)) {
          setValidationError("価格は整数で入力してください");
          return;
        }
        if (parsedPrice < 0) {
          setValidationError("価格は0以上で入力してください");
          return;
        }

        const selectedItems = items
          .filter((item) => (quantities[item.id] ?? 0) > 0)
          .map((item) => ({ item, quantity: quantities[item.id] }));
        if (selectedItems.length === 0) {
          setValidationError("構成アイテムを1つ以上選択してください");
          return;
        }
        void onSubmit({
          name,
          abbr,
          price: parsedPrice,
          key,
          items: selectedItems,
        });
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-2 font-medium">構成アイテム</legend>
        {items.map((item) => {
          const quantity = quantities[item.id] ?? 0;
          return (
            <div
              key={item.id}
              className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border p-3"
            >
              <div>
                <div className="font-medium">{item.name}</div>
                <div className="text-muted-foreground text-sm">
                  {item.item_type.display_name}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`${item.name}を1つ減らす`}
                  disabled={quantity === 0}
                  onClick={() =>
                    setQuantities((current) => ({
                      ...current,
                      [item.id]: Math.max(0, quantity - 1),
                    }))
                  }
                >
                  −
                </Button>
                <span className="w-8 text-center font-bold text-lg">
                  {quantity}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`${item.name}を1つ増やす`}
                  onClick={() =>
                    setQuantities((current) => ({
                      ...current,
                      [item.id]: quantity + 1,
                    }))
                  }
                >
                  ＋
                </Button>
              </div>
            </div>
          );
        })}
      </fieldset>
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
        <Input value={price} onChange={(e) => setPrice(e.target.value)} />
      </Label>
      <Label>
        キー
        <Input value={key} onChange={(e) => setKey(e.target.value)} required />
      </Label>
      {validationError && (
        <p role="alert" className="text-destructive text-sm">
          {validationError}
        </p>
      )}
      <Button type="submit">保存</Button>
    </form>
  );
}
