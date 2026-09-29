import {
  type ItemEntity,
  type StockResource,
  type StockResourceInput,
  type StockResourceKind,
  type StockUsage,
  type WithId,
  inventoryRepository,
  useInventory,
  useItemMaster,
  useStockUsages,
} from "@cafeore/common";
import { useEffect, useMemo, useState } from "react";
import type { MetaFunction } from "react-router";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

export const meta: MetaFunction = () => {
  return [{ title: "在庫設定 / 珈琲・俺POS" }];
};

const defaults: Record<StockResourceKind, Omit<StockResourceInput, "name">> = {
  cup: {
    kind: "cup",
    unit: "個",
    per_serving: 1,
    notify_from: 500,
    notify_step: 100,
    buffer: 100,
  },
  bean: {
    kind: "bean",
    unit: "g",
    per_serving: 15,
    notify_from: 100,
    notify_step: 20,
    buffer: 30,
  },
};

// アイテムタイプからカップを推測する。一括設定の初期値にだけ使う。
const guessCupName: Record<string, string> = {
  hot: "ホット",
  hotOre: "ホット",
  ice: "アイス",
  milk: "アイス",
  iceOre: "オレ",
};

export default function InventorySettingsPage() {
  const { statuses, mutateInventory } = useInventory();
  const resources = useMemo(() => statuses.map((s) => s.resource), [statuses]);

  return (
    <div className="flex flex-col gap-10 p-4">
      <ResourcesSection
        resources={resources}
        onChanged={() => void mutateInventory()}
      />
      <UsagesSection resources={resources} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 在庫対象

function ResourcesSection({
  resources,
  onChanged,
}: {
  resources: StockResource[];
  onChanged: () => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-bold text-xl">在庫対象</h2>
        <p className="text-muted-foreground text-sm">
          通知は残りが「通知開始」を切ったときと、そこから「間隔」杯減るごとに
          Slack
          に送ります。「バッファ」を切ると危険扱いになります（いずれも杯数）。
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>種類</TableHead>
            <TableHead>名前</TableHead>
            <TableHead className="w-20">単位</TableHead>
            <TableHead className="w-24">1杯あたり</TableHead>
            <TableHead className="w-24">通知開始</TableHead>
            <TableHead className="w-24">間隔</TableHead>
            <TableHead className="w-24">バッファ</TableHead>
            <TableHead className="w-44">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {resources.map((resource) => (
            <ResourceRow
              key={resource.id}
              resource={resource}
              onChanged={onChanged}
            />
          ))}
          <ResourceRow onChanged={onChanged} />
        </TableBody>
      </Table>
    </section>
  );
}

function ResourceRow({
  resource,
  onChanged,
}: {
  resource?: StockResource;
  onChanged: () => void;
}) {
  const initial = (): StockResourceInput =>
    resource ? { ...resource } : { ...defaults.cup, name: "" };
  const [form, setForm] = useState<StockResourceInput>(initial);
  const [busy, setBusy] = useState(false);

  // 保存後に一覧が取り直されたら、その値に揃える
  // biome-ignore lint/correctness/useExhaustiveDependencies: resource が変わったときだけ
  useEffect(() => setForm(initial()), [resource]);

  const set = <K extends keyof StockResourceInput>(
    key: K,
    value: StockResourceInput[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const num = (
    key: "per_serving" | "notify_from" | "notify_step" | "buffer",
  ) => (
    <Input
      type="number"
      min={0}
      value={String(form[key])}
      onChange={(e) => set(key, Number(e.target.value))}
    />
  );

  const save = async () => {
    if (!form.name.trim()) {
      toast("名前を入力してください");
      return;
    }
    try {
      setBusy(true);
      if (resource) {
        await inventoryRepository.updateResource(resource.id, form);
        toast(`${form.name} を保存しました`);
      } else {
        await inventoryRepository.createResource(form);
        toast(`${form.name} を追加しました`);
        setForm({ ...defaults[form.kind], name: "" });
      }
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!resource) return;
    if (!window.confirm(`${resource.name} を削除しますか？`)) return;
    try {
      setBusy(true);
      await inventoryRepository.deleteResource(resource.id);
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <TableRow>
      <TableCell>
        <select
          className="h-10 rounded-md border bg-background px-2 text-sm"
          value={form.kind}
          onChange={(e) => {
            const kind = e.target.value as StockResourceKind;
            // 新規のときは種類に合わせて既定値を入れ直す
            setForm((f) =>
              resource ? { ...f, kind } : { ...defaults[kind], name: f.name },
            );
          }}
        >
          <option value="cup">カップ</option>
          <option value="bean">豆</option>
        </select>
      </TableCell>
      <TableCell>
        <Input
          value={form.name}
          placeholder={resource ? "" : "新しい在庫対象"}
          onChange={(e) => set("name", e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          value={form.unit}
          onChange={(e) => set("unit", e.target.value)}
        />
      </TableCell>
      <TableCell>{num("per_serving")}</TableCell>
      <TableCell>{num("notify_from")}</TableCell>
      <TableCell>{num("notify_step")}</TableCell>
      <TableCell>{num("buffer")}</TableCell>
      <TableCell>
        <div className="flex gap-2">
          <Button type="button" disabled={busy} onClick={() => void save()}>
            {resource ? "保存" : "追加"}
          </Button>
          {resource && (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              削除
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// アイテムごとの使用量

const usageKey = (itemId: string, resourceId: string) =>
  `${itemId}:${resourceId}`;

function UsagesSection({ resources }: { resources: StockResource[] }) {
  const { items } = useItemMaster();
  const { usages, mutateUsages } = useStockUsages();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(
      Object.fromEntries(
        usages.map((u) => [
          usageKey(u.item_id, u.resource_id),
          String(u.amount),
        ]),
      ),
    );
  }, [usages]);

  const cups = useMemo(
    () => resources.filter((r) => r.kind === "cup"),
    [resources],
  );
  const columns = useMemo(
    () => [...cups, ...resources.filter((r) => r.kind === "bean")],
    [cups, resources],
  );

  const sortedItems = useMemo(
    () =>
      [...items]
        .filter((item) => item.item_type.name !== "others")
        .sort(
          (a, b) =>
            a.item_type.display_name.localeCompare(
              b.item_type.display_name,
              "ja",
            ) || a.name.localeCompare(b.name, "ja"),
        ),
    [items],
  );

  const itemTypes = useMemo(() => {
    const seen = new Map<string, { name: string; display: string }>();
    for (const item of sortedItems) {
      seen.set(item.item_type.name, {
        name: item.item_type.name,
        display: item.item_type.display_name,
      });
    }
    return [...seen.values()];
  }, [sortedItems]);

  // アイテムタイプ → カップ の一括設定
  const [cupByType, setCupByType] = useState<Record<string, string>>({});
  useEffect(() => {
    // カップを読み込む前に推測すると全部「なし」で確定してしまう
    if (cups.length === 0) return;
    setCupByType((prev) => {
      const missing = itemTypes.filter((t) => prev[t.name] === undefined);
      if (missing.length === 0) return prev;
      const next = { ...prev };
      for (const t of missing) {
        const hint = guessCupName[t.name];
        next[t.name] =
          (hint && cups.find((c) => c.name.includes(hint))?.id) || "";
      }
      return next;
    });
  }, [itemTypes, cups]);

  const applyCups = () => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const item of sortedItems) {
        const cupId = cupByType[item.item_type.name];
        for (const cup of cups) {
          delete next[usageKey(item.id, cup.id)];
        }
        if (cupId) next[usageKey(item.id, cupId)] = "1";
      }
      return next;
    });
    toast("カップを種別ごとに設定しました。保存すると反映されます");
  };

  const setCell = (
    item: WithId<ItemEntity>,
    resource: StockResource,
    v: string,
  ) =>
    setDraft((prev) => {
      const next = { ...prev };
      if (v === "") delete next[usageKey(item.id, resource.id)];
      else next[usageKey(item.id, resource.id)] = v;
      return next;
    });

  const save = async () => {
    const body: StockUsage[] = [];
    for (const [key, value] of Object.entries(draft)) {
      const amount = Number(value);
      if (!value || Number.isNaN(amount) || amount <= 0) continue;
      const [item_id, resource_id] = key.split(":");
      body.push({ item_id, resource_id, amount });
    }
    try {
      setSaving(true);
      await inventoryRepository.replaceUsages(body);
      await mutateUsages();
      toast("使用量を保存しました");
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (columns.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-bold text-xl">アイテム1杯あたりの使用量</h2>
        <p className="text-muted-foreground text-sm">
          セットはメニューの構成アイテム ×
          数量で数えます。空欄は使わない扱いです。
        </p>
      </div>

      {cups.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
          {itemTypes.map((t) => (
            <label key={t.name} className="flex flex-col gap-1 text-sm">
              {t.display}
              <select
                className="h-9 rounded-md border bg-background px-2"
                value={cupByType[t.name] ?? ""}
                onChange={(e) =>
                  setCupByType((prev) => ({
                    ...prev,
                    [t.name]: e.target.value,
                  }))
                }
              >
                <option value="">カップなし</option>
                {cups.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <Button type="button" variant="outline" onClick={applyCups}>
            カップを種別から一括設定
          </Button>
        </div>
      )}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>アイテム</TableHead>
              <TableHead>種別</TableHead>
              {columns.map((r) => (
                <TableHead key={r.id} className="min-w-24 text-center">
                  {r.name}
                  <span className="block font-normal text-xs">({r.unit})</span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedItems.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="whitespace-nowrap font-medium">
                  {item.name}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {item.item_type.display_name}
                </TableCell>
                {columns.map((r) => (
                  <TableCell key={r.id}>
                    <Input
                      type="number"
                      min={0}
                      className="text-center"
                      placeholder="—"
                      value={draft[usageKey(item.id, r.id)] ?? ""}
                      onChange={(e) => setCell(item, r, e.target.value)}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div>
        <Button type="button" disabled={saving} onClick={() => void save()}>
          使用量を保存
        </Button>
      </div>
    </section>
  );
}
