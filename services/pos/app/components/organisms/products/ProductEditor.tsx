import {
  ItemEntity,
  type ItemType,
  MenuEntity,
  type WithId,
  itemRepository,
  itemTypeRepository,
  menuRepository,
} from "@cafeore/common";
import { useState } from "react";
import { toast } from "sonner";
import {
  ItemForm,
  type ItemFormValues,
  type SameNameMenu,
} from "~/components/organisms/itemForm";
import {
  ItemTypeForm,
  type ItemTypeFormValues,
} from "~/components/organisms/itemTypeForm";
import { MenuForm, type MenuFormValues } from "~/components/organisms/menuForm";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { copyName } from "~/lib/utils";

export type ProductKind = "menu" | "item" | "itemType";

// copy は元の値を入れた新規作成
export type Editing = {
  kind: ProductKind;
  mode: "new" | "edit" | "copy";
  id?: string;
};

const kindLabels: Record<ProductKind, string> = {
  menu: "メニュー",
  item: "アイテム",
  itemType: "タイプ",
};

const modeLabels: Record<Editing["mode"], string> = {
  new: "追加",
  edit: "編集",
  copy: "複製",
};

type Props = {
  editing: Editing | null;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
  menus: WithId<MenuEntity>[];
  items: WithId<ItemEntity>[];
  itemTypes: ItemType[];
};

export function ProductEditor({
  editing,
  onClose,
  onSaved,
  menus,
  items,
  itemTypes,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  // 同名のメニューだけ保存に失敗したとき、そのメニューの追加を入力済みで出し直す
  const [menuRetry, setMenuRetry] = useState<MenuFormValues | null>(null);
  const current: Editing | null = menuRetry
    ? { kind: "menu", mode: "new" }
    : editing;

  const close = () => {
    setMenuRetry(null);
    onClose();
  };

  const save = async (run: () => Promise<unknown>) => {
    if (!current) return;
    try {
      setSubmitting(true);
      await run();
      await onSaved();
      toast.success(
        `${kindLabels[current.kind]}を${current.mode === "edit" ? "更新" : "追加"}しました`,
      );
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  // アイテムの編集中にその場でタイプを足す。パネルは閉じない
  const createItemType = async (values: ItemTypeFormValues) => {
    try {
      const created = await itemTypeRepository.save(values);
      await onSaved();
      toast.success(`タイプ「${created.display_name}」を追加しました`);
      return created;
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "タイプの追加に失敗しました",
      );
      throw e;
    }
  };

  const saveItemWithMenu = async (
    values: ItemFormValues,
    menu: SameNameMenu,
  ) => {
    setSubmitting(true);
    try {
      let item: WithId<ItemEntity>;
      try {
        item = await itemRepository.save(
          toItemEntity(values, itemTypes, undefined),
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "保存に失敗しました");
        return;
      }
      const menuValues: MenuFormValues = {
        name: item.name,
        abbr: item.abbr,
        ...menu,
        items: [{ item, quantity: 1 }],
      };
      try {
        await menuRepository.save(MenuEntity.createNew(menuValues));
      } catch (e) {
        // アイテムはもうできているので、同じ入力でやり直すとアイテムが重複する。メニューだけ作り直してもらう
        toast.error(
          `アイテムは追加しましたが、メニューの追加に失敗しました: ${
            e instanceof Error ? e.message : "不明なエラー"
          }。内容を確かめてもう一度保存してください`,
        );
        setMenuRetry(menuValues);
        await onSaved();
        return;
      }
      toast.success("アイテムとメニューを追加しました");
      await onSaved();
      close();
    } finally {
      setSubmitting(false);
    }
  };

  // 編集・複製の元が他の端末で消されていたら何も出さない
  const form = current && renderForm(current);

  function renderForm({ kind, mode, id }: Editing) {
    const isEdit = mode === "edit";
    // フォームは初期値を最初の描画でしか読まないので、対象が変わったら作り直す
    const formKey = `${kind}-${mode}-${id ?? ""}`;

    if (kind === "menu") {
      const source = menus.find((menu) => menu.id === id);
      if (mode !== "new" && !source) return null;
      const initialMenu = source
        ? isEdit
          ? source
          : {
              name: copyName(source.name),
              abbr: source.abbr,
              price: source.price,
              // キーは重複できないので入れ直してもらう
              key: "",
              items: source.items,
            }
        : (menuRetry ?? undefined);
      return (
        <MenuForm
          key={formKey}
          items={items}
          initialMenu={initialMenu}
          usedKeys={menus
            .filter((menu) => !(isEdit && menu.id === id))
            .map((menu) => menu.key)}
          submitting={submitting}
          onSubmit={(values) =>
            save(() =>
              menuRepository.save(
                isEdit && id
                  ? MenuEntity.fromMenu({ id, ...values, assignee: null })
                  : MenuEntity.createNew(values),
              ),
            )
          }
        />
      );
    }

    if (kind === "item") {
      const source = items.find((item) => item.id === id);
      if (mode !== "new" && !source) return null;
      const initialItem =
        source &&
        (isEdit
          ? source
          : ItemEntity.createNew({
              name: copyName(source.name),
              abbr: source.abbr,
              item_type: source.item_type,
            }));
      return (
        <ItemForm
          key={formKey}
          initialItem={initialItem}
          itemTypes={itemTypes}
          submitting={submitting}
          onCreateItemType={createItemType}
          menuKeysInUse={isEdit ? undefined : menus.map((menu) => menu.key)}
          onSubmit={(values, menu) =>
            menu
              ? saveItemWithMenu(values, menu)
              : save(() =>
                  itemRepository.save(
                    toItemEntity(values, itemTypes, isEdit ? id : undefined),
                  ),
                )
          }
        />
      );
    }

    const source = itemTypes.find((itemType) => itemType.id === id);
    if (mode !== "new" && !source) return null;
    const initialValue =
      source &&
      (isEdit
        ? source
        : {
            ...source,
            display_name: copyName(source.display_name),
          });
    return (
      <ItemTypeForm
        key={formKey}
        initialValue={initialValue}
        submitting={submitting}
        onSubmit={(values: ItemTypeFormValues) =>
          save(() =>
            itemTypeRepository.save({ ...values, id: isEdit ? id : undefined }),
          )
        }
      />
    );
  }

  return (
    <Sheet
      open={form != null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <SheetContent
        className="flex w-full flex-col gap-6 overflow-y-auto sm:max-w-xl"
        // 見出しだけで用が足りるので説明文は置かない
        aria-describedby={undefined}
      >
        {current && (
          <SheetHeader>
            <SheetTitle>
              {kindLabels[current.kind]}の{modeLabels[current.mode]}
            </SheetTitle>
          </SheetHeader>
        )}
        {form}
      </SheetContent>
    </Sheet>
  );
}

function toItemEntity(
  values: ItemFormValues,
  itemTypes: ItemType[],
  id: string | undefined,
): ItemEntity {
  const itemType = itemTypes.find((t) => t.id === values.itemTypeId);
  if (!itemType) {
    throw new Error("item type が見つかりません");
  }
  const item = { name: values.name, abbr: values.abbr, item_type: itemType };
  return id ? ItemEntity.fromItem({ id, ...item }) : ItemEntity.createNew(item);
}
