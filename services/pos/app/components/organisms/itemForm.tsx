import type { ItemEntity, ItemType, StockResource } from "@cafeore/common";
import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { guessCup, sortResources } from "~/lib/stock";
import type { ItemTypeFormValues } from "./itemTypeForm";

export type ItemFormValues = {
  name: string;
  abbr: string;
  itemTypeId: string;
  /** 在庫対象の ID → 1杯あたりの量（入力のまま）。空欄は使わない */
  usages: Record<string, string>;
};

/** アイテムと同じ名前・略称で、そのアイテム 1 つだけのメニュー */
export type SameNameMenu = { price: number; key: string };

type MenuDraft = { enabled: boolean; price: string; key: string };

type Props = {
  initialItem?: ItemEntity;
  itemTypes: ItemType[];
  resources: StockResource[];
  /** 渡さなければ新規として、タイプからカップを入れる */
  initialUsages?: Record<string, string>;
  onSubmit: (
    values: ItemFormValues,
    menu: SameNameMenu | null,
  ) => Promise<void> | void;
  /** 渡したときだけ「同名のメニューも作る」を出す。他のメニューが使っているキー */
  menuKeysInUse?: string[];
  /** 作ったタイプを返す。一覧の itemTypes に入ってから返すこと */
  onCreateItemType: (values: ItemTypeFormValues) => Promise<ItemType>;
  submitting?: boolean;
};

