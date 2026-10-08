import type { ItemType } from "@cafeore/common";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { RowActions, type RowHandlers } from "./RowActions";
import type { Usage } from "./usage";

// 種類の項目を一覧で見分けられるように短く出す
const flagLabels = (itemType: ItemType) =>
  [
    itemType.makes_cup ? "カップ" : "カップなし",
    itemType.makes_cup && (itemType.needs_brew ? "抽出" : "抽出なし"),
    itemType.senior_only && "上級生のみ",
    itemType.iced_brew && "アイス",
  ].filter((label) => label !== false);

export function ItemTypesTab({
  itemTypes,
  usage,
  ...handlers
}: RowHandlers & { itemTypes: ItemType[]; usage: Usage }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>表示名</TableHead>
          <TableHead>内部名</TableHead>
          <TableHead>扱い</TableHead>
          <TableHead className="w-32">アイテム数</TableHead>
          <TableHead className="w-60">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {itemTypes.map((itemType) => {
          const { id } = itemType;
          if (!id) return null;
          const items = usage.get(id) ?? [];
          return (
            <TableRow
              key={id}
              className="cursor-pointer"
              onClick={() => handlers.onEdit(id)}
            >
              <TableCell className="font-medium">
                {itemType.display_name}
              </TableCell>
              <TableCell className="font-mono text-muted-foreground text-sm">
                {itemType.name}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {flagLabels(itemType).join("・")}
              </TableCell>
              <TableCell
                className="text-muted-foreground"
                title={items.join("、")}
              >
                {items.length}件
              </TableCell>
              <TableCell>
                <RowActions id={id} {...handlers} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
