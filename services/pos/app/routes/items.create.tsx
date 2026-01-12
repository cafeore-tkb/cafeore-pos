import {
  API_BASE_URL,
  type ItemTypeResponse,
  itemResponseSchema,
} from "@cafeore/common";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import {
  type ClientActionFunction,
  Form,
  type MetaFunction,
  useActionData,
  useNavigation,
} from "@remix-run/react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { addItem } from "./items/actions/addItem";

export const meta: MetaFunction = () => [
  { title: "アイテム作成 / 珈琲・俺POS" },
];

export const clientAction: ClientActionFunction = addItem;

export default function ItemCreate() {
  const [itemTypes, setItemTypes] = useState<ItemTypeResponse[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/item-types`)
      .then((res) => res.json())
      .then(setItemTypes);
  }, []);

  const navigation = useNavigation();
  const lastResult = useActionData<typeof addItem>();

  const [form, fields] = useForm({
    lastResult: navigation.state === "idle" ? lastResult : null,
    onValidate({ formData }) {
      return parseWithZod(formData, {
        schema: itemResponseSchema,
      });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });
  return (
    <div>
      <h2 className="mb-4 font-semibold text-2xl text-gray-700">
        新規アイテム登録
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
            <span className="text-red-500 text-sm">{fields.name.errors}</span>
          )}
        </div>
        <div>
          <Label
            htmlFor={fields.item_type_id.id}
            className="block text-sm font-medium"
          >
            タイプ
          </Label>
          <Select
            onValueChange={(value) => {
              setSelectedTypeId(value);
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="選択してください" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>タイプ</SelectLabel>
                {itemTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.display_name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <input type="hidden" name="item_type_id" value={selectedTypeId} />
          {fields.item_type_id.errors && (
            <span className="text-red-500 text-sm">
              {fields.item_type_id.errors}
            </span>
          )}
        </div>
        <div>
          <Label htmlFor={fields.abbr.id} className="text-gray-700">
            略称
          </Label>
          <Input
            type="text"
            id={fields.abbr.id}
            key={fields.abbr.key}
            name={fields.abbr.name}
            defaultValue={fields.abbr.initialValue}
            required
            placeholder="俺ブレ"
            className="mt-1 w-full"
          />
          {fields.abbr.errors && (
            <span className="text-red-500 text-sm">{fields.abbr.errors}</span>
          )}
        </div>
        <div>
          <Label htmlFor={fields.key.id} className="text-gray-700">
            割当キー
          </Label>
          <Input
            type="text"
            id={fields.key.id}
            key={fields.key.key}
            name={fields.key.name}
            defaultValue={fields.key.initialValue}
            required
            placeholder=". @ など記号1文字"
            className="mt-1 w-full"
          />
          {fields.key.errors && (
            <span className="text-red-500 text-sm">{fields.key.errors}</span>
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
  );
}
