import type { ItemResponse, ItemTypeResponse } from "@cafeore/common";
import { itemResponseRepository } from "@cafeore/common";
import { itemTypeResponseRepository } from "@cafeore/common";
import { Link, type MetaFunction, Outlet } from "@remix-run/react";
import { useEffect, useState } from "react";

export const meta: MetaFunction = () => {
  return [{ title: "アイテム一覧 / 珈琲・俺POS" }];
};

// コンポーネントではデータの取得と更新のみを行う
export default function ItemsList() {
  const [items, setItems] = useState<ItemResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [itemTypes, setItemTypes] = useState<ItemTypeResponse[]>([]);
  const [itemTypeMap, setItemTypeMap] = useState<
    Record<string, ItemTypeResponse>
  >({});

  useEffect(() => {
    loadItems();
    const loadItemTypes = async () => {
      const types = await itemTypeResponseRepository.findAll();
      setItemTypes(types);

      const map: Record<string, ItemTypeResponse> = {};
      for (const t of types) {
        map[t.id] = t;
      }
      setItemTypeMap(map);
    };

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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
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
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">アイテム一覧</h1>
          <Link
            to="/items/create"
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
          >
            + 新規作成
          </Link>
        </div>

        {/* エラーメッセージ */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* アイテム一覧 */}
        {items.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            アイテムがありません
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">
                    名前
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">
                    タイプ
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">
                    略称
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">
                    割当キー
                  </th>
                  <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {item.name}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {itemTypeMap[item.item_type_id]?.display_name ?? "不明"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {item.abbr}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {item.key}
                    </td>
                    <td className="px-6 py-4 text-sm text-right space-x-2">
                      <Link
                        to={`/items/${item.id}/edit`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        編集
                      </Link>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
