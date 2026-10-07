import { formatMinSec } from "@cafeore/common";
import { ArrowRightCircle, CircleDot, RotateCcw } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import { activeRemainingSec, queueWaitSeconds } from "../utils/orderQueue";
import type { ControlViewBProps } from "./ControlViewB";
import { DripperOrderCard } from "./DripperOrderCard";
import { UnassignedOrdersPanel } from "./UnassignedOrdersPanel";

export type ControlViewCProps = ControlViewBProps;

const dripperLabelGroups = [
  {
    group: "H",
    labels: ["H2", "H1"],
    className: "border-orange-300 bg-orange-50 text-orange-800",
  },
  {
    group: "I",
    labels: ["I2", "I1"],
    className: "border-sky-300 bg-sky-50 text-sky-800",
  },
] as const;

export const ControlViewC: React.FC<ControlViewCProps> = ({
  baristas,
  unassignedOrders,
  simTimeSec,
  selectedOrderId,
  onSelectOrder,
  onSelectQueueOrder,
  onAdvanceBay,
  onOpenTicketDetail,
  onOpenEmptySlot,
  onAssignToBay,
  onRequestRebrew,
}) => {
  const sortedBaristas = useMemo(
    () => [...baristas].sort((left, right) => left.bayNumber - right.bayNumber),
    [baristas],
  );
  const nextAvailable = useMemo(
    () =>
      sortedBaristas
        .map((barista) => ({
          bayNumber: barista.bayNumber,
          seconds: queueWaitSeconds(barista.queue),
          isStandby: barista.queue.length === 0,
        }))
        .sort(
          (left, right) =>
            left.seconds - right.seconds || left.bayNumber - right.bayNumber,
        )
        .slice(0, 3),
    [sortedBaristas],
  );

  return (
    <section
      className="grid h-full min-h-0 grid-cols-2 gap-2"
      aria-label="Cコントロール画面"
    >
      <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xs">
        <header className="flex h-11 shrink-0 items-center gap-2 border-slate-200 border-b bg-slate-50 px-3">
          <CircleDot className="h-4 w-4 text-emerald-600" />
          <h2 className="shrink-0 font-black text-[15px] text-slate-950">
            ドリッパー
          </h2>
          <div className="ml-1 flex min-w-0 items-center gap-1 font-bold text-[10px] text-slate-500">
            <span className="shrink-0">次に空く:</span>
            {nextAvailable.map((item, index) => (
              <span
                key={item.bayNumber}
                className={`shrink-0 whitespace-nowrap rounded border px-1.5 py-0.5 font-mono ${index === 0 ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700"}`}
              >
                #{item.bayNumber}{" "}
                {item.isStandby ? "待機" : formatMinSec(item.seconds)}
              </span>
            ))}
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-6 divide-y divide-slate-200">
          {sortedBaristas.map((barista) => {
            const current = barista.queue[0];
            const waitingQueue = barista.queue.slice(1);
            const seconds = activeRemainingSec(barista, simTimeSec);
            const isImminent = Boolean(current && seconds <= 30);
            const isLinked = Boolean(
              selectedOrderId &&
                barista.queue.some((ticket) => ticket.id === selectedOrderId),
            );

            return (
              <article
                key={barista.id}
                data-bay-target={barista.id}
                className={`relative isolate flex min-h-0 flex-col gap-1 overflow-hidden p-1.5 transition-colors ${isLinked ? "bg-amber-50 ring-2 ring-amber-400 ring-inset" : "bg-white"}`}
              >
                <div className="flex h-8 shrink-0 items-center justify-between gap-2 overflow-hidden px-0.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-950 font-black font-mono text-[16px] text-white">
                      {barista.bayNumber}
                    </div>
                    <div className="min-w-0 truncate font-black text-[15px] text-slate-950">
                      {barista.name}
                    </div>
                  </div>
                  <div
                    className="flex shrink-0 items-center gap-1.5"
                    aria-label="ドリッパーラベル"
                  >
                    {dripperLabelGroups.map((group) => (
                      <div
                        key={group.group}
                        className="flex items-center gap-1"
                      >
                        {group.labels.map((label) => (
                          <span
                            key={label}
                            className={`rounded-md border px-1.5 py-0.5 font-black font-mono text-[11px] leading-none ${group.className}`}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    ))}
                    {(barista.bayNumber === 1 || barista.bayNumber === 6) && (
                      <span className="rounded-md border border-fuchsia-300 bg-fuchsia-50 px-1.5 py-0.5 font-black text-[11px] text-fuchsia-800 leading-none">
                        限定
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)_52px] items-stretch gap-1.5">
                  <DripperOrderCard
                    kind="current"
                    ticket={current}
                    remainingLabel={
                      current
                        ? seconds === 0
                          ? "継続"
                          : formatMinSec(seconds)
                        : undefined
                    }
                    isImminent={isImminent}
                    emptyLabel="待機中"
                    onClick={
                      current
                        ? () => onRequestRebrew(current, barista.id)
                        : undefined
                    }
                  />

                  <div className="flex min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {waitingQueue.length > 0 ? (
                      waitingQueue.map((ticket, index) => (
                        <DripperOrderCard
                          key={ticket.ticketUid || `${ticket.id}-${index}`}
                          kind="waiting"
                          ticket={ticket}
                          queueCount={waitingQueue.length}
                          queuePosition={index + 1}
                          emptyLabel="待ちへ割当"
                          onClick={() => {
                            if (selectedOrderId !== ticket.id)
                              onSelectOrder(ticket.id);
                            onOpenTicketDetail(ticket);
                          }}
                        />
                      ))
                    ) : (
                      <DripperOrderCard
                        kind="waiting"
                        queueCount={0}
                        emptyLabel="待ちへ割当"
                        onClick={() => onOpenEmptySlot(barista.id)}
                      />
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={!current}
                    onClick={() => onAdvanceBay(barista.id)}
                    className={`flex min-w-0 items-center justify-center gap-0.5 overflow-hidden rounded-lg font-black text-[12px] ${current ? "bg-emerald-700 text-white" : "bg-slate-200 text-slate-500"}`}
                  >
                    {current ? (
                      <>
                        <span>次へ</span>
                        <ArrowRightCircle className="h-4 w-4" />
                      </>
                    ) : (
                      <>
                        <span>待機</span>
                        <RotateCcw className="h-3.5 w-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <aside className="min-h-0 min-w-0">
        <UnassignedOrdersPanel
          layout="sidebar"
          orders={unassignedOrders}
          nextAvailable={nextAvailable}
          selectedOrderId={selectedOrderId}
          onSelectOrder={onSelectOrder}
          onSelectQueueOrder={onSelectQueueOrder}
          onClearSelection={() => onSelectOrder("")}
          onAssignToBay={onAssignToBay}
        />
      </aside>
    </section>
  );
};
