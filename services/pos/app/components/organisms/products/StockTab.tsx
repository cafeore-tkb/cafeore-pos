import {
  type ItemEntity,
  type StockResource,
  type StockResourceInput,
  type StockResourceKind,
  type StockUsage,
  type WithId,
  inventoryRepository,
} from "@cafeore/common";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
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
import {
  guessCup,
  sortResources,
  stockResourceDefaults,
  toUsageInputs,
  usagesByItem,
} from "~/lib/stock";

type Props = {
  items: WithId<ItemEntity>[];
  resources: StockResource[];
  usages: StockUsage[];
  onResourcesChanged: () => void;
  onUsagesChanged: () => Promise<unknown>;
};

export function StockTab({
  items,
  resources,
  usages,
  onResourcesChanged,
  onUsagesChanged,
}: Props) {
  return (
    <div className="flex flex-col gap-10">
      <ResourcesSection resources={resources} onChanged={onResourcesChanged} />
      <UsagesSection
        items={items}
        resources={resources}
        usages={usages}
        onChanged={onUsagesChanged}
      />
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
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-semibold text-lg">在庫対象</h2>
          <Link
            to="/inventory"
            className="text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
          >
            残量・棚卸しを見る →
          </Link>
        </div>
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
          {sortResources(resources).map((resource) => (
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
    resource ? { ...resource } : { ...stockResourceDefaults.cup, name: "" };
  const [form, setForm] = useState<StockResourceInput>(initial);
  const [busy, setBusy] = useState(false);

  // 保存後に一覧が取り直されたら、その値に揃える。
  // 一覧は定期的に取り直されるので、保存済みの値が変わったときだけにして編集中の入力を消さない
  const saved = JSON.stringify(resource ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 保存済みの値が変わったときだけ
  useEffect(() => setForm(initial()), [saved]);

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
        setForm({ ...stockResourceDefaults[form.kind], name: "" });
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
    if (
      !window.confirm(
        `${resource.name} を削除しますか？アイテムの使用量からも外れます`,
      )
    )
      return;
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
              resource
                ? { ...f, kind }
                : { ...stockResourceDefaults[kind], name: f.name },
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
// アイテムごとの使用量の一覧。1件ずつはアイテムの編集でも直せる

// アイテムの ID → 在庫対象の ID → 入力中の量
type Draft = Record<string, Record<string, string>>;

const toDraft = (usages: StockUsage[]): Draft =>
  Object.fromEntries(
    [...usagesByItem(usages)].map(([itemId, amounts]) => [
      itemId,
      Object.fromEntries(
        [...amounts].map(([resourceId, amount]) => [
          resourceId,
          String(amount),
        ]),
      ),
    ]),
  );

// 保存する内容が同じかどうか。入力の書き方（"15" と "15.0" など）の違いは無視する
const sameUsages = (
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
) => {
  const key = (draft: Record<string, string> | undefined) =>
    JSON.stringify(
      toUsageInputs(draft ?? {}).sort((x, y) =>
        x.resource_id.localeCompare(y.resource_id),
      ),
    );
  return key(a) === key(b);
};

function UsagesSection({
  items,
  resources,
  usages,
  onChanged,
}: {
  items: WithId<ItemEntity>[];
  resources: StockResource[];
  usages: StockUsage[];
  onChanged: () => Promise<unknown>;
}) {
  // 取り直すたびに配列が作り直されるので、中身が変わったときだけ入力を揃え直す
  const usagesKey = JSON.stringify(usages);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 中身が変わったときだけ
  const saved = useMemo(() => toDraft(usages), [usagesKey]);
  const [draft, setDraft] = useState<Draft>(saved);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(saved), [saved]);

  const columns = useMemo(() => sortResources(resources), [resources]);
  const cups = useMemo(
    () => resources.filter((r) => r.kind === "cup"),
    [resources],
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

  const changedItems = sortedItems.filter(
    (item) => !sameUsages(draft[item.id], saved[item.id]),
  );

  // カップが未設定のアイテムに、タイプから推測したカップを入れる
  const fillCups = () => {
    let filled = 0;
    const next = { ...draft };
    for (const item of sortedItems) {
      const amounts = next[item.id] ?? {};
      if (cups.some((cup) => amounts[cup.id])) continue;
      const cup = guessCup(item.item_type.name, cups);
      if (!cup) continue;
      next[item.id] = { ...amounts, [cup.id]: "1" };
      filled++;
    }
    setDraft(next);
    toast(
      filled > 0
        ? `${filled}件にカップを入れました。保存すると反映されます`
        : "カップが空のアイテムはありません",
    );
  };

  const setCell = (itemId: string, resourceId: string, value: string) =>
    setDraft((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [resourceId]: value },
    }));

  // 変えたアイテムの分だけ送る。ほかの人が別のアイテムを直していても上書きしない
  const save = async () => {
    try {
      setSaving(true);
      for (const item of changedItems) {
        await inventoryRepository.replaceItemUsages(
          item.id,
          toUsageInputs(draft[item.id] ?? {}),
        );
      }
      await onChanged();
      toast(`${changedItems.length}件のアイテムの使用量を保存しました`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存に失敗しました");
      await onChanged();
    } finally {
      setSaving(false);
    }
  };

  if (columns.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        在庫対象を追加すると、アイテムごとの使用量を設定できます
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg">アイテム1杯あたりの使用量</h2>
          <p className="text-muted-foreground text-sm">
            セットはメニューの構成アイテム ×
            数量で数えます。空欄は使わない扱いです。アイテムの編集からも直せます
          </p>
        </div>
        {cups.length > 0 && (
          <Button type="button" variant="outline" onClick={fillCups}>
            空のカップをタイプから入れる
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>アイテム</TableHead>
              <TableHead>タイプ</TableHead>
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
              <TableRow
                key={item.id}
                className={
                  changedItems.includes(item) ? "bg-amber-50" : undefined
                }
              >
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
                      value={draft[item.id]?.[r.id] ?? ""}
                      onChange={(e) => setCell(item.id, r.id, e.target.value)}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          disabled={saving || changedItems.length === 0}
          onClick={() => void save()}
        >
          使用量を保存
        </Button>
        {changedItems.length > 0 && (
          <span className="text-muted-foreground text-sm">
            {changedItems.length}件のアイテムを変更中
          </span>
        )}
      </div>
    </section>
  );
}
