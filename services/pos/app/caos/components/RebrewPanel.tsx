import { formatMinSec } from "@cafeore/common";
import { AlertTriangle, Clock3, X } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import type { Barista, OrderTicket } from "../types";
import { laneOrdinal } from "../utils/lanes";
import { queueWaitSeconds } from "../utils/orderQueue";

export interface RebrewDecision {
  cupCount: number;
  interruptCurrent: boolean;
  targetBayId: number | null;
  insertIndex: number | null;
}

interface RebrewPanelProps {
  ticket: OrderTicket;
  sourceBayId: number;
  baristas: Barista[];
  onClose: () => void;
  onConfirm: (decision: RebrewDecision) => void;
}

export const RebrewPanel: React.FC<RebrewPanelProps> = ({
  ticket,
  sourceBayId,
  baristas,
  onClose,
  onConfirm,
}) => {
  const isBrewing = ticket.status === "brewing";
  const [cupCount, setCupCount] = useState(ticket.cupCount === 1 ? 1 : 1);
  const [interruptCurrent, setInterruptCurrent] = useState(isBrewing);
  const [targetBayId, setTargetBayId] = useState<number | null>(null);
  const [insertIndex, setInsertIndex] = useState<number | null>(null);

  const candidates = useMemo(
    () =>
      [...baristas]
        .map((barista) => ({
          barista,
          wait: queueWaitSeconds(barista.queue),
          // 指名があればその列だけ。限定（SP）もいまはどの列でも可（上級生の判定はあとで足す）
          eligible:
            !ticket.preferredBaristaId ||
            ticket.preferredBaristaId === barista.id,
        }))
        .sort(
          (a, b) =>
            a.wait - b.wait || a.barista.bayNumber - b.barista.bayNumber,
        ),
    [baristas, ticket.preferredBaristaId],
  );
  const fastestId = candidates.find((candidate) => candidate.eligible)?.barista
    .id;
  const selectedBay =
    baristas.find((barista) => barista.id === targetBayId) || null;
  const selectedQueue = selectedBay
    ? interruptCurrent && isBrewing && selectedBay.id === sourceBayId
      ? selectedBay.queue.slice(1)
      : selectedBay.queue
    : [];
  // Position 0 is offered only for an empty queue or when replacing the drip being
  // interrupted; a stale 0 (e.g. the drip finished while this panel was open) must be re-picked.
  const canInsertAtFront =
    selectedQueue.length === 0 ||
    (interruptCurrent && isBrewing && selectedBay?.id === sourceBayId);
  const canConfirm =
    targetBayId === null ||
    (insertIndex !== null && (insertIndex > 0 || canInsertAtFront));

  return (
    <aside
      className="context-sheet absolute top-[56px] right-0 bottom-0 z-[150] flex w-[min(460px,46vw)] min-w-[390px] flex-col border-red-200 border-l bg-white shadow-2xl"
      aria-label="緊急入れ直し設定"
    >
      <div className="flex h-[60px] shrink-0 items-center gap-3 border-red-200 border-b bg-red-50 px-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600 text-white">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-black text-[12px] text-red-700">
            緊急の入れ直し
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-black font-mono text-[23px] text-red-700">
              {ticket.id}
            </span>
            <span className="truncate font-black text-[15px]">
              {ticket.beanName}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full hover:bg-red-100"
          aria-label="閉じる"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {isBrewing && (
          <section>
            <h3 className="mb-2 font-black text-[13px] text-slate-600">
              現在の抽出
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setInterruptCurrent(true)}
                className={`min-h-[52px] touch-manipulation rounded-xl border-2 font-black text-[14px] ${interruptCurrent ? "border-red-600 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-700"}`}
              >
                今すぐ中断
              </button>
              <button
                type="button"
                onClick={() => setInterruptCurrent(false)}
                className={`min-h-[52px] touch-manipulation rounded-xl border-2 font-black text-[14px] ${!interruptCurrent ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700"}`}
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
              {[1, 2].map((cups) => (
                <button
                  key={cups}
                  type="button"
                  onClick={() => setCupCount(cups)}
                  className={`min-h-[50px] touch-manipulation rounded-xl border-2 font-black font-mono text-[18px] ${cupCount === cups ? "border-red-600 bg-red-50 text-red-700" : "border-slate-200 bg-white"}`}
                >
                  {cups}杯
                </button>
              ))}
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
                  setInsertIndex(
                    interruptCurrent && isBrewing && barista.id === sourceBayId
                      ? 0
                      : barista.queue.length === 0
                        ? 0
                        : 1,
                  );
                }}
                className={`min-h-[66px] touch-manipulation rounded-xl border-2 p-2 text-left disabled:opacity-45 ${targetBayId === barista.id ? "border-red-600 bg-red-50" : "border-slate-200 bg-white hover:border-slate-400"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black text-[16px]">
                    {laneOrdinal(barista.bayNumber)}
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
                    : `全件後 ${formatMinSec(wait)}`}
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
            className={`mt-2 min-h-[48px] w-full touch-manipulation rounded-xl border-2 font-black text-[14px] ${targetBayId === null ? "border-red-600 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-700"}`}
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
              {selectedQueue.length === 0 ? (
                <button
                  type="button"
                  onClick={() => setInsertIndex(0)}
                  className="min-h-[48px] w-full rounded-xl border-2 border-red-600 bg-red-50 font-black text-red-700"
                >
                  今すぐ開始
                </button>
              ) : (
                <>
                  {interruptCurrent &&
                    isBrewing &&
                    selectedBay.id === sourceBayId && (
                      <button
                        type="button"
                        onClick={() => setInsertIndex(0)}
                        className={`min-h-[46px] w-full touch-manipulation rounded-xl border-2 px-3 text-left font-black text-[13px] ${insertIndex === 0 ? "border-red-600 bg-red-50 text-red-700" : "border-slate-200 bg-white"}`}
                      >
                        中断後、今すぐ開始
                      </button>
                    )}
                  {selectedQueue.map((previous, offset) => {
                    const index = offset + 1;
                    const label =
                      index === 1 &&
                      !(
                        interruptCurrent &&
                        isBrewing &&
                        selectedBay.id === sourceBayId
                      )
                        ? "現在の抽出の次"
                        : `${previous.id} ${previous.beanName} の次`;
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setInsertIndex(index)}
                        className={`min-h-[46px] w-full touch-manipulation rounded-xl border-2 px-3 text-left font-black text-[13px] ${insertIndex === index ? "border-red-600 bg-red-50 text-red-700" : "border-slate-200 bg-white"}`}
                      >
                        {label}
                        {index === selectedQueue.length && (
                          <span className="ml-2 text-[11px] text-slate-500">
                            最後
                          </span>
                        )}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </section>
        )}
      </div>

      <div className="flex shrink-0 gap-2 border-slate-200 border-t bg-slate-50 p-3">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[50px] touch-manipulation rounded-xl border border-slate-300 bg-white px-5 font-black"
        >
          キャンセル
        </button>
        <button
          type="button"
          disabled={!canConfirm}
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
      </div>
    </aside>
  );
};
