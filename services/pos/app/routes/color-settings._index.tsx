// routes/color-settings._index.tsx
import {
  type ColorScreen,
  colorScreens,
  findColorSetting,
  useColorSettings,
  useItemMaster,
} from "@cafeore/common";
import type { MetaFunction } from "react-router";
import { ColorSettingCell } from "~/components/organisms/colorSettingCell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

export const meta: MetaFunction = () => {
  return [{ title: "背景色設定 / 珈琲・俺POS" }];
};

const screenLabels: Record<ColorScreen, string> = {
  master: "マスター",
  serve: "提供",
};

// others はマスター・提供画面に出ない（OrderEntity.getDrinkCups で除かれる）ので設定対象から外す
const isShownOnScreens = (itemTypeName: string) => itemTypeName !== "others";

export default function ColorSettingsPage() {
  const { items, itemTypes, isLoading, error } = useItemMaster();
  const {
    colorSettings,
    isLoading: settingsLoading,
    error: settingsError,
    mutateColorSettings,
  } = useColorSettings();

  if (isLoading || settingsLoading) return <div>読み込み中...</div>;
  if (error || settingsError) {
    const e = error ?? settingsError;
    return <div>エラー: {e instanceof Error ? e.message : String(e)}</div>;
  }

  return (
    <div className="flex flex-col gap-8 p-4">
      <div className="space-y-1">
        <h1 className="font-bold text-xl">背景色設定</h1>
        <p className="text-muted-foreground text-sm">
          マスター画面・提供画面でのアイテムの背景色です。アイテムの設定 →
          タイプの設定 → 既定の色 の順に使われます。
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-lg">タイプ</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>タイプ</TableHead>
              {colorScreens.map((screen) => (
                <TableHead key={screen}>{screenLabels[screen]}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {itemTypes
              .filter((itemType) => isShownOnScreens(itemType.name))
              .map((itemType) => (
                <TableRow key={itemType.id}>
                  <TableCell className="font-medium">
                    {itemType.display_name}
                  </TableCell>
                  {colorScreens.map((screen) => (
                    <TableCell key={screen}>
                      <ColorSettingCell
                        targetType="ItemType"
                        targetId={itemType.id}
                        screen={screen}
                        setting={findColorSetting(
                          colorSettings,
                          "ItemType",
                          itemType.id,
                          screen,
                        )}
                        onChanged={mutateColorSettings}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-lg">アイテム</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名前</TableHead>
              <TableHead>種別</TableHead>
              {colorScreens.map((screen) => (
                <TableHead key={screen}>{screenLabels[screen]}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items
              .filter((item) => isShownOnScreens(item.item_type.name))
              .map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>{item.item_type.display_name}</TableCell>
                  {colorScreens.map((screen) => (
                    <TableCell key={screen}>
                      <ColorSettingCell
                        targetType="Item"
                        targetId={item.id}
                        screen={screen}
                        setting={findColorSetting(
                          colorSettings,
                          "Item",
                          item.id,
                          screen,
                        )}
                        onChanged={mutateColorSettings}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
