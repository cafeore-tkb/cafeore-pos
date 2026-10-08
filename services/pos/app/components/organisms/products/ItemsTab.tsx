import type {
  ItemEntity,
  StockResource,
  StockUsage,
  WithId,
} from "@cafeore/common";
import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { sortResources, usagesByItem } from "~/lib/stock";
import { RowActions, type RowHandlers } from "./RowActions";
import type { Usage } from "./usage";

export function ItemsTab({
  items,
  usage,
  resources,
  stockUsages,
  ...handlers
}: RowHandlers & {
  items: WithId<ItemEntity>[];
  usage: Usage;
  resources: StockResource[];
  stockUsages: StockUsage[];
}) {
  // 「ホットカップ 1・ケニア豆 15g」のように並べる
  const stockOf = useMemo(() => {
    const byItem = usagesByItem(stockUsages);
    const sorted = sortResources(resources);
    return (itemId: string) => {
      const amounts = byItem.get(itemId);
      return sorted
        .filter((r) => amounts?.has(r.id))
        .map(
          (r) =>
            `${r.name} ${amounts?.get(r.id)}${r.kind === "bean" ? r.unit : ""}`,
        )
        .join("・");
    };
  }, [stockUsages, resources]);

  // 使用量が入っているアイテムがあるタイプ。そうでないタイプ（グッズなど）は未設定でも目立たせない
  const countedTypes = useMemo(() => {
    const used = new Set(stockUsages.map((u) => u.item_id));
    return new Set(
      items
        .filter((item) => used.has(item.id))
        .map((item) => item.item_type.id),
    );
  }, [items, stockUsages]);

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
                <TableHead className="w-40">使っているメニュー</TableHead>
                <TableHead className="w-52">在庫の使用量</TableHead>
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
                    <StockCell
                      text={stockOf(item.id)}
                      warn={countedTypes.has(item.item_type.id)}
                    />
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

function StockCell({ text, warn }: { text: string; warn: boolean }) {
  if (text) {
    return (
      <TableCell className="truncate text-sm" title={text}>
        {text}
      </TableCell>
    );
  }
  return (
    <TableCell
      className={warn ? "text-amber-600 text-sm" : "text-muted-foreground"}
    >
      未設定
    </TableCell>
  );
}
