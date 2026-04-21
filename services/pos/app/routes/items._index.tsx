// routes/items._index.tsx
import { type ItemEntity, type WithId, itemRepository } from "@cafeore/common";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type MetaFunction, useNavigate } from "react-router";
import { Button } from "~/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/utils";

export const meta: MetaFunction = () => {
  return [{ title: "アイテム一覧 / 珈琲・俺POS" }];
};

export default function ItemsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<WithId<ItemEntity>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await itemRepository.findAll();
      setItems(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load items");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (id: string) => {
    const ok = window.confirm("このアイテムを削除しますか？");
    if (!ok) return;

    try {
      await itemRepository.delete(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "削除に失敗しました");
    }
  };

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

  if (loading) return <div>読み込み中...</div>;
  if (error) return <div>エラー: {error}</div>;

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="font-bold text-xl">アイテム一覧</h1>
      <Table>
        <TableHeader
          className={cn("sticky top-0 z-10 bg-background [&_tr]:border-b")}
        >
          <TableRow>
            <TableHead>名前</TableHead>
            <TableHead>略称</TableHead>
            <TableHead>価格</TableHead>
            <TableHead>キー</TableHead>
            <TableHead>種別</TableHead>
            <TableHead className="w-40">操作</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {sortedItems.map((item) => (
            <TableRow
              key={item.id}
              className="cursor-pointer"
              onClick={() => navigate(`/items/${item.id}/edit`)}
            >
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell>{item.abbr}</TableCell>
              <TableCell>￥{item.price}</TableCell>
              <TableCell>{item.key}</TableCell>
              <TableCell>{item.item_type.display_name}</TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/items/${item.id}/edit`);
                    }}
                  >
                    編集
                  </Button>

                  <Button
                    type="button"
                    variant="destructive"
                    onClick={async (e) => {
                      e.stopPropagation();
                      await handleDelete(item.id);
                    }}
                  >
                    削除
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
