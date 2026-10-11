import {
  type StockResource,
  type StockResourceInput,
  inventoryRepository,
  useInventory,
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

// 新しいカップの既定値。アイテムの在庫はアイテムを作ると API が作る
const newCup: StockResourceInput = {
  name: "",
  unit: "個",
  per_serving: 1,
  notify_from: 500,
  notify_step: 100,
  buffer: 100,
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
    resource ? { ...resource } : { ...newCup };
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
    if (!form.name?.trim()) {
      toast("名前を入力してください");
      return;
    }
    // アイテムの在庫は名前（アイテムの名前）と使う種類を送らない
    const { name, item_type_ids, ...amounts } = form;
    try {
      setBusy(true);
      if (resource) {
        await inventoryRepository.updateResource(
          resource.id,
          resource.item_id == null ? form : amounts,
        );
        toast(`${form.name} を保存しました`);
      } else {
        await inventoryRepository.createResource(form);
        toast(`${form.name} を追加しました`);
        setForm({ ...newCup });
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
        {/* アイテムの在庫の名前はアイテムの名前 */}
        <Input
          value={form.name ?? ""}
          disabled={resource?.item_id != null}
          placeholder={resource ? "" : "新しいカップ"}
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
          {/* 消せるのはカップだけ。アイテムの在庫はアイテムを消すと消える */}
          {resource?.item_id === null && (
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
