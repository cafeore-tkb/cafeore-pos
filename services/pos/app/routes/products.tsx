import {
  itemRepository,
  itemTypeRepository,
  menuRepository,
  useItemMaster,
  useMenuMaster,
} from "@cafeore/common";
import { useState } from "react";
import { type MetaFunction, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ColorSettingsTab } from "~/components/organisms/products/ColorSettingsTab";
import { ItemTypesTab } from "~/components/organisms/products/ItemTypesTab";
import { ItemsTab } from "~/components/organisms/products/ItemsTab";
import { MasterDataTab } from "~/components/organisms/products/MasterDataTab";
import { MenusTab } from "~/components/organisms/products/MenusTab";
import {
  type Editing,
  ProductEditor,
  type ProductKind,
} from "~/components/organisms/products/ProductEditor";
import type { RowHandlers } from "~/components/organisms/products/RowActions";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";

export const meta: MetaFunction = () => {
  return [{ title: "商品管理 / 珈琲・俺POS" }];
};

type Tab = "menus" | "items" | "item-types" | "colors" | "master-data";

// kind があるタブは追加・編集できる
const tabs: { value: Tab; label: string; kind?: ProductKind }[] = [
  { value: "menus", label: "メニュー", kind: "menu" },
  { value: "items", label: "アイテム", kind: "item" },
  { value: "item-types", label: "タイプ", kind: "itemType" },
  { value: "colors", label: "背景色" },
  { value: "master-data", label: "取り込み・書き出し" },
];

const isTab = (value: string | null): value is Tab =>
  tabs.some((tab) => tab.value === value);

const repositories = {
  menu: menuRepository,
  item: itemRepository,
  itemType: itemTypeRepository,
} satisfies Record<ProductKind, { delete: (id: string) => Promise<void> }>;

export default function ProductsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = isTab(tabParam) ? tabParam : "menus";
  const kind = tabs.find((t) => t.value === tab)?.kind;

  const {
    menus,
    error: menusError,
    isLoading: menusLoading,
    mutateMenus,
  } = useMenuMaster();
  const {
    items,
    itemTypes,
    error: itemsError,
    isLoading: itemsLoading,
    mutateItems,
    mutateItemTypes,
  } = useItemMaster();
  const [editing, setEditing] = useState<Editing | null>(null);

  // メニューはアイテムを、アイテムはタイプを含んで返るので、どれを変えても全部取り直す
  const refresh = () =>
    Promise.all([mutateMenus(), mutateItems(), mutateItemTypes()]);

  const handlersFor = (kind: ProductKind): RowHandlers => ({
    onEdit: (id) => setEditing({ kind, mode: "edit", id }),
    onCopy: (id) => setEditing({ kind, mode: "copy", id }),
    onDelete: async (id) => {
      if (!window.confirm("削除しますか？")) return;
      try {
        await repositories[kind].delete(id);
        await refresh();
        toast.success("削除しました");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "削除に失敗しました");
      }
    },
  });

  const error = menusError ?? itemsError;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">商品管理</h1>
        <p className="text-muted-foreground text-sm">
          メニュー、構成アイテム、アイテムタイプ、背景色を管理します。まとめて取り込み・書き出しもできます
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) =>
          setSearchParams({ tab: value }, { replace: true })
        }
      >
        <div className="flex items-center justify-between gap-4">
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {kind && (
            <Button onClick={() => setEditing({ kind, mode: "new" })}>
              ＋ 追加
            </Button>
          )}
        </div>

        {error ? (
          <div className="mt-4">
            エラー: {error instanceof Error ? error.message : String(error)}
          </div>
        ) : menusLoading || itemsLoading ? (
          <div className="mt-4">読み込み中...</div>
        ) : (
          <>
            <TabsContent value="menus" className="mt-4">
              <MenusTab menus={menus} {...handlersFor("menu")} />
            </TabsContent>
            <TabsContent value="items" className="mt-4">
              <ItemsTab items={items} {...handlersFor("item")} />
            </TabsContent>
            <TabsContent value="item-types" className="mt-4">
              <ItemTypesTab
                itemTypes={itemTypes}
                {...handlersFor("itemType")}
              />
            </TabsContent>
            <TabsContent value="colors" className="mt-4">
              <ColorSettingsTab />
            </TabsContent>
            <TabsContent value="master-data" className="mt-4">
              <MasterDataTab onImported={refresh} />
            </TabsContent>
          </>
        )}
      </Tabs>

      <ProductEditor
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={refresh}
        menus={menus}
        items={items}
        itemTypes={itemTypes}
      />
    </div>
  );
}
