import {
  colorScreens,
  findColorSetting,
  openapiEnumLabels,
  useColorSettings,
  useItemMaster,
} from "@cafeore/common";
import { ColorSettingCell } from "~/components/organisms/colorSettingCell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

export function ColorSettingsTab() {
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
    <div className="flex flex-col gap-8">
      <p className="text-muted-foreground text-sm">
        画面ごとのアイテムの背景色です。アイテムの設定 → タイプの設定
        の順に使われ、どちらも無ければ色を付けません（レジのボタンはボタンの既定の色）。
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-lg">タイプ</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>タイプ</TableHead>
              {colorScreens.map((screen) => (
                <TableHead key={screen}>
                  {openapiEnumLabels("ColorScreen")[screen]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {itemTypes.map((itemType) => (
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
                <TableHead key={screen}>
                  {openapiEnumLabels("ColorScreen")[screen]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
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
