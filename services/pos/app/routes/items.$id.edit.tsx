// routes/items/$id.edit.tsx
import {
  type ItemEntity,
  type ItemType,
  type WithId,
  itemRepository,
  itemTypeRepository,
} from "@cafeore/common";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ItemForm } from "../components/organisms/itemForm";
import { buildUpdatedItemEntity } from "./items/actions/update";

export default function EditItemPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [item, setItem] = useState<WithId<ItemEntity> | null>(null);
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!id) {
        setError("id がありません");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const [foundItem, types] = await Promise.all([
          itemRepository.findById(id),
          itemTypeRepository.findAll(),
        ]);

        if (!foundItem) {
          setError("item が見つかりません");
          return;
        }

        setItem(foundItem);
        setItemTypes(types);
      } catch (e) {
        setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [id]);

  if (loading) return <div>読み込み中...</div>;
  if (error) return <div>エラー: {error}</div>;
  if (!item || !id) return <div>item が見つかりません</div>;

  return (
    <div className="flex flex-col gap-4">
      <h1>アイテム編集</h1>

      <ItemForm
        initialItem={item}
        itemTypes={itemTypes}
        submitting={submitting}
        onSubmit={async (values) => {
          try {
            setSubmitting(true);
            const entity = buildUpdatedItemEntity(id, values, itemTypes);
            await itemRepository.save(entity);
            navigate("/items");
          } catch (e) {
            alert(e instanceof Error ? e.message : "更新に失敗しました");
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </div>
  );
}
