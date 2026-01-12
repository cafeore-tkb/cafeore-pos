import type { ItemResponse, ItemTypeResponse } from "@cafeore/common";
import { itemResponseRepository } from "@cafeore/common";
import { itemTypeResponseRepository } from "@cafeore/common";
import { Link, type MetaFunction, Outlet } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

export const meta: MetaFunction = () => {
  return [{ title: "アイテム一覧 / 珈琲・俺POS" }];
};

// コンポーネントではデータの取得と更新のみを行う
export default function ItemsList() {
  const [items, setItems] = useState<ItemResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [itemTypeMap, setItemTypeMap] = useState<
    Record<string, ItemTypeResponse>
  >({});

  useEffect(() => {
    loadItems();
    loadItemTypes();
  }, []);

  const loadItems = async () => {
    try {
      setLoading(true);
      const data = await itemResponseRepository.findAll();
      setItems(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const loadItemTypes = async () => {
    const types = await itemTypeResponseRepository.findAll();

    const map: Record<string, ItemTypeResponse> = {};
    for (const t of types) {
      map[t.id] = t;
    }
    setItemTypeMap(map);
  };

  const handleDelete = async (id: string | undefined) => {
    if (!confirm("本当に削除しますか？")) return;

    try {
      if (id !== undefined) {
        await itemResponseRepository.delete(id);
      }
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    }
  };

  // もともとのにあった気がする
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-gray-600">読み込み中...</div>
      </div>
    );
  }

  // /items/create などの子ルートの場合は Outlet を表示
  if (location.pathname !== "/items" && location.pathname !== "/items/") {
    return <Outlet />;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-bold text-2xl">アイテム一覧</h1>
          <Button>
            <Link to="/items/create">+ 新規作成</Link>
          </Button>
        </div>

        {/* エラーメッセージ */}
        {error && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-red-700">
            {error}
          </div>
        )}

        {/* アイテム一覧 */}
        {items.length === 0 ? (
          <div className="rounded-lg bg-white p-8 text-center text-gray-500 shadow">
            アイテムがありません
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg bg-white shadow">
            <Table className="w-full">
              <TableHeader className="border-b bg-gray-50">
                <TableRow>
                  <TableHead className="px-6 py-3 text-right font-medium text-gray-700 text-sm">
                    名前
                  </TableHead>
                  <TableHead className="px-6 py-3 text-right font-medium text-gray-700 text-sm">
                    タイプ
                  </TableHead>
                  <TableHead className="px-6 py-3 text-right font-medium text-gray-700 text-sm">
                    略称
                  </TableHead>
                  <TableHead className="px-6 py-3 text-right font-medium text-gray-700 text-sm">
                    割当キー
                  </TableHead>
                  <TableHead className="px-6 py-3 text-right font-medium text-gray-700 text-sm">
                    操作
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y">
                {items.map((item) => (
                  <TableRow key={item.id} className="hover:bg-gray-50">
                    <TableCell className="px-6 py-4 text-gray-900 text-sm">
                      {item.name}
                    </TableCell>
                    <TableCell className="px-6 py-4 text-gray-600 text-sm">
                      <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 font-medium text-blue-800 text-xs">
                        {itemTypeMap[item.item_type_id]?.display_name ?? "不明"}
                      </span>
                    </TableCell>
                    <TableCell className="px-6 py-4 text-gray-900 text-sm">
                      {item.abbr}
                    </TableCell>
                    <TableCell className="px-6 py-4 text-gray-900 text-sm">
                      {item.key}
                    </TableCell>
                    <TableCell className="space-x-2 px-6 py-4 text-right text-sm">
                      <Link
                        to={`/items/${item.id}/edit`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        編集
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        削除
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
