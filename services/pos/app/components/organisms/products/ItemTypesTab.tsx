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

export function ItemTypesTab({
  itemTypes,
  ...handlers
}: RowHandlers & { itemTypes: ItemType[] }) {
  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-background [&_tr]:border-b">
        <TableRow>
          <TableHead>name</TableHead>
          <TableHead>display_name</TableHead>
          <TableHead className="w-60">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {itemTypes.map(
          (itemType) =>
            itemType.id && (
              <TableRow
                key={itemType.id}
                className="cursor-pointer"
                onClick={() => itemType.id && handlers.onEdit(itemType.id)}
              >
                <TableCell className="font-medium">{itemType.name}</TableCell>
                <TableCell>{itemType.display_name}</TableCell>
                <TableCell>
                  <RowActions id={itemType.id} {...handlers} />
                </TableCell>
              </TableRow>
            ),
        )}
      </TableBody>
    </Table>
  );
}
