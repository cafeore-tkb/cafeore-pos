import type { ItemType } from "@cafeore/common";
import { useState } from "react";
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
        <Label htmlFor="name">name</Label>
        <Input
          id="name"
          value={values.name}
          onChange={(e) => updateField("name", e.target.value)}
          placeholder="hot"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="display_name">display_name</Label>
        <Input
          id="display_name"
          value={values.display_name}
          onChange={(e) => updateField("display_name", e.target.value)}
          placeholder="ホット"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "保存中..." : "保存"}
        </Button>
      </div>
    </form>
  );
}
