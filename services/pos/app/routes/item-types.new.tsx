// routes/item-types.new.tsx
import { itemTypeRepository } from "@cafeore/common";
import { useState } from "react";
import { type MetaFunction, useNavigate } from "react-router";
import {
  ItemTypeForm,
  type ItemTypeFormValues,
} from "../components/organisms/itemTypeForm";

export const meta: MetaFunction = () => {
  return [{ title: "アイテムタイプ作成 / 珈琲・俺POS" }];
};

export default function NewItemTypePage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (values: ItemTypeFormValues) => {
    try {
      setSubmitting(true);
      await itemTypeRepository.save({
        name: values.name,
        display_name: values.display_name,
      });

      navigate("/item-types");
    } catch (e) {
      alert(e instanceof Error ? e.message : "作成に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <ItemTypeForm onSubmit={handleSubmit} submitting={submitting} />
    </div>
  );
}
