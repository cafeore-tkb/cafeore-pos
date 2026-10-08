import type { ItemType } from "@cafeore/common";
import { useId, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";

export type ItemTypeFormValues = {
  name: string;
  display_name: string;
} & ItemTypeFlags;

export type ItemTypeFlags = Pick<
  ItemType,
  "makes_cup" | "needs_brew" | "senior_only" | "iced_brew"
>;

// 新しい種類の既定値（API の列の既定値と同じ）
export const DEFAULT_ITEM_TYPE_FLAGS: ItemTypeFlags = {
  makes_cup: true,
  needs_brew: true,
  senior_only: false,
  iced_brew: false,
};

const FLAG_FIELDS: {
  key: keyof ItemTypeFlags;
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
    label: "抽出が要る",
    description:
      "割引の対象の杯数やドリッパーの割り振りに数えます。ミルクなどは外します",
  },
  {
    key: "senior_only",
    label: "上級生だけが淹れる（限定）",
    description: "限定のコーヒーなど、上級生のドリッパーに割り振ります",
  },
  {
    key: "iced_brew",
    label: "アイスで淹れる",
    description:
      "アイスコーヒーなど。アイスに対応していないドリッパーには割り振りません",
  },
];

/**
 * 上の項目を外したら下の項目も外す（カップを作らない → 抽出しない → 限定でもアイスでもない）。API も同じ組み合わせしか受け付けない
 */
export const setItemTypeFlag = (
  flags: ItemTypeFlags,
  key: keyof ItemTypeFlags,
  value: boolean,
): ItemTypeFlags => {
  const next = { ...flags, [key]: value };
  if (!next.makes_cup) next.needs_brew = false;
  if (!next.needs_brew) {
    next.senior_only = false;
    next.iced_brew = false;
  }
  return next;
};

const isFlagEnabled = (flags: ItemTypeFlags, key: keyof ItemTypeFlags) =>
  key === "makes_cup" ||
  (key === "needs_brew" && flags.makes_cup) ||
  ((key === "senior_only" || key === "iced_brew") && flags.needs_brew);

/** 種類の「カップを作る」「抽出が要る」「限定」「アイス」の切り替え。判定はこの値をそのまま使う */
export function ItemTypeFlagFields({
  value,
  onChange,
  compact = false,
}: {
  value: ItemTypeFlags;
  onChange: (value: ItemTypeFlags) => void;
  compact?: boolean;
}) {
  const id = useId();
  return (
    <div className={compact ? "grid gap-2" : "grid gap-4"}>
      {FLAG_FIELDS.map(({ key, label, description }) => (
        <div key={key} className="flex items-start gap-3">
          <Switch
            id={`${id}-${key}`}
            checked={value[key]}
            disabled={!isFlagEnabled(value, key)}
            onCheckedChange={(checked) =>
              onChange(setItemTypeFlag(value, key, checked))
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
  const [values, setValues] = useState<ItemTypeFormValues>({
    name: initialValue?.name ?? "",
    display_name: initialValue?.display_name ?? "",
    makes_cup: initialValue?.makes_cup ?? DEFAULT_ITEM_TYPE_FLAGS.makes_cup,
    needs_brew: initialValue?.needs_brew ?? DEFAULT_ITEM_TYPE_FLAGS.needs_brew,
    senior_only:
      initialValue?.senior_only ?? DEFAULT_ITEM_TYPE_FLAGS.senior_only,
    iced_brew: initialValue?.iced_brew ?? DEFAULT_ITEM_TYPE_FLAGS.iced_brew,
  });

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
          マスター画面の既定の色分けに使う英字の名前です（hot / ice / milk
          など）。カップや抽出の扱いは名前ではなく下の項目で決まります
        </p>
      </div>

      <ItemTypeFlagFields
        value={values}
        onChange={(flags) => setValues((prev) => ({ ...prev, ...flags }))}
      />

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "保存中..." : "保存"}
        </Button>
      </div>
    </form>
  );
}
