import {
  Calendar,
  CheckCircle2,
  Coffee,
  Edit3,
  Filter,
  Flame,
  Plus,
  Save,
  Search,
  Tag,
  X,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { BEAN_LEGENDS } from "../data/initialData";
import type { BeanCode, BeanItem } from "../types";

interface BeanQueueViewProps {
  beans: BeanItem[];
  onUpdateBean: (updatedBean: BeanItem) => void;
  onAddBean: (newBean: BeanItem) => void;
}

export const BeanQueueView: React.FC<BeanQueueViewProps> = ({
  beans,
  onUpdateBean,
  onAddBean,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRoastFilter, setSelectedRoastFilter] = useState<string>("all");
  const [editingCode, setEditingCode] = useState<BeanCode | null>(null);
  const [editFormData, setEditFormData] = useState<BeanItem | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newBeanData, setNewBeanData] = useState<BeanItem>({
    code: "CHAMP",
    name: "",
    roastProfile: "シティロースト (中煎り)",
    roastDate: new Date().toISOString().split("T")[0],
    flavorNotes: "",
    origin: "",
    stockGrams: 1000,
  });

  const roastOptions = [
    "all",
    "浅煎り",
    "中煎り",
    "中深煎り",
    "深煎り",
    "極深煎り",
  ];

  const filteredBeans = beans.filter((b) => {
    const matchesSearch =
      b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.flavorNotes.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.origin.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesRoast =
      selectedRoastFilter === "all" ||
      b.roastProfile.includes(selectedRoastFilter);

    return matchesSearch && matchesRoast;
  });

  const startEdit = (bean: BeanItem) => {
    setEditingCode(bean.code);
    setEditFormData({ ...bean });
  };

  const cancelEdit = () => {
    setEditingCode(null);
    setEditFormData(null);
  };

  const saveEdit = () => {
    if (editFormData) {
      onUpdateBean(editFormData);
      setEditingCode(null);
      setEditFormData(null);
    }
  };

  const handleAddNewSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBeanData.name.trim()) return;
    onAddBean(newBeanData);
    setIsAddingNew(false);
    setNewBeanData({
      code: "SP",
      name: "",
      roastProfile: "シティロースト (中煎り)",
      roastDate: new Date().toISOString().split("T")[0],
      flavorNotes: "",
      origin: "",
      stockGrams: 1000,
    });
  };

  return (
    <div className="max-w-none touch-manipulation space-y-3">
      {/* Header & Actions */}
      <div className="flex flex-col gap-2 border-slate-200 border-b pb-3">
        <div>
          <h2 className="flex items-center gap-2 font-black text-[16px] text-slate-900 tracking-tight">
            <Coffee className="h-5 w-5 text-[#006c4a]" />
            <span>豆キュー</span>
          </h2>
          <p className="mt-0.5 text-slate-500 text-xs">
            銘柄と在庫を確認・編集
          </p>
        </div>

        <button
          id="btn-add-new-bean"
          onClick={() => setIsAddingNew(true)}
          className="flex min-h-[44px] shrink-0 cursor-pointer select-none items-center justify-center gap-2 rounded-lg bg-[#006c4a] px-4 py-2 font-bold text-white text-xs shadow-xs transition-all hover:bg-[#005137] active:scale-95 sm:text-sm"
        >
          <Plus className="h-4 w-4" />
          <span>新規コーヒー豆追加</span>
        </button>
      </div>

      {/* Filter / Search Bar for iPad Quick Interaction */}
      <div className="flex flex-col items-stretch gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
        <div className="relative flex-1">
          <Search className="-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="銘柄名、産地、フレーバーノートで検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-slate-800 text-xs placeholder-slate-400 transition-all focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 sm:text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Filter className="hidden h-3.5 w-3.5 shrink-0 text-slate-400 sm:inline" />
          {roastOptions.map((opt) => (
            <button
              key={opt}
              onClick={() => setSelectedRoastFilter(opt)}
              className={`min-h-[36px] cursor-pointer whitespace-nowrap rounded-md px-3 py-1 font-semibold text-xs transition-all ${
                selectedRoastFilter === opt
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {opt === "all" ? "全ロースト" : opt}
            </button>
          ))}
        </div>
      </div>

      {/* Add New Bean Form Modal */}
      {isAddingNew && (
        <div className="fixed inset-0 z-50 flex select-none items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-300 bg-white shadow-xl">
            <div className="flex items-center justify-between border-slate-200 border-b bg-slate-50 px-5 py-4">
              <h3 className="flex items-center gap-2 font-black text-base text-slate-900">
                <Plus className="h-4 w-4 text-emerald-600" />
                <span>新規コーヒー銘柄の登録</span>
              </h3>
              <button
                onClick={() => setIsAddingNew(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={handleAddNewSubmit}
              className="space-y-3.5 p-5 text-xs"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-bold text-slate-700">
                    豆コード
                  </label>
                  <select
                    value={newBeanData.code}
                    onChange={(e) =>
                      setNewBeanData({
                        ...newBeanData,
                        code: e.target.value as BeanCode,
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 font-bold font-mono"
                  >
                    {BEAN_LEGENDS.map((leg) => (
                      <option key={leg.code} value={leg.code}>
                        {leg.code} ({leg.subLabel})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-bold text-slate-700">
                    在庫量 (g)
                  </label>
                  <input
                    type="number"
                    value={newBeanData.stockGrams}
                    onChange={(e) =>
                      setNewBeanData({
                        ...newBeanData,
                        stockGrams: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 font-mono"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-bold text-slate-700">
                  銘柄名
                </label>
                <input
                  type="text"
                  placeholder="例: エチオピア イルガチェフェ G1"
                  value={newBeanData.name}
                  onChange={(e) =>
                    setNewBeanData({ ...newBeanData, name: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 font-bold text-slate-900"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-bold text-slate-700">
                    焙煎度
                  </label>
                  <input
                    type="text"
                    value={newBeanData.roastProfile}
                    onChange={(e) =>
                      setNewBeanData({
                        ...newBeanData,
                        roastProfile: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block font-bold text-slate-700">
                    焙煎日・エイジング
                  </label>
                  <input
                    type="text"
                    value={newBeanData.roastDate}
                    onChange={(e) =>
                      setNewBeanData({
                        ...newBeanData,
                        roastDate: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-bold text-slate-700">
                  産地・精製方法
                </label>
                <input
                  type="text"
                  placeholder="例: エチオピア・イルガチェフェ地区 / 水洗式"
                  value={newBeanData.origin}
                  onChange={(e) =>
                    setNewBeanData({ ...newBeanData, origin: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block font-bold text-slate-700">
                  フレーバーノート
                </label>
                <textarea
                  rows={2}
                  placeholder="例: ジャスミン, アールグレイ, ピーチ, シトラス"
                  value={newBeanData.flavorNotes}
                  onChange={(e) =>
                    setNewBeanData({
                      ...newBeanData,
                      flavorNotes: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 text-slate-800"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-slate-200 border-t pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddingNew(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#006c4a] px-5 py-2 font-bold text-white hover:bg-[#005137]"
                >
                  豆キューに登録
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bean Cards Grid */}
      <div className="grid grid-cols-1 gap-2">
        {filteredBeans.map((bean) => {
          const legend = BEAN_LEGENDS.find((l) => l.code === bean.code);
          const isEditing = editingCode === bean.code;

          return (
            <div
              key={bean.code}
              id={`bean-card-${bean.code.toLowerCase()}`}
              className={`flex select-none flex-col justify-between rounded-xl border bg-white p-3 shadow-xs transition-all ${
                isEditing
                  ? "border-blue-500 bg-blue-50/20 shadow-md ring-2 ring-blue-500"
                  : "border-slate-300 hover:border-slate-400 hover:shadow-sm"
              }`}
            >
              {isEditing && editFormData ? (
                /* Edit Mode */
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-slate-200 border-b pb-2">
                    <span className="font-bold font-mono text-blue-700 text-xs">
                      編集モード
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={cancelEdit}
                        className="rounded p-1 text-slate-400 hover:text-slate-600"
                        title="キャンセル"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-0.5 block font-bold text-[10px] text-slate-500">
                      銘柄名
                    </label>
                    <input
                      type="text"
                      value={editFormData.name}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          name: e.target.value,
                        })
                      }
                      className="w-full rounded border border-slate-300 bg-white p-1.5 font-bold text-slate-900 text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-0.5 block font-bold text-[10px] text-slate-500">
                        在庫 (g)
                      </label>
                      <input
                        type="number"
                        value={editFormData.stockGrams}
                        onChange={(e) =>
                          setEditFormData({
                            ...editFormData,
                            stockGrams: Number(e.target.value),
                          })
                        }
                        className="w-full rounded border border-slate-300 bg-white p-1.5 font-bold font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block font-bold text-[10px] text-slate-500">
                        焙煎度
                      </label>
                      <input
                        type="text"
                        value={editFormData.roastProfile}
                        onChange={(e) =>
                          setEditFormData({
                            ...editFormData,
                            roastProfile: e.target.value,
                          })
                        }
                        className="w-full rounded border border-slate-300 bg-white p-1.5 text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-0.5 block font-bold text-[10px] text-slate-500">
                      焙煎日・エイジング
                    </label>
                    <input
                      type="text"
                      value={editFormData.roastDate}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          roastDate: e.target.value,
                        })
                      }
                      className="w-full rounded border border-slate-300 bg-white p-1.5 text-xs"
                    />
                  </div>

                  <div>
                    <label className="mb-0.5 block font-bold text-[10px] text-slate-500">
                      産地・規格
                    </label>
                    <input
                      type="text"
                      value={editFormData.origin}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          origin: e.target.value,
                        })
                      }
                      className="w-full rounded border border-slate-300 bg-white p-1.5 text-xs"
                    />
                  </div>

                  <div>
                    <label className="mb-0.5 block font-bold text-[10px] text-slate-500">
                      フレーバーノート
                    </label>
                    <textarea
                      rows={2}
                      value={editFormData.flavorNotes}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          flavorNotes: e.target.value,
                        })
                      }
                      className="w-full rounded border border-slate-300 bg-white p-1.5 text-slate-800 text-xs"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={saveEdit}
                      className="flex flex-1 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 font-bold text-white text-xs shadow-2xs hover:bg-blue-700 active:bg-blue-800"
                    >
                      <Save className="h-3.5 w-3.5" />
                      <span>保存</span>
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="touch-manipulation rounded-lg bg-slate-100 px-3 py-2 font-semibold text-slate-700 text-xs hover:bg-slate-200"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                /* Normal Display Mode */
                <div className="flex h-full flex-col justify-between">
                  <div>
                    {/* Top Row: Code Badge & Stock & Edit Button */}
                    <div className="mb-2 flex items-center justify-between">
                      <span
                        className={`rounded border px-2 py-0.5 font-bold font-mono text-xs ${legend?.badgeBg} ${legend?.badgeText} ${legend?.borderColor}`}
                      >
                        {bean.code}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-bold font-mono text-slate-700 text-xs">
                          {bean.stockGrams}g
                        </span>
                        <button
                          onClick={() => startEdit(bean)}
                          className="flex min-h-[32px] min-w-[32px] cursor-pointer touch-manipulation items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-600"
                          title="豆情報を編集"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Bean Name */}
                    <h3 className="mb-2 font-bold text-[14px] text-slate-900 leading-tight">
                      {bean.name}
                    </h3>

                    {/* Metadata list */}
                    <div className="space-y-1.5 text-slate-600 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Flame className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                        <span className="font-medium text-slate-800">
                          {bean.roastProfile}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                        <span className="text-[11px] text-slate-600">
                          {bean.roastDate}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Tag className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        <span
                          className="truncate text-[11px] text-slate-600"
                          title={bean.origin}
                        >
                          {bean.origin}
                        </span>
                      </div>
                    </div>

                    {/* Flavor Notes Box */}
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-700">
                      <span className="mb-0.5 block font-bold text-slate-500">
                        フレーバーノート:
                      </span>
                      <span className="leading-snug">{bean.flavorNotes}</span>
                    </div>
                  </div>

                  {/* Footer status & quick action */}
                  <div className="mt-4 flex items-center justify-between border-slate-100 border-t pt-2.5 text-[11px]">
                    <span className="flex items-center gap-1 font-semibold text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      ディスパッチ連動
                    </span>

                    <button
                      onClick={() => startEdit(bean)}
                      className="touch-manipulation font-bold text-blue-600 text-xs hover:text-blue-800 hover:underline"
                    >
                      内容を編集
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filteredBeans.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed bg-slate-50 py-12 text-center text-slate-400 text-xs">
            該当するコーヒー豆が見つかりませんでした。
          </div>
        )}
      </div>
    </div>
  );
};
