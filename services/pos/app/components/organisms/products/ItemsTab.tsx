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
import type { Usage } from "./usage";

export function ItemsTab({
  items,
  usage,
  ...handlers
}: RowHandlers & { items: WithId<ItemEntity>[]; usage: Usage }) {
  const groups = useMemo(() => {
    const byType = new Map<string, WithId<ItemEntity>[]>();
    for (const item of items) {
      const type = item.item_type.display_name;
      byType.set(type, [...(byType.get(type) ?? []), item]);
    }
    return [...byType.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "ja"))
      .map(([type, typeItems]) => ({
        type,
        items: typeItems.sort((a, b) => a.name.localeCompare(b.name, "ja")),
      }));
  }, [items]);

  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground text-sm">
        アイテムがありません。「＋ 追加」から作れます
      </p>
    );
  }

  return (
    <div className="grid gap-6">
      {groups.map((group) => (
        <section key={group.type} className="grid gap-1">
          <h2 className="font-semibold">
            {group.type}
            <span className="ml-2 font-normal text-muted-foreground text-sm">
              {group.items.length}件
            </span>
          </h2>
          {/* 種類ごとの表で列の位置をそろえる */}
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>名前</TableHead>
                <TableHead className="w-32">略称</TableHead>
                <TableHead className="w-48">使っているメニュー</TableHead>
                <TableHead className="w-60">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.items.map((item) => {
                const menus = usage.get(item.id) ?? [];
                return (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() => handlers.onEdit(item.id)}
                  >
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.abbr}</TableCell>
                    <TableCell
                      className="text-muted-foreground"
                      title={menus.join("、")}
                    >
                      {menus.length === 0 ? "なし" : `${menus.length}件`}
                    </TableCell>
                    <TableCell>
                      <RowActions id={item.id} {...handlers} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      ))}
    </div>
  );
}
