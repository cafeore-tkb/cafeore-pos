import {
  type ItemResponse,
  type ItemTypeResponse,
  type WithId,
  itemResponseRepository,
  itemResponseSchema,
  itemTypeResponseRepository,
} from "@cafeore/common";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import {
  type ClientActionFunction,
  Form,
  type MetaFunction,
  useActionData,
  useNavigation,
  useParams,
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
import { editItem } from "./items/actions/editItem";

export const meta: MetaFunction = () => [
  { title: "アイテム編集 / 珈琲・俺POS" },
];

export const clientAction: ClientActionFunction = editItem;

export default function ItemEdit() {
  const [item, setItem] = useState<WithId<ItemResponse> | null>();
  const [itemTypes, setItemTypes] = useState<ItemTypeResponse[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    loadItemTypes();
    loadItem();
  }, []);

  const loadItemTypes = async () => {
    const types = await itemTypeResponseRepository.findAll();
    setItemTypes(types);
  };

  const loadItem = async () => {
    if (!id) return;
    const item = await itemResponseRepository.findById(id);
    setItem(item);
    if (item) {
      setSelectedTypeId(item.item_type_id);
    }
  };

  const navigation = useNavigation();
  const lastResult = useActionData<typeof editItem>();

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

  if (!item) {
    return <div>404 not Found.</div>;
  }

  return (
    <div>
      <h2 className="mb-4 font-semibold text-2xl text-gray-700">
        アイテム編集
      </h2>
      <Form
        method="PUT"
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
            defaultValue={item.name}
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
            className="block font-medium text-sm"
          >
            タイプ
          </Label>
          <Select
            defaultValue={item.item_type_id}
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
            defaultValue={item.abbr}
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
            defaultValue={item.key}
            required
            placeholder=". @ など記号1文字"
            className="mt-1 w-full"
          />
          {fields.key.errors && (
            <span className="text-red-500 text-sm">{fields.key.errors}</span>
          )}
        </div>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="item_type_id" value={selectedTypeId} />
        <Button
          type="submit"
          className="w-full bg-purple-600 text-white hover:bg-purple-700"
        >
          更新
        </Button>
      </Form>
    </div>
  );
}
