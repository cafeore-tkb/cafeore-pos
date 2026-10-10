import { useState } from "react";
import {
  CONTROL_VIEWS,
  type ControlViewMode,
  ControlWorkspace,
} from "./components/ControlWorkspace";
import {
  AssignPanel,
  AuxiliaryContent,
  AuxiliarySheet,
  TicketDetailPanel,
} from "./components/SidePanels";
import { TestPlaySetup } from "./components/TestPlaySetup";
import { type NavTab, TopHeader } from "./components/TopHeader";
import { useBoardSelection } from "./hooks/useBoardSelection";
import { useCaosSession } from "./hooks/useCaosSession";
import { useItemTypeNames } from "./hooks/useItemTypeNames";
import type { TimelineCommand } from "./hooks/useTimelineScroll";

// CaOS（ドリップ管制）の画面。盤面（cafeore-pos の注文のカップ・実データテストの練習の盤面）・時刻・操作の書き込みは useCaosSession、選んでいるものは useBoardSelection、
// 見せ方は components の部品。ここはどの管制盤を出すかだけを持ち、フックの値と操作を部品に渡す（右のパネルは selection.panel の 1 つだけ出す）。
export default function App() {
  const session = useCaosSession();
  const selection = useBoardSelection(session.cards, session);
  const typeNames = useItemTypeNames();
  const { lanes, looks, testPlay } = session;
  const { panel } = selection;

  const [controlViewMode, setControlViewMode] = useState<ControlViewMode>("a");
  const [timelineCommand, setTimelineCommand] =
    useState<TimelineCommand | null>(null);
  const [testSetupOpen, setTestSetupOpen] = useState(false);
  const view = CONTROL_VIEWS[controlViewMode];

  return (
    <div className="flex h-screen w-screen select-none overflow-hidden bg-[#f0f4fa] font-sans text-[#0f172a]">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopHeader
          activeTab={panel?.kind === "auxiliary" ? panel.tab : "control"}
          controlViewMode={controlViewMode}
          onSelectTab={(tab: NavTab) =>
            tab === "control"
              ? selection.closeAuxiliary()
              : selection.openAuxiliary(tab)
          }
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
          testPlaying={testPlay.isActive}
          testProgressLabel={testPlay.remainingLabel}
          onOpenTestPlay={() => setTestSetupOpen(true)}
          onEndTestPlay={() => {
            testPlay.finish();
            selection.openAuxiliary("analytics");
          }}
          posStatus={session.posStatus}
        />

        <main className="flex flex-1 flex-col gap-2 overflow-hidden p-2">
          <ControlWorkspace
            mode={controlViewMode}
            lanes={lanes}
            unassignedOrders={session.unassigned}
            looks={looks}
            nextAvailable={session.nextAvailable}
            selectedOrderId={selection.selectedOrderId}
            actionTicketKey={selection.scheduled?.card.key ?? null}
            nowMs={session.nowMs}
            timelineCommand={timelineCommand}
            onSelectOrder={selection.selectOrder}
            onAdvanceBay={session.advance}
            onOpenTicketPad={selection.openTicket}
            onOpenTicketDetail={selection.openDetail}
            onMoveTicket={selection.move}
            onReturnToUnassigned={selection.returnToUnassigned}
            onCloseTicketAction={selection.closeTicket}
            onOpenEmptySlot={selection.openAssignSlot}
            onAssignToBay={selection.assign}
            onMergeOrders={selection.merge}
          />
        </main>

        {panel?.kind === "auxiliary" && (
          <AuxiliarySheet tab={panel.tab} onClose={selection.closeAuxiliary}>
            <AuxiliaryContent
              tab={panel.tab}
              lanes={lanes}
              looks={looks}
              typeNames={typeNames}
              {...testPlay.analytics}
            />
          </AuxiliarySheet>
        )}
      </div>

      {selection.scheduled && view.detailPanel && (
        <TicketDetailPanel
          ticket={selection.scheduled.card}
          look={looks.get(selection.scheduled.card.key)}
          currentBayId={selection.scheduled.bayId}
          onClose={selection.closeDetail}
          onMoveTicket={selection.move}
          onReturnToUnassigned={selection.returnToUnassigned}
        />
      )}

      {panel?.kind === "assign" && (
        <AssignPanel
          bayId={panel.bayId}
          lanes={lanes}
          unassignedOrders={session.unassigned}
          looks={looks}
          onClose={selection.closeAssignSlot}
          onAssign={selection.assign}
        />
      )}

      {testSetupOpen && (
        <TestPlaySetup
          dataset={testPlay.practiceData.dataset}
          loading={testPlay.practiceData.loading}
          problems={testPlay.practiceData.problems}
          onSelectFiles={(files) => void testPlay.practiceData.readFiles(files)}
          onClearData={testPlay.practiceData.clear}
          onClose={() => setTestSetupOpen(false)}
          onStart={(startMs, durationMinutes) => {
            testPlay.start(startMs, durationMinutes);
            selection.clear();
            setTestSetupOpen(false);
          }}
        />
      )}
    </div>
  );
}
