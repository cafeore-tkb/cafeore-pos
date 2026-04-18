// routes/items.new.tsx
import {
  type ItemType,
  itemRepository,
  itemTypeRepository,
} from "@cafeore/common";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ItemForm } from "../components/organisms/itemForm";
import { buildNewItemEntity } from "./items/actions/add";

export default function NewItemPage() {
  const navigate = useNavigate();
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const types = await itemTypeRepository.findAll();
        setItemTypes(types);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load item types");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  if (loading) return <div>読み込み中...</div>;
  if (error) return <div>エラー: {error}</div>;
  if (itemTypes.length === 0) return <div>item type がありません</div>;

  return (
    <div className="flex flex-col gap-4">
      <ItemForm
        itemTypes={itemTypes}
        submitting={submitting}
        onSubmit={async (values) => {
          try {
            setSubmitting(true);
            const entity = buildNewItemEntity(values, itemTypes);
            await itemRepository.save(entity);
            navigate("/items");
          } catch (e) {
            alert(e instanceof Error ? e.message : "作成に失敗しました");
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </div>
  );
}
