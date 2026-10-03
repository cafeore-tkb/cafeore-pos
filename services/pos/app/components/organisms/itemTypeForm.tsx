import type { ItemType } from "@cafeore/common";
import { useId, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

export type ItemTypeFormValues = {
  name: string;
  display_name: string;
};

type Props = {
  initialValue?: ItemType;
  onSubmit: (values: ItemTypeFormValues) => Promise<void> | void;
  submitting?: boolean;
};

export function ItemTypeForm({
  initialValue,
  onSubmit,
  submitting = false,
}: Props) {
  const id = useId();
  const [values, setValues] = useState<ItemTypeFormValues>({
    name: initialValue?.name ?? "",
    display_name: initialValue?.display_name ?? "",
  });

  const updateField = (key: keyof ItemTypeFormValues, value: string) => {
    setValues((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  return (
    <form
      className="grid gap-6"
      onSubmit={async (e) => {
        e.preventDefault();
        await onSubmit(values);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`${id}-display-name`}>表示名</Label>
        <Input
          id={`${id}-display-name`}
          value={values.display_name}
          onChange={(e) => updateField("display_name", e.target.value)}
          placeholder="ホット"
          required
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${id}-name`}>内部名</Label>
        <Input
          id={`${id}-name`}
          value={values.name}
          onChange={(e) => updateField("name", e.target.value)}
          placeholder="hot"
          className="font-mono"
          required
        />
        <p className="text-muted-foreground text-xs">
          レジのボタン配置やマスター画面の色分けに使う英字の名前です（hot / ice
          / milk / others など）
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "保存中..." : "保存"}
        </Button>
      </div>
    </form>
  );
}
