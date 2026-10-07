import { Coffee, Plus, X } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { BEAN_NAME_MAP } from "../data/initialData";
import type { BeanCode } from "../types";
import { MENU_GROUPS, MENU_PRESENTATION } from "../utils/menuPresentation";

interface NewOrderModalProps {
  onClose: () => void;
  onAddOrder: (order: {
    beanCode: BeanCode;
    beanName: string;
    cupCount: number;
    tag: string;
    predictedTimeStr: string;
    recommendedBaristas: string;
    recommendedBayIds: number[];
    preferredBaristaId?: number;
  }) => void;
}

export const NewOrderModal: React.FC<NewOrderModalProps> = ({
  onClose,
  onAddOrder,
}) => {
  const [selectedBean, setSelectedBean] = useState<BeanCode>("CHAMP");
  const [cupCount, setCupCount] = useState<number>(1);
  const [orderType, setOrderType] = useState<string>("HOT");
  const [preferredBaristaId, setPreferredBaristaId] = useState<number | null>(
    null,
  );
  const selectMenu = (code: BeanCode) => {
    setSelectedBean(code);
    if (code === "ICE") setOrderType("ICE");
    else if (code === "MILK") setOrderType("牛");
    else if (orderType === "ICE" || orderType === "牛") setOrderType("HOT");
  };

  const handleCreate = () => {
    const name = BEAN_NAME_MAP[selectedBean];
    let predictedTime = "2分30秒";
    let recommended = "佐藤 または 渡辺";
    let bayIds = [1, 6];

    if (selectedBean === "ICE") {
      predictedTime = "3分30秒";
      recommended = "田中 (ICE専任)";
      bayIds = [4];
    } else if (selectedBean === "SP") {
      predictedTime = "3分50秒";
      recommended = "鈴木 (丁寧専任)";
      bayIds = [2];
    } else if (selectedBean === "MILK") {
      predictedTime = "2分45秒";
      recommended = "伊藤 (牛専任)";
      bayIds = [5];
    } else if (selectedBean === "ORE") {
      predictedTime = "2分35秒";
      recommended = "鈴木 または 佐藤";
      bayIds = [2, 1];
    } else if (selectedBean === "TNZ") {
      predictedTime = "2分20秒";
      recommended = "高橋 または 佐藤";
      bayIds = [3, 1];
    } else if (selectedBean === "KEN") {
      predictedTime = "2分15秒";
      recommended = "渡辺 または 高橋";
      bayIds = [6, 3];
    } else if (selectedBean === "BRA") {
      predictedTime = "2分30秒";
      recommended = "鈴木 または 渡辺";
      bayIds = [2, 6];
    }

    onAddOrder({
      beanCode: selectedBean,
      beanName: name,
      cupCount,
      tag: orderType,
      predictedTimeStr: predictedTime,
      recommendedBaristas: recommended,
      recommendedBayIds: bayIds,
      preferredBaristaId: preferredBaristaId ?? undefined,
    });
    onClose();
  };

  return (
    <div className="pointer-events-none fixed top-[56px] right-0 bottom-0 z-50 select-none">
      <div className="context-sheet pointer-events-auto h-full w-[min(440px,44vw)] min-w-[360px] overflow-y-auto border-slate-300 border-l bg-white shadow-2xl">
        <div className="flex items-center justify-between border-slate-200 border-b bg-[#f8fafc] px-5 py-4">
          <div className="flex items-center gap-2">
            <Coffee className="h-5 w-5 text-slate-700" />
            <h3 className="font-bold text-base text-slate-900">
              新規オーダー受付
            </h3>
          </div>
          <button
            onClick={onClose}
            className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-xs">
          {/* Bean selection */}
          <div className="space-y-3">
            {MENU_GROUPS.map((group) => (
              <section key={group.family}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <h4 className="font-black text-[12px] text-slate-900 tracking-[0.12em]">
                    {group.title}
                  </h4>
                  <span className="font-medium text-[11px] text-slate-500">
                    {group.description}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {group.codes.map((code) => {
                    const menu = MENU_PRESENTATION[code];
                    return (
                      <button
                        key={code}
                        onClick={() => selectMenu(code)}
                        className={`min-h-[64px] touch-manipulation rounded-xl border p-2.5 text-left transition-all ${menu.cardClass} ${selectedBean === code ? "shadow-sm ring-2 ring-slate-950" : "hover:shadow-sm"}`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={`font-black text-[15px] ${menu.family === "premium" ? "text-white" : "text-slate-950"}`}
                          >
                            {menu.shortLabel}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 font-black text-[10px] ${menu.badgeClass}`}
                          >
                            {menu.familyLabel}
                          </span>
                        </div>
                        <div
                          className={`mt-1 font-bold text-[11px] ${menu.family === "premium" ? "text-emerald-100" : "text-slate-600"}`}
                        >
                          {menu.processLabel}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <div
            className={`rounded-xl border p-3 ${MENU_PRESENTATION[selectedBean].cardClass}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-black text-[11px] text-slate-500 tracking-[0.12em]">
                  抽出工程
                </div>
                <div className="mt-1 font-black text-[16px] text-slate-950">
                  {MENU_PRESENTATION[selectedBean].processLabel}
                </div>
              </div>
              {(selectedBean === "ICE" || selectedBean === "MILK") && (
                <div className="rounded-lg bg-white/80 px-3 py-2 text-right font-bold text-[12px] text-slate-700">
                  半量をゆっくり抽出
                  <br />
                  してから仕上げ
                </div>
              )}
            </div>
          </div>

          {/* Cup count */}
          <div>
            <label className="mb-1.5 block font-bold text-slate-700">
              杯数:
            </label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4].map((num) => (
                <button
                  key={num}
                  onClick={() => setCupCount(num)}
                  className={`min-h-[44px] flex-1 touch-manipulation rounded-lg border font-bold font-mono text-sm ${
                    cupCount === num
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  {num}杯
                </button>
              ))}
            </div>
          </div>

          {/* Style */}
          <div>
            <label className="mb-1.5 block font-bold text-[14px] text-slate-700">
              提供タイプ
            </label>
            <div className="flex items-center gap-2">
              {["HOT", "ICE", "牛", "BATCH"].map((t) => (
                <button
                  key={t}
                  onClick={() => setOrderType(t)}
                  className={`min-h-[44px] flex-1 touch-manipulation rounded-lg border font-bold text-xs ${
                    orderType === t
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block font-bold text-[14px] text-slate-700">
              指名（1人のみ）
            </label>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setPreferredBaristaId(null)}
                className={`min-h-[44px] rounded-lg border font-bold text-[13px] ${preferredBaristaId === null ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`}
              >
                なし
              </button>
              {[1, 2, 3, 4, 5, 6].map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPreferredBaristaId(id)}
                  className={`min-h-[44px] rounded-lg border font-black font-mono text-[16px] ${preferredBaristaId === id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}
                >
                  {id}
                </button>
              ))}
            </div>
            {preferredBaristaId && (
              <p className="mt-2 font-bold text-[13px] text-blue-700">
                ドリッパー {preferredBaristaId} の枠を確保します
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-slate-200 border-t bg-[#f8fafc] px-5 py-3">
          <button
            onClick={onClose}
            className="min-h-[44px] touch-manipulation rounded-lg border border-slate-300 px-4 font-bold text-slate-700 text-xs hover:bg-slate-100"
          >
            キャンセル
          </button>
          <button
            onClick={handleCreate}
            className="flex min-h-[44px] touch-manipulation items-center gap-1.5 rounded-lg bg-[#006c4a] px-4 font-bold text-white text-xs shadow-xs transition-colors hover:bg-[#005137]"
          >
            <Plus className="h-4 w-4" />
            <span>未割当キューに投入</span>
          </button>
        </div>
      </div>
    </div>
  );
};
