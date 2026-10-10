import type { ItemType } from "@cafeore/common";
import { useId, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";

export type ItemTypeFormValues = Omit<ItemType, "id">;

type FlagKey = "makes_cup" | "needs_brew" | "senior_only" | "iced_brew";

// 新しい種類の入力の初め（項目は API の列の既定値と同じ）
export const EMPTY_ITEM_TYPE: ItemTypeFormValues = {
  name: "",
  display_name: "",
  makes_cup: true,
  needs_brew: true,
  senior_only: false,
  iced_brew: false,
};

// parent が外れているあいだは押せず、外すとこちらも外れる（カップを作らない → 抽出しない → 上級生のみでもアイスでもない）。
// API も同じ組み合わせしか受け付けない
const FLAG_FIELDS: {
  key: FlagKey;
  parent?: FlagKey;
  label: string;
  description: string;
}[] = [
  {
    key: "makes_cup",
    label: "カップを作る",
    description:
      "1杯ずつカップを作り、マスター・提供画面に出します。グッズなどは外します",
  },
  {
    key: "needs_brew",
    parent: "makes_cup",
    label: "抽出が要る",
    description:
      "割引の対象の杯数やドリッパーの割り振りに数えます。ミルクなどは外します",
  },
  {
    key: "senior_only",
    parent: "needs_brew",
    label: "上級生のみ",
    description: "上級生のドリッパーにだけ割り振ります",
  },
  {
    key: "iced_brew",
    parent: "needs_brew",
    label: "アイスで淹れる",
    description:
      "アイスコーヒーなど。アイスに対応していないドリッパーには割り振りません",
  },
];

const setFlag = (
  values: ItemTypeFormValues,
  key: FlagKey,
  checked: boolean,
): ItemTypeFormValues => {
  const next = { ...values, [key]: checked };
  // 親から順に並んでいるので、1回なめれば孫まで外れる
  for (const field of FLAG_FIELDS) {
    if (field.parent && !next[field.parent]) next[field.key] = false;
  }
  return next;
};

/** 種類の「カップを作る」「抽出が要る」「上級生のみ」「アイス」の切り替え。判定はこの値をそのまま使う */
export function ItemTypeFlagFields({
  value,
  onChange,
  compact = false,
}: {
  value: ItemTypeFormValues;
  onChange: (value: ItemTypeFormValues) => void;
  compact?: boolean;
}) {
  const id = useId();
  return (
    <div className={compact ? "grid gap-2" : "grid gap-4"}>
      {FLAG_FIELDS.map(({ key, parent, label, description }) => (
        <div key={key} className="flex items-start gap-3">
          <Switch
            id={`${id}-${key}`}
            checked={value[key]}
            disabled={parent !== undefined && !value[parent]}
            onCheckedChange={(checked) =>
              onChange(setFlag(value, key, checked))
            }
          />
          <div className="grid gap-1">
            <Label
              htmlFor={`${id}-${key}`}
              className={compact ? "text-xs" : undefined}
            >
              {label}
            </Label>
            {!compact && (
              <p className="text-muted-foreground text-xs">{description}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

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
  const [values, setValues] = useState<ItemTypeFormValues>(
    initialValue ?? EMPTY_ITEM_TYPE,
  );

  const updateField = (key: "name" | "display_name", value: string) => {
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
          英字の名前です（hot / ice / milk
          など）。カップや抽出の扱いは名前ではなく下の項目で決まります
        </p>
      </div>

      <ItemTypeFlagFields value={values} onChange={setValues} />

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "保存中..." : "保存"}
        </Button>
      </div>
    </form>
  );
}
