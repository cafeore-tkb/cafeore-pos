import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import {
  Form,
  type MetaFunction,
  useActionData,
  useNavigation,
} from "@remix-run/react";
import { useMemo } from "react";
import useSWRSubscription from "swr/subscription";
import { usePreventNumberKeyUpDown } from "~/components/functional/usePreventNumberKeyUpDown";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import type { addItem } from "./actions/addItem";
import { collectionSub, itemConverter, itemSchema, ItemType, ItemEntity, itemtypes, type2label } from "@cafeore/common";

export { action as clientAction } from "./action";

export const meta: MetaFunction = () => {
  return [{ title: "アイテム" }];
};

export default function Item() {
  const { data: items } = useSWRSubscription(
    "items",
    collectionSub({ converter: itemConverter }),
  );
  const navigation = useNavigation();
  const lastResult = useActionData<typeof addItem>();
  const [form, fields] = useForm({
    lastResult: navigation.state === "idle" ? lastResult : null,
    onValidate({ formData }) {
      return parseWithZod(formData, {
        schema: itemSchema.omit({ assignee: true }),
      });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  const aggregatedItems = useMemo<Record<ItemType, ItemEntity[]>>(() => {
    const base = itemtypes.reduce<Record<ItemType, ItemEntity[]>>(
      (acc, type) => {
        acc[type] = [];
        return acc;
      },
      {} as Record<ItemType, ItemEntity[]>,
    );
    const aggregated = items?.reduce<Record<ItemType, ItemEntity[]>>(
      (acc, item) => {
        if (!acc[item.type]) {
          acc[item.type] = [];
        }
        acc[item.type].push(item);
        return acc;
      },
      base,
    );
    return aggregated ?? base;
  }, [items]);

  usePreventNumberKeyUpDown();

  return (
    <div className="bg-white p-4 font-sans">
      <h1 className="mb-6 font-bold text-3xl text-gray-800">アイテム管理</h1>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-4 font-semibold text-2xl text-gray-700">
            <s>新規アイテム登録</s>
            【非推奨】現在アイテムはソースコードにハードコードされています
          </h2>
          <Form
            method="POST"
            id={form.id}
            onSubmit={form.onSubmit}
            className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-md"
          >
            <div>
              <Label htmlFor={fields.name.id} className="text-gray-700">
                名前
              </Label>
              <Input
                type="text"
                id={fields.name.id}
                key={fields.name.key}
                name={fields.name.name}
                defaultValue={fields.name.initialValue}
                required
                placeholder="アイテム名"
                className="mt-1 w-full"
              />
              {fields.name.errors && (
                <span className="text-red-500 text-sm">
                  {fields.name.errors}
                </span>
              )}
            </div>
            <div>
              <Label htmlFor={fields.price.id} className="text-gray-700">
                価格
              </Label>
              <Input
                type="number"
                id={fields.price.id}
                key={fields.price.key}
                name={fields.price.name}
                defaultValue={fields.price.initialValue}
                required
                placeholder="価格"
                className="mt-1 w-full"
              />
              {fields.price.errors && (
                <span className="text-red-500 text-sm">
                  {fields.price.errors}
                </span>
              )}
            </div>
            <div>
              <Label className="text-gray-700">タイプ</Label>
              <RadioGroup
                key={fields.type.key}
                name={fields.type.name}
                defaultValue={fields.type.initialValue}
                className="mt-2"
              >
                {itemtypes.map((type) => (
                  <div key={type} className="flex items-center space-x-2">
                    <RadioGroupItem value={type} id={type} />
                    <Label htmlFor={type}>{type2label[type]}</Label>
                  </div>
                ))}
              </RadioGroup>
              {fields.type.errors && (
                <span className="text-red-500 text-sm">
                  {fields.type.errors}
                </span>
              )}
            </div>
            <Button
              type="submit"
              className="w-full bg-purple-600 text-white hover:bg-purple-700"
            >
              登録
            </Button>
          </Form>
        </div>

        <div>
          <h2 className="mb-4 font-semibold text-2xl text-gray-700">
            登録済みアイテム
          </h2>
          {itemtypes.map((type) => (
            <div key={type} className="mb-6">
              <h3 className="mb-2 font-semibold text-purple-700 text-xl">
                {type2label[type]}
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {aggregatedItems[type]?.map((item) => (
                  <div
                    key={item.id}
                    className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
                  >
                    <div className="bg-purple-100 p-4">
                      <h4 className="font-medium text-lg text-purple-800">
                        {item.name}
                      </h4>
                    </div>
                    <div className="p-4">
                      <p className="text-gray-600">
                        価格: ¥{item.price.toLocaleString()}
                      </p>
                      <Form method="DELETE" className="mt-2">
                        <input type="hidden" name="itemId" value={item.id} />
                        <Button
                          type="submit"
                          className="w-full bg-red-500 text-white hover:bg-red-600"
                        >
                          削除
                        </Button>
                      </Form>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
