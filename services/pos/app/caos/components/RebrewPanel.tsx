import { AlertTriangle, Clock3 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { Barista } from "../logic/board";
import { MAX_CUPS, type OrderTicket, orderLabel } from "../logic/cards";
import { clockLabel } from "../logic/format";
import { laneOrdinal } from "../logic/lanes";
import {
  type RebrewDecision,
  canConfirmRebrew,
  rebrewCandidates,
  rebrewSlots,
} from "../logic/rebrew";
import { PanelFooter, SidePanel } from "./SidePanels";

// 緊急の入れ直し（抽出中・終わったカードから）。中断／継続、杯数、置くドリッパー、差し込む位置を選ぶ
export const RebrewPanel: React.FC<{
  ticket: OrderTicket;
  sourceBayId: number;
  baristas: Barista[];
  onClose: () => void;
  onConfirm: (decision: RebrewDecision) => void;
}> = ({ ticket, sourceBayId, baristas, onClose, onConfirm }) => {
  const isBrewing = ticket.status === "brewing";
  const [cupCount, setCupCount] = useState(1);
  const [interruptCurrent, setInterruptCurrent] = useState(isBrewing);
  const [targetBayId, setTargetBayId] = useState<number | null>(null);
  const [insertIndex, setInsertIndex] = useState<number | null>(null);

  const { candidates, fastestId } = rebrewCandidates(baristas, ticket);
  const source = { ticket, sourceBayId, interruptCurrent };
  const selectedBay = baristas.find((barista) => barista.id === targetBayId);
  const slots = selectedBay ? rebrewSlots(selectedBay, source).slots : [];
  const choice = (selected: boolean) =>
    `touch-manipulation rounded-xl border-2 ${selected ? "border-red-600 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-700"}`;

  return (
    <SidePanel
      tone="alert"
      title={
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-white">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="font-black text-[12px] text-red-700">
              緊急の入れ直し
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-black font-mono text-[23px] text-red-700">
                {orderLabel(ticket)}
              </span>
              <span className="truncate font-black text-[15px]">
                {ticket.beanName}
              </span>
            </div>
          </div>
        </div>
      }
      onClose={onClose}
      footer={
        <PanelFooter onCancel={onClose}>
          <button
            type="button"
            disabled={!canConfirmRebrew(targetBayId, insertIndex, slots)}
            onClick={() =>
              onConfirm({
                cupCount,
                interruptCurrent: interruptCurrent && isBrewing,
                targetBayId,
                insertIndex,
              })
            }
            className="min-h-[50px] flex-1 touch-manipulation rounded-xl bg-red-600 font-black text-[15px] text-white disabled:bg-slate-300"
          >
            この内容で入れ直す
          </button>
        </PanelFooter>
      }
    >
      <div className="space-y-4">
        {isBrewing && (
          <section>
            <h3 className="mb-2 font-black text-[13px] text-slate-600">
              現在の抽出
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setInterruptCurrent(true)}
                className={`min-h-[52px] font-black text-[14px] ${choice(interruptCurrent)}`}
              >
                今すぐ中断
              </button>
              <button
                type="button"
                onClick={() => setInterruptCurrent(false)}
                className={`min-h-[52px] font-black text-[14px] ${choice(!interruptCurrent)}`}
              >
                抽出は続ける
              </button>
            </div>
          </section>
        )}

        {ticket.cupCount > 1 && (
          <section>
            <h3 className="mb-2 font-black text-[13px] text-slate-600">
              入れ直す杯数
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: MAX_CUPS }, (_, index) => index + 1).map(
                (cups) => (
                  <button
                    key={cups}
                    type="button"
                    onClick={() => setCupCount(cups)}
                    className={`min-h-[50px] font-black font-mono text-[18px] ${choice(cupCount === cups)}`}
                  >
                    {cups}杯
                  </button>
                ),
              )}
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-2 font-black text-[13px] text-slate-600">
            担当ドリッパーを選択
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {candidates.map(({ barista, wait, eligible }) => (
              <button
                key={barista.id}
                type="button"
                disabled={!eligible}
                onClick={() => {
                  setTargetBayId(barista.id);
                  setInsertIndex(rebrewSlots(barista, source).defaultIndex);
                }}
                className={`min-h-[66px] p-2 text-left disabled:opacity-45 ${choice(targetBayId === barista.id)}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black text-[16px]">
                    {laneOrdinal(barista.id)}
                  </span>
                  {fastestId === barista.id && (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-black text-[10px] text-emerald-800">
                      最速
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1 font-bold text-[12px] text-slate-500">
                  <Clock3 className="h-3.5 w-3.5" />
                  {barista.queue.length === 0
                    ? "今すぐ"
                    : `全件後 ${clockLabel(wait)}`}
                  {!eligible && (
                    <span className="ml-auto text-red-700">指名外</span>
                  )}
                </div>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setTargetBayId(null);
              setInsertIndex(null);
            }}
            className={`mt-2 min-h-[48px] w-full font-black text-[14px] ${choice(targetBayId === null)}`}
          >
            未割当に置く
          </button>
        </section>

        {selectedBay && (
          <section>
            <h3 className="mb-2 font-black text-[13px] text-slate-600">
              差し込み位置
            </h3>
            <div className="space-y-1.5">
              {slots.map((slot) => (
                <button
                  key={slot.index}
                  type="button"
                  onClick={() => setInsertIndex(slot.index)}
                  className={`min-h-[46px] w-full px-3 text-left font-black text-[13px] ${choice(insertIndex === slot.index)}`}
                >
                  {slot.label}
                  {slot.isLast && (
                    <span className="ml-2 text-[11px] text-slate-500">
                      最後
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </SidePanel>
  );
};
