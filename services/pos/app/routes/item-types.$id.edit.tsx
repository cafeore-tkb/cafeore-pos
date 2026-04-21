// routes/item-types.$id.edit.tsx
import { type ItemType, itemTypeRepository } from "@cafeore/common";
import { useEffect, useState } from "react";
import { type MetaFunction, useNavigate, useParams } from "react-router";
import {
  ItemTypeForm,
  type ItemTypeFormValues,
} from "../components/organisms/itemTypeForm";

export const meta: MetaFunction = () => {
  return [{ title: "アイテムタイプ編集 / 珈琲・俺POS" }];
};

export default function EditItemTypePage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [itemType, setItemType] = useState<ItemType | null>(null);
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
        const found = await itemTypeRepository.findById(id);
        if (!found) {
          setError("item type が見つかりません");
          return;
        }
        setItemType(found);
      } catch (e) {
        setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [id]);

  const handleSubmit = async (values: ItemTypeFormValues) => {
    if (!id) return;

    try {
      setSubmitting(true);

      await itemTypeRepository.save({
        id,
        name: values.name,
        display_name: values.display_name,
      });

      navigate("/item-types");
    } catch (e) {
      alert(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div>読み込み中...</div>;
  if (error) return <div>エラー: {error}</div>;
  if (!itemType) return <div>item type が見つかりません</div>;

  return (
    <div className="flex flex-col gap-4">
      <ItemTypeForm
        initialValue={itemType}
        onSubmit={handleSubmit}
        submitting={submitting}
      />
    </div>
  );
}
