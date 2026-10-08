import { ArrowRight, Check, X } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { Barista, UnassignedOrder } from "../types";
import { laneOrdinal } from "../utils/lanes";

interface AssignSlotModalProps {
  bayId: number | null;
  targetOrder: UnassignedOrder | null;
  baristas: Barista[];
  unassignedOrders: UnassignedOrder[];
  onClose: () => void;
  onAssign: (orderId: string, targetBayId: number) => void;
}

export const AssignSlotModal: React.FC<AssignSlotModalProps> = ({
  bayId,
  targetOrder,
  baristas,
  unassignedOrders,
  onClose,
  onAssign,
}) => {
  const [selectedOrderUid, setSelectedOrderUid] = useState<string>(
    targetOrder
      ? targetOrder.ticketUid || targetOrder.id
      : unassignedOrders[0]?.ticketUid || unassignedOrders[0]?.id || "",
  );
  const [selectedBayId, setSelectedBayId] = useState<number>(
    bayId ??
      (targetOrder?.preferredBaristaId ||
        targetOrder?.recommendedBayIds[0] ||
        1),
  );

  const selectedOrder = unassignedOrders.find(
    (order) => (order.ticketUid || order.id) === selectedOrderUid,
  );
  const canAssign = Boolean(
    selectedOrder &&
      (!selectedOrder.preferredBaristaId ||
        selectedOrder.preferredBaristaId === selectedBayId),
  );

  return (
    <div className="pointer-events-none fixed top-[56px] right-0 bottom-0 z-50 select-none">
      <div className="context-sheet pointer-events-auto h-full w-[min(440px,44vw)] min-w-[360px] overflow-y-auto border-slate-300 border-l bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-slate-200 border-b bg-[#f8fafc] px-5 py-4">
          <h3 className="font-bold text-base text-slate-900">
            {bayId
              ? `ドリッパー ${laneOrdinal(bayId)} にオーダー割当`
              : "オーダーの割当"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 p-5 text-xs">
          {/* 1. Select Order */}
          <div>
            <div className="mb-1.5 font-bold text-slate-700">
              割り当てる未割当オーダー:
            </div>
            {unassignedOrders.length === 0 ? (
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-slate-500">
                未割当オーダーがありません
              </div>
            ) : (
              <div className="max-h-[160px] space-y-1.5 overflow-y-auto">
                {unassignedOrders.map((ord) => {
                  const uid = ord.ticketUid || ord.id;
                  const isSelected = selectedOrderUid === uid;
                  return (
                    <button
                      type="button"
                      key={uid}
                      onClick={() => {
                        setSelectedOrderUid(uid);
                        if (ord.preferredBaristaId)
                          setSelectedBayId(ord.preferredBaristaId);
                      }}
                      className={`flex w-full cursor-pointer items-center justify-between rounded-lg border p-2.5 text-left transition-all ${
                        isSelected
                          ? "border-blue-500 bg-blue-50/70 shadow-xs ring-1 ring-blue-400"
                          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-black font-mono text-[16px] text-slate-900">
                            {ord.id}
                          </span>
                          {ord.cupCount > 1 && (
                            <span className="rounded bg-amber-500 px-1.5 py-0.5 font-bold font-mono text-[10px] text-white leading-none">
                              {ord.cupCount}杯
                            </span>
                          )}
                          {ord.totalItemsInOrder &&
                            ord.totalItemsInOrder > 1 && (
                              <span className="rounded border border-amber-300 bg-amber-100 px-1 py-0.5 font-bold text-[10px] text-amber-900 leading-none">
                                [{ord.itemIndex}/{ord.totalItemsInOrder}]
                              </span>
                            )}
                          <span className="font-bold text-slate-800">
                            {ord.beanName}
                          </span>
                          {ord.preferredBaristaId && (
                            <span className="rounded bg-violet-700 px-1.5 py-0.5 font-black text-[11px] text-white">
                              指名 {ord.preferredBaristaId}
                            </span>
                          )}
                          <span className="rounded bg-slate-200 px-1.5 py-0.5 font-semibold text-[10px] text-slate-700">
                            {ord.badgeTag}
                          </span>
                        </div>
                        {ord.orderNotes && (
                          <div className="mt-0.5 font-medium text-[10.5px] text-slate-500">
                            {ord.orderNotes}
                          </div>
                        )}
                        <div className="mt-1 text-[11px] text-slate-500">
                          標準予測: {ord.predictedTimeStr}
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="h-4 w-4 shrink-0 text-blue-600" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 2. Select Bay */}
          <div>
            <div className="mb-1.5 font-bold text-slate-700">
              割当先のドリッパー（抽出担当者）:
            </div>
            <div className="grid grid-cols-3 gap-2">
              {baristas.map((b) => (
                <button
                  type="button"
                  key={b.id}
                  disabled={Boolean(
                    selectedOrder?.preferredBaristaId &&
                      selectedOrder.preferredBaristaId !== b.id,
                  )}
                  onClick={() => setSelectedBayId(b.id)}
                  className={`flex min-h-[72px] touch-manipulation flex-col justify-between rounded-lg border p-2 text-left transition-all ${
                    selectedBayId === b.id
                      ? "border-[#059669] bg-[#ecfdf5] shadow-xs ring-1 ring-[#059669]"
                      : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 disabled:bg-slate-100 disabled:opacity-25"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold font-mono text-slate-900">
                      ドリッパー {laneOrdinal(b.bayNumber)}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    待機 {b.queue.length}件
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-slate-200 border-t bg-[#f8fafc] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] touch-manipulation rounded-lg border border-slate-300 px-4 font-bold text-slate-700 text-xs hover:bg-slate-100"
          >
            キャンセル
          </button>
          <button
            type="button"
            disabled={!canAssign}
            onClick={() => {
              if (canAssign) {
                onAssign(selectedOrderUid, selectedBayId);
                onClose();
              }
            }}
            className="flex min-h-[44px] cursor-pointer touch-manipulation items-center gap-1.5 rounded-lg bg-[#006c4a] px-4 font-bold text-white text-xs shadow-xs transition-colors hover:bg-[#005137] disabled:opacity-50"
          >
            <span>割当を確定</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
