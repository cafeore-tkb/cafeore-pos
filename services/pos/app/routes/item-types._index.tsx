// routes/item-types._index.tsx
import { type ItemType, itemTypeRepository } from "@cafeore/common";
import { useCallback, useEffect, useState } from "react";
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
  return [{ title: "アイテムタイプ一覧 / 珈琲・俺POS" }];
};

export default function ItemTypesPage() {
  const navigate = useNavigate();
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await itemTypeRepository.findAll();
      setItemTypes(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load item types");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (id: string) => {
    if (!window.confirm("このアイテムタイプを削除しますか？")) return;

    try {
      await itemTypeRepository.delete(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "削除に失敗しました");
    }
  };

  if (loading) return <div>読み込み中...</div>;
  if (error) return <div>エラー: {error}</div>;

  return (
    <div className="p-4 flex flex-col gap-4">
      <h1 className="text-xl font-bold">アイテムタイプ一覧</h1>
      <Table>
        <TableHeader
          className={cn("sticky top-0 z-10 bg-background [&_tr]:border-b")}
        >
          <TableRow>
            <TableHead>name</TableHead>
            <TableHead>display_name</TableHead>
            <TableHead className="w-40">操作</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {itemTypes.map((itemType) => (
            <TableRow
              key={itemType.id}
              className="cursor-pointer"
              onClick={() => navigate(`/item-types/${itemType.id}/edit`)}
            >
              <TableCell className="font-medium">{itemType.name}</TableCell>
              <TableCell>{itemType.display_name}</TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={(event) => {
                      event.stopPropagation();
                      navigate(`/item-types/${itemType.id}/edit`);
                    }}
                  >
                    編集
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={async (event) => {
                      event.stopPropagation();
                      if (itemType.id) await handleDelete(itemType.id);
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
