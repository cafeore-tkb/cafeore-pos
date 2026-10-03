import type { ItemEntity, WithId } from "@cafeore/common";
import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { RowActions, type RowHandlers } from "./RowActions";

export function ItemsTab({
  items,
  ...handlers
}: RowHandlers & { items: WithId<ItemEntity>[] }) {
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const typeCompare = a.item_type.display_name.localeCompare(
        b.item_type.display_name,
        "ja",
      );
      if (typeCompare !== 0) return typeCompare;

      return a.name.localeCompare(b.name, "ja");
    });
  }, [items]);

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-background [&_tr]:border-b">
        <TableRow>
          <TableHead>名前</TableHead>
          <TableHead>略称</TableHead>
          <TableHead>種別</TableHead>
          <TableHead className="w-60">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedItems.map((item) => (
          <TableRow
            key={item.id}
            className="cursor-pointer"
            onClick={() => handlers.onEdit(item.id)}
          >
            <TableCell className="font-medium">{item.name}</TableCell>
            <TableCell>{item.abbr}</TableCell>
            <TableCell>{item.item_type.display_name}</TableCell>
            <TableCell>
              <RowActions id={item.id} {...handlers} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
