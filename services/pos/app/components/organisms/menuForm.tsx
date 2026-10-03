import type { ItemEntity, WithId } from "@cafeore/common";
import { useId, useMemo, useState } from "react";
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
  usedKeys,
  onSubmit,
  submitting = false,
}: {
  items: WithId<ItemEntity>[];
  initialMenu?: MenuFormValues;
  /** 他のメニューが使っているキー。レジで同じキーに 2 つ割り当てないように */
  usedKeys: string[];
  onSubmit: (values: MenuFormValues) => Promise<void>;
  submitting?: boolean;
}) {
  const id = useId();
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

  const keyTaken = key !== "" && usedKeys.includes(key);

  const groups = useMemo(() => {
    const byType = new Map<string, WithId<ItemEntity>[]>();
    for (const item of items) {
      const type = item.item_type.display_name;
      byType.set(type, [...(byType.get(type) ?? []), item]);
    }
    return [...byType.entries()];
  }, [items]);

  const setQuantity = (itemId: string, quantity: number) =>
    setQuantities((current) => ({
      ...current,
      [itemId]: Math.max(0, quantity),
    }));

  return (
    <form
      className="grid gap-6"
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
        if (keyTaken) {
          setValidationError(`キー「${key}」は他のメニューで使われています`);
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
      <div className="grid grid-cols-2 gap-4">
        <div className="grid content-start gap-2">
          <Label htmlFor={`${id}-name`}>名前</Label>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ブレンド"
            required
          />
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor={`${id}-abbr`}>略称</Label>
          <Input
            id={`${id}-abbr`}
            value={abbr}
            onChange={(e) => setAbbr(e.target.value)}
            placeholder="ブ"
            required
          />
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor={`${id}-price`}>価格</Label>
          <div className="relative">
            <span className="-translate-y-1/2 absolute top-1/2 left-3 text-muted-foreground text-sm">
              ￥
            </span>
            <Input
              id={`${id}-price`}
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="500"
              className="pl-7"
              required
            />
          </div>
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor={`${id}-key`}>キー</Label>
          <Input
            id={`${id}-key`}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="a"
            className="font-mono"
            aria-invalid={keyTaken}
            required
          />
          {keyTaken ? (
            <p className="text-destructive text-xs">
              他のメニューで使われています
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              レジでこのキーを押すと追加されます。取り込み・書き出しでメニューの見分けにも使います
            </p>
          )}
        </div>
      </div>

      <fieldset className="grid gap-4">
        <legend className="mb-2 font-medium">構成アイテム</legend>
        {groups.map(([type, typeItems]) => (
          <div key={type} className="grid gap-2">
            <h3 className="text-muted-foreground text-sm">{type}</h3>
            {typeItems.map((item) => {
              const quantity = quantities[item.id] ?? 0;
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 data-[selected=true]:border-primary"
                  data-selected={quantity > 0}
                >
                  <span className="font-medium">{item.name}</span>
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`${item.name}を1つ減らす`}
                      disabled={quantity === 0}
                      onClick={() => setQuantity(item.id, quantity - 1)}
                    >
                      −
                    </Button>
                    <span className="w-6 text-center font-bold">
                      {quantity}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`${item.name}を1つ増やす`}
                      onClick={() => setQuantity(item.id, quantity + 1)}
                    >
                      ＋
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </fieldset>

      {validationError && (
        <p role="alert" className="text-destructive text-sm">
          {validationError}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? "保存中..." : "保存"}
        </Button>
      </div>
    </form>
  );
}
