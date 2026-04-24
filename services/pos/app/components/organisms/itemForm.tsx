import type { ItemEntity, ItemType } from "@cafeore/common";
import { useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

export type ItemFormValues = {
  name: string;
  abbr: string;
  price: string;
  key: string;
  itemTypeId: string;
  assignee: string;
};

type Props = {
  initialItem?: ItemEntity;
  itemTypes: ItemType[];
  onSubmit: (values: ItemFormValues) => Promise<void> | void;
  submitting?: boolean;
};

export function ItemForm({
  initialItem,
  itemTypes,
  onSubmit,
  submitting = false,
}: Props) {
  const initialItemTypeId = useMemo(() => {
    if (initialItem?.item_type?.id) return initialItem.item_type.id;
    return itemTypes[0]?.id ?? "";
  }, [initialItem, itemTypes]);

  const [values, setValues] = useState<ItemFormValues>({
    name: initialItem?.name ?? "",
    abbr: initialItem?.abbr ?? "",
    price: initialItem ? String(initialItem.price) : "",
    key: initialItem?.key ?? "",
    itemTypeId: initialItemTypeId,
    assignee: initialItem?.assignee ?? "",
  });

  const updateField = (key: keyof ItemFormValues, value: string) => {
    setValues((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{initialItem ? "アイテム編集" : "アイテム作成"}</CardTitle>
      </CardHeader>

      <CardContent>
        <form
          className="grid gap-6"
          onSubmit={async (e) => {
            e.preventDefault();
            await onSubmit(values);
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="name">名前</Label>
            <Input
              id="name"
              value={values.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="キリマンジャロ"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="abbr">略称</Label>
            <Input
              id="abbr"
              value={values.abbr}
              onChange={(e) => updateField("abbr", e.target.value)}
              placeholder="キリマン"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="price">価格</Label>
            <Input
              id="price"
              type="number"
              inputMode="numeric"
              value={values.price}
              onChange={(e) => updateField("price", e.target.value)}
              placeholder="500"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="key">キー</Label>
            <Input
              id="key"
              value={values.key}
              onChange={(e) => updateField("key", e.target.value)}
              placeholder="-"
            />
          </div>

          <div className="grid gap-2">
            <Label>Item Type</Label>
            <Select
              value={values.itemTypeId}
              onValueChange={(value) => updateField("itemTypeId", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Item Type を選択" />
              </SelectTrigger>
              <SelectContent>
                {itemTypes.map((itemType) => (
                  <SelectItem key={itemType.id} value={itemType.id ?? "-"}>
                    {itemType.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? "保存中..." : "保存"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
