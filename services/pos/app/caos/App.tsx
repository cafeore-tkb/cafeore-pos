import { useEffect, useState } from "react";
import {
  type ControlViewMode,
  ControlWorkspace,
} from "./components/ControlWorkspace";
import { RebrewPanel } from "./components/RebrewPanel";
import {
  AssignPanel,
  AuxiliaryContent,
  AuxiliarySheet,
  StandaloneAuxiliaryPanel,
  TicketDetailPanel,
} from "./components/SidePanels";
import { TestPlaySetup } from "./components/TestPlaySetup";
import { type NavTab, TopHeader } from "./components/TopHeader";
import {
  type AuxiliaryTab,
  useAuxiliaryWindow,
} from "./hooks/useAuxiliaryWindow";
import { useCaosSession } from "./hooks/useCaosSession";
import { useItemTypeNames } from "./hooks/useItemTypeNames";
import type { TimelineCommand } from "./hooks/useTimelineScroll";
import { findTicket } from "./logic/board";
import { compareUnassigned, orderLabel, totalCups } from "./logic/cards";
import { ordersSoFar } from "./logic/historical";
import { nextAvailableBays } from "./logic/queue";

// CaOS（ドリップ管制）の画面。盤面・時刻・注文の取り込みは useCaosSession、見せ方は components の部品。
// ここは画面の選択（どの管制盤・どのパネル・どのカード）だけを持ち、フックの値と操作を部品に渡す。
export default function App() {
  const auxWindow = useAuxiliaryWindow();
  const session = useCaosSession(auxWindow.snapshot);
  const typeNames = useItemTypeNames();
  const { board, nowSec, testPlay } = session;

  const [activeTab, setActiveTab] = useState<NavTab>(
    auxWindow.standaloneTab ?? "control",
  );
  const [controlViewMode, setControlViewMode] =
    useState<ControlViewMode>("current");
  const [timelineCommand, setTimelineCommand] =
    useState<TimelineCommand | null>(null);
  const [testSetupOpen, setTestSetupOpen] = useState(false);
  // 選んだ注文（orderLabel。同じ注文のカードを全部の列で光らせる）
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  // パネルはカードのキーだけを持ち、カードは毎回いまの盤面から読む（開いているあいだに始まった・終わったカードを古いまま扱わない）
  const [selectedTicketKey, setSelectedTicketKey] = useState<string | null>(
    null,
  );
  const [assignSlotBayId, setAssignSlotBayId] = useState<number | null>(null);
  const [rebrewKey, setRebrewKey] = useState<string | null>(null);

  // 待機のカードだけ動かせるので、始まったら移動のボタン・詳細を閉じる
  const selected = selectedTicketKey
    ? findTicket(board.baristas, selectedTicketKey)
    : null;
  const selectedScheduled =
    selected?.ticket.status === "scheduled" ? selected : null;
  const rebrewSource = rebrewKey ? findTicket(board.baristas, rebrewKey) : null;
  useEffect(() => {
    if (selectedTicketKey && !selectedScheduled) setSelectedTicketKey(null);
  }, [selectedTicketKey, selectedScheduled]);

  const clearSelections = () => {
    setSelectedOrderId(null);
    setSelectedTicketKey(null);
    setAssignSlotBayId(null);
    setRebrewKey(null);
  };

  const unassignedOrders = [...board.unassigned].sort(compareUnassigned);
  const auxiliaryView = (tab: AuxiliaryTab) => (
    <AuxiliaryContent
      tab={tab}
      baristas={board.baristas}
      typeNames={typeNames}
      salesOrders={testPlay.session ? ordersSoFar(testPlay.session) : []}
      periodStartMs={testPlay.session?.startMs}
      periodEndMs={
        testPlay.session
          ? Math.min(testPlay.session.currentMs, testPlay.session.endMs)
          : undefined
      }
    />
  );

  if (auxWindow.standaloneTab) {
    return (
      <StandaloneAuxiliaryPanel tab={auxWindow.standaloneTab}>
        {auxiliaryView(auxWindow.standaloneTab)}
      </StandaloneAuxiliaryPanel>
    );
  }

  return (
    <div className="flex h-screen w-screen select-none overflow-hidden bg-[#f0f4fa] font-sans text-[#0f172a]">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopHeader
          activeTab={activeTab}
          controlViewMode={controlViewMode}
          onSelectTab={setActiveTab}
          onSelectControlViewMode={setControlViewMode}
          timeStr={session.timeLabel}
          unassignedCups={totalCups(board.unassigned)}
          totalWaitingCups={totalCups(
            board.baristas.flatMap((barista) => barista.queue),
          )}
          soundEnabled={session.soundEnabled}
          onToggleSound={session.toggleSound}
          isRunning={session.isRunning}
          onTogglePlay={session.toggleRunning}
          simSpeed={session.simSpeed}
          onChangeSpeed={session.setSimSpeed}
          onResetData={() => {
            session.reset();
            clearSelections();
          }}
          showTimelineControls={controlViewMode === "current"}
          onTimelineNavigate={(direction) =>
            setTimelineCommand({ direction, id: Date.now() })
          }
          canUndo={session.undoLabel !== null}
          undoLabel={session.undoLabel}
          onUndo={() => {
            if (session.undo()) clearSelections();
          }}
          testPlaying={testPlay.session?.status === "active"}
          testProgressLabel={
            testPlay.session
              ? `${Math.max(0, Math.ceil((testPlay.session.endMs - testPlay.session.currentMs) / 60_000))}分`
              : null
          }
          onOpenTestPlay={() => setTestSetupOpen(true)}
          onEndTestPlay={() => {
            testPlay.finish();
            setActiveTab("analytics");
          }}
          posStatus={session.posStatus}
        />

        <main className="flex flex-1 flex-col gap-2 overflow-hidden p-2">
          <ControlWorkspace
            mode={controlViewMode}
            baristas={board.baristas}
            unassignedOrders={unassignedOrders}
            nextAvailable={nextAvailableBays(board.baristas)}
            selectedOrderId={selectedOrderId}
            actionTicketKey={selectedScheduled ? selectedTicketKey : null}
            currentTimeSec={nowSec}
            timelineCommand={timelineCommand}
            onSelectOrder={(orderId) =>
              setSelectedOrderId((current) =>
                !orderId || current === orderId ? null : orderId,
              )
            }
            onAdvanceBay={session.advance}
            onOpenTicketDetail={(ticket) =>
              setSelectedTicketKey(ticket.ticketUid)
            }
            onMoveTicket={(ticket, bayId) => {
              if (session.move(ticket.ticketUid, bayId))
                setSelectedOrderId(null);
            }}
            onReturnToUnassigned={(ticket) => {
              if (session.returnToUnassigned(ticket.ticketUid))
                setSelectedOrderId(null);
            }}
            onCloseTicketAction={() => setSelectedTicketKey(null)}
            onRequestRebrew={(ticket) => {
              setSelectedTicketKey(null);
              setRebrewKey(ticket.ticketUid);
            }}
            onOpenEmptySlot={setAssignSlotBayId}
            onAssignToBay={(order, bayId) =>
              session.assign(order.ticketUid, bayId)
            }
            onMergeOrders={(firstUid, secondUid) => {
              if (session.merge(firstUid, secondUid)) setSelectedOrderId(null);
            }}
          />
        </main>

        {activeTab !== "control" && (
          <AuxiliarySheet
            tab={activeTab}
            onOpenInNewTab={() =>
              auxWindow.openInNewTab(activeTab, {
                board,
                testPlaySession: testPlay.session,
              })
            }
            onClose={() => setActiveTab("control")}
          >
            {auxiliaryView(activeTab)}
          </AuxiliarySheet>
        )}
      </div>

      {/* 待機のカードの詳細（管制盤 C・D。A はカードの上の 1〜6 のボタン） */}
      {selectedScheduled && controlViewMode !== "current" && (
        <TicketDetailPanel
          ticket={selectedScheduled.ticket}
          currentBayId={selectedScheduled.bayId}
          onClose={() => {
            setSelectedTicketKey(null);
            setSelectedOrderId(null);
          }}
          onMoveTicket={(ticket, bayId) => {
            if (session.move(ticket.ticketUid, bayId)) setSelectedOrderId(null);
          }}
          onReturnToUnassigned={(ticket) => {
            if (session.returnToUnassigned(ticket.ticketUid))
              setSelectedOrderId(null);
          }}
        />
      )}

      {/* 空きスロットからの割当 */}
      {assignSlotBayId !== null && (
        <AssignPanel
          bayId={assignSlotBayId}
          baristas={board.baristas}
          unassignedOrders={unassignedOrders}
          onClose={() => setAssignSlotBayId(null)}
          onAssign={session.assign}
        />
      )}

      {rebrewSource && rebrewSource.ticket.status !== "scheduled" && (
        <RebrewPanel
          ticket={rebrewSource.ticket}
          sourceBayId={rebrewSource.bayId}
          baristas={board.baristas}
          onClose={() => setRebrewKey(null)}
          onConfirm={(decision) => {
            if (!session.rebrew(rebrewSource.ticket.ticketUid, decision))
              return;
            setRebrewKey(null);
            setSelectedTicketKey(null);
            setSelectedOrderId(orderLabel(rebrewSource.ticket));
          }}
        />
      )}

      {testSetupOpen && (
        <TestPlaySetup
          orders={testPlay.historicalOrders}
          onClose={() => setTestSetupOpen(false)}
          onStart={(startMs, durationMinutes) => {
            testPlay.start(startMs, durationMinutes);
            clearSelections();
            setActiveTab("control");
            setTestSetupOpen(false);
          }}
        />
      )}
    </div>
  );
}