export function ItemForm({
  initialItem,
  itemTypes,
  resources,
  initialUsages,
  onSubmit,
  onCreateItemType,
  menuKeysInUse,
  submitting = false,
}: Props) {
  const id = useId();
  const initialItemTypeId = useMemo(() => {
    if (initialItem?.item_type?.id) return initialItem.item_type.id;
    return itemTypes[0]?.id ?? "";
  }, [initialItem, itemTypes]);

  const cups = useMemo(
    () => resources.filter((r) => r.kind === "cup"),
    [resources],
  );
  // 新規はタイプからカップを推測して入れる。使用量を触るまではタイプに合わせて入れ直す
  const guessUsages = (itemTypeId: string): Record<string, string> => {
    const typeName = itemTypes.find((t) => t.id === itemTypeId)?.name;
    const cup = guessCup(typeName, cups);
    return cup ? { [cup.id]: "1" } : {};
  };
  const [usagesTouched, setUsagesTouched] = useState(initialUsages != null);

  const [values, setValues] = useState<ItemFormValues>(() => ({
    name: initialItem?.name ?? "",
    abbr: initialItem?.abbr ?? "",
    itemTypeId: initialItemTypeId,
    usages: initialUsages ?? guessUsages(initialItemTypeId),
  }));

  const [menu, setMenu] = useState<MenuDraft>({
    enabled: false,
    price: "",
    key: "",
  });
  const [menuError, setMenuError] = useState<string | null>(null);
  const menuKeyTaken =
    menu.key !== "" && (menuKeysInUse ?? []).includes(menu.key);

  // 在庫対象があとから読み込まれたときも、触る前なら推測し直す
  const cupIds = cups.map((cup) => cup.id).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: カップの顔ぶれが変わったときだけ
  useEffect(() => {
    if (usagesTouched) return;
    setValues((prev) => ({ ...prev, usages: guessUsages(prev.itemTypeId) }));
  }, [cupIds]);

  const updateField = (
    key: Exclude<keyof ItemFormValues, "usages">,
    value: string,
  ) => {
    setValues((prev) => ({
      ...prev,
      [key]: value,
      ...(key === "itemTypeId" && !usagesTouched
        ? { usages: guessUsages(value) }
        : {}),
    }));
  };

  const setUsage = (resourceId: string, value: string) => {
    setUsagesTouched(true);
    setValues((prev) => ({
      ...prev,
      usages: { ...prev.usages, [resourceId]: value },
    }));
  };

  return (
    <form
      className="grid gap-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setMenuError(null);
        if (!menu.enabled) {
          await onSubmit(values, null);
          return;
        }
        // アイテムだけ保存されてメニューで失敗しないよう、先に確かめる
        const price = Number(menu.price);
        if (menu.price.trim() === "" || !Number.isInteger(price) || price < 0) {
          setMenuError("価格は0以上の整数で入力してください");
          return;
        }
        if (menuKeyTaken) {
          setMenuError(`キー「${menu.key}」は他のメニューで使われています`);
          return;
        }
        await onSubmit(values, { price, key: menu.key });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`${id}-name`}>名前</Label>
        <Input
          id={`${id}-name`}
          value={values.name}
          onChange={(e) => updateField("name", e.target.value)}
          placeholder="キリマンジャロ"
          required
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${id}-abbr`}>略称</Label>
        <Input
          id={`${id}-abbr`}
          value={values.abbr}
          onChange={(e) => updateField("abbr", e.target.value)}
          placeholder="キリマン"
          required
        />
        <p className="text-muted-foreground text-xs">
          マスター画面など、狭いところに出す短い名前です
        </p>
      </div>

      <div className="grid gap-2">
        <Label>タイプ</Label>
        <Select
          value={values.itemTypeId}
          onValueChange={(value) => updateField("itemTypeId", value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="タイプを選択" />
          </SelectTrigger>
          <SelectContent>
            {itemTypes.map((itemType) => (
              <SelectItem key={itemType.id} value={itemType.id ?? "-"}>
                {itemType.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <NewItemType
          onCreate={async (typeValues) => {
            const created = await onCreateItemType(typeValues);
            if (created.id) updateField("itemTypeId", created.id);
          }}
        />
      </div>

      <div className="grid gap-3 rounded-md border p-3">
        <div className="grid gap-1">
          <p className="font-medium text-sm">在庫の使用量（1杯あたり）</p>
          <p className="text-muted-foreground text-xs">
            注文のたびにこの量を在庫から引きます。グッズなど数えないものは空欄のままにします
          </p>
        </div>
        {resources.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            在庫対象がありません。
            <Link to="/products?tab=stock" className="underline">
              在庫タブ
            </Link>
            で追加できます
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {sortResources(resources).map((resource) => (
              <div key={resource.id} className="grid content-start gap-1">
                <Label
                  htmlFor={`${id}-usage-${resource.id}`}
                  className="text-xs"
                >
                  {resource.name}（{resource.unit}）
                </Label>
                <Input
                  id={`${id}-usage-${resource.id}`}
                  type="number"
                  min={0}
                  step="any"
                  placeholder="—"
                  value={values.usages[resource.id] ?? ""}
                  onChange={(e) => setUsage(resource.id, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {menuKeysInUse && (
        <div className="grid gap-3 rounded-md border p-3">
          <label className="flex items-center gap-2 font-medium text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={menu.enabled}
              onChange={(e) =>
                setMenu((prev) => ({ ...prev, enabled: e.target.checked }))
              }
            />
            同名のメニューも作る
          </label>
          {menu.enabled && (
            <>
              <p className="text-muted-foreground text-xs">
                このアイテム 1 つだけのメニューを、同じ名前・略称で作ります
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid content-start gap-2">
                  <Label htmlFor={`${id}-menu-price`}>価格</Label>
                  <div className="relative">
                    <span className="-translate-y-1/2 absolute top-1/2 left-3 text-muted-foreground text-sm">
                      ￥
                    </span>
                    <Input
                      id={`${id}-menu-price`}
                      inputMode="numeric"
                      value={menu.price}
                      onChange={(e) =>
                        setMenu((prev) => ({ ...prev, price: e.target.value }))
                      }
                      placeholder="500"
                      className="pl-7"
                      required
                    />
                  </div>
                </div>
                <div className="grid content-start gap-2">
                  <Label htmlFor={`${id}-menu-key`}>キー</Label>
                  <Input
                    id={`${id}-menu-key`}
                    value={menu.key}
                    onChange={(e) =>
                      setMenu((prev) => ({ ...prev, key: e.target.value }))
                    }
                    placeholder="a"
                    className="font-mono"
                    aria-invalid={menuKeyTaken}
                    required
                  />
                  {menuKeyTaken && (
                    <p className="text-destructive text-xs">
                      他のメニューで使われています
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
          {menuError && (
            <p role="alert" className="text-destructive text-sm">
              {menuError}
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "保存中..." : "保存"}
        </Button>
      </div>
    </form>
  );
}

// form の中に form は置けない。入力欄の Enter は親フォームを送信してしまうので止め、タイプの追加にする
function NewItemType({
  onCreate,
}: {
  onCreate: (values: ItemTypeFormValues) => Promise<void>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ItemTypeFormValues>({
    name: "",
    display_name: "",
  });
  const [creating, setCreating] = useState(false);

  if (!open) {
    return (
      <Button
        type="button"
        variant="link"
        className="h-auto justify-self-start p-0"
        onClick={() => setOpen(true)}
      >
        ＋ 新しいタイプ
      </Button>
    );
  }

  const canCreate =
    values.name.trim() !== "" && values.display_name.trim() !== "";

  const create = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      await onCreate(values);
      setValues({ name: "", display_name: "" });
      setOpen(false);
    } catch {
      // 失敗は onCreate 側でトーストに出る。入力は残してやり直せるようにする
    } finally {
      setCreating(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 変換の確定の Enter は親フォームも送信しないので、そのままにする
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void create();
  };

  return (
    <div className="grid gap-3 rounded-md border bg-muted/40 p-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-display-name`} className="text-xs">
            表示名
          </Label>
          <Input
            id={`${id}-display-name`}
            value={values.display_name}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, display_name: e.target.value }))
            }
            placeholder="ホット"
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${id}-name`} className="text-xs">
            内部名
          </Label>
          <Input
            id={`${id}-name`}
            value={values.name}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="hot"
            onKeyDown={onKeyDown}
            className="font-mono"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          やめる
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!canCreate || creating}
          onClick={create}
        >
          {creating ? "追加中..." : "タイプを追加"}
        </Button>
      </div>
    </div>
  );
}
