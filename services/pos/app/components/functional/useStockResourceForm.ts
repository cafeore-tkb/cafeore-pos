import {
  type StockResource,
  type StockResourceInput,
  inventoryRepository,
} from "@cafeore/common";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { type StockAmounts, parseStockField, stockAmounts } from "~/lib/stock";

// 新しいカップの既定値。アイテムの在庫はアイテムを作ると API が作る
const newCup: StockResourceInput = {
  name: "",
  item_type_ids: [],
  unit: "個",
  per_serving: 1,
  notify_from: 500,
  notify_step: 100,
  buffer: 100,
};

/** 在庫タブの 1 行（在庫対象 1 つ。resource が無ければ新しいカップ）の入力と保存・削除 */
export const useStockResourceForm = (
  resource: StockResource | undefined,
  onChanged: () => void,
) => {
  // アイテムの在庫の名前はアイテムの名前で、使うタイプは持たない
  const isCup = !resource || resource.kind === "cup";
  const initial = (): StockResourceInput =>
    resource ? { ...resource } : { ...newCup };
  const [form, setForm] = useState<StockResourceInput>(initial);
  const [busy, setBusy] = useState(false);

  // 保存後に一覧が取り直されたら、その値に揃える。
  // 一覧は定期的に取り直されるので、保存済みの値が変わったときだけにして編集中の入力を消さない
  const saved = JSON.stringify(resource ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 保存済みの値が変わったときだけ
  useEffect(() => setForm(initial()), [saved]);

  const setName = (name: string) => setForm((f) => ({ ...f, name }));

  const setStockField = (key: keyof StockAmounts, raw: string) =>
    setForm((f) => ({ ...f, [key]: parseStockField(key, raw) }));

  const toggleItemType = (id: string) =>
    setForm((f) => {
      const ids = f.item_type_ids ?? [];
      return {
        ...f,
        item_type_ids: ids.includes(id)
          ? ids.filter((x) => x !== id)
          : [...ids, id],
      };
    });

  const run = async (action: () => Promise<unknown>, done: string) => {
    try {
      setBusy(true);
      await action();
      toast(done);
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (isCup && !form.name?.trim()) {
      toast("名前を入力してください");
      return;
    }
    if (!resource) {
      return run(async () => {
        await inventoryRepository.createResource(form);
        setForm({ ...newCup });
      }, `${form.name} を追加しました`);
    }
    return run(
      () =>
        inventoryRepository.updateResource(
          resource.id,
          isCup ? form : stockAmounts(form),
        ),
      `${form.name} を保存しました`,
    );
  };

  const remove = () => {
    if (!resource || !window.confirm(`${resource.name} を削除しますか？`)) {
      return;
    }
    return run(
      () => inventoryRepository.deleteResource(resource.id),
      `${resource.name} を削除しました`,
    );
  };

  return {
    form,
    setName,
    setStockField,
    toggleItemType,
    busy,
    save,
    remove,
  };
};
