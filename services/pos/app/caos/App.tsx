import { useState } from "react";
import {
  CONTROL_VIEWS,
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
import { useBoardSelection } from "./hooks/useBoardSelection";
import { useCaosSession } from "./hooks/useCaosSession";
import { useItemTypeNames } from "./hooks/useItemTypeNames";
import type { TimelineCommand } from "./hooks/useTimelineScroll";

// CaOS（ドリップ管制）の画面。盤面・時刻・注文の取り込みは useCaosSession、選んでいるものは useBoardSelection、
// 見せ方は components の部品。ここはどの管制盤・どのパネルを出すかだけを持ち、フックの値と操作を部品に渡す。
export default function App() {
  const auxWindow = useAuxiliaryWindow();
  const session = useCaosSession(auxWindow.snapshot);
  const selection = useBoardSelection(session.board, session);
  const typeNames = useItemTypeNames();
  const { board, testPlay } = session;

  const [activeTab, setActiveTab] = useState<NavTab>(
    auxWindow.standaloneTab ?? "control",
  );
  const [controlViewMode, setControlViewMode] = useState<ControlViewMode>("a");
  const [timelineCommand, setTimelineCommand] =
    useState<TimelineCommand | null>(null);
  const [testSetupOpen, setTestSetupOpen] = useState(false);
  const view = CONTROL_VIEWS[controlViewMode];

  const auxiliaryView = (tab: AuxiliaryTab) => (
    <AuxiliaryContent
      tab={tab}
      baristas={board.baristas}
      typeNames={typeNames}
      {...testPlay.analytics}
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
          unassignedCups={session.cups.unassigned}
          totalWaitingCups={session.cups.waiting}
          soundEnabled={session.soundEnabled}
          onToggleSound={session.toggleSound}
          isRunning={session.isRunning}
          onTogglePlay={session.toggleRunning}
          simSpeed={session.simSpeed}
          onCycleSpeed={session.cycleSpeed}
          onResetData={() => {
            session.reset();
            selection.clear();
          }}
          showTimelineControls={view.timelineControls}
          onTimelineNavigate={(direction) =>
            setTimelineCommand({ direction, id: Date.now() })
          }
          undoLabel={session.undoLabel}
          onUndo={() => {
            if (session.undo()) selection.clear();
          }}
          testPlaying={testPlay.isActive}
          testProgressLabel={testPlay.remainingLabel}
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
            unassignedOrders={session.unassigned}
            nextAvailable={session.nextAvailable}
            selectedOrderId={selection.selectedOrderId}
            actionTicketKey={selection.scheduled?.ticket.ticketUid ?? null}
            currentTimeSec={session.nowSec}
            timelineCommand={timelineCommand}
            onSelectOrder={selection.selectOrder}
            onAdvanceBay={session.advance}
            onOpenTicketPad={selection.openTicket}
            onOpenTicketDetail={selection.openDetail}
            onMoveTicket={selection.move}
            onReturnToUnassigned={selection.returnToUnassigned}
            onCloseTicketAction={selection.closeTicket}
            onRequestRebrew={selection.openRebrew}
            onOpenEmptySlot={selection.openAssignSlot}
            onAssignToBay={selection.assign}
            onMergeOrders={selection.merge}
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

      {selection.scheduled && view.detailPanel && (
        <TicketDetailPanel
          ticket={selection.scheduled.ticket}
          currentBayId={selection.scheduled.bayId}
          onClose={selection.closeDetail}
          onMoveTicket={selection.move}
          onReturnToUnassigned={selection.returnToUnassigned}
        />
      )}

      {selection.assignSlotBayId !== null && (
        <AssignPanel
          bayId={selection.assignSlotBayId}
          baristas={board.baristas}
          unassignedOrders={session.unassigned}
          onClose={selection.closeAssignSlot}
          onAssign={session.assign}
        />
      )}

      {selection.rebrewSource && (
        <RebrewPanel
          ticket={selection.rebrewSource.ticket}
          sourceBayId={selection.rebrewSource.bayId}
          baristas={board.baristas}
          onClose={selection.closeRebrew}
          onConfirm={selection.rebrew}
        />
      )}

      {testSetupOpen && (
        <TestPlaySetup
          orders={testPlay.historicalOrders}
          onClose={() => setTestSetupOpen(false)}
          onStart={(startMs, durationMinutes) => {
            testPlay.start(startMs, durationMinutes);
            selection.clear();
            setActiveTab("control");
            setTestSetupOpen(false);
          }}
        />
      )}
    </div>
  );
}
