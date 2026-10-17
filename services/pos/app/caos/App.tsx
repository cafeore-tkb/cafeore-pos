import { useState } from "react";
import { CornerToasts, TestBoardBanner } from "./components/BoardParts";
import {
  CONTROL_VIEWS,
  type ControlViewMode,
  ControlWorkspace,
} from "./components/ControlWorkspace";
import {
  CommentDock,
  OpenCommentsContext,
  StampReplyContext,
} from "./components/OrderComments";
import { OrderSearchPanel } from "./components/OrderSearchPanel";
import {
  AssignPanel,
  AuxiliaryContent,
  AuxiliarySheet,
  LanePanel,
  RebrewPanel,
  TicketDetailPanel,
} from "./components/SidePanels";
import { TestPlaySetup } from "./components/TestPlaySetup";
import { type NavTab, TopHeader } from "./components/TopHeader";
import { useBoardSelection } from "./hooks/useBoardSelection";
import { useCaosSession } from "./hooks/useCaosSession";
import { useCaosStateLog } from "./hooks/useCaosStateLog";
import { useCardMenu } from "./hooks/useCardMenu";
import { useCommentNotices } from "./hooks/useCommentNotices";
import { useForgottenBrewAlert } from "./hooks/useForgottenBrewAlert";
import { useItemTypeNames } from "./hooks/useItemTypeNames";
import { useOrderSearch } from "./hooks/useOrderSearch";
import { useSeniorRefresh } from "./hooks/useSeniorRefresh";
import { useStampReply } from "./hooks/useStampReply";
import type { TimelineCommand } from "./hooks/useTimelineScroll";
import { useUnfinishedTab } from "./hooks/useUnfinishedTab";
import { useViewedComments } from "./hooks/useViewedComments";

// CaOS（ドリップ管制）の画面。盤面（cafeore-pos の注文のカップ・実データテストの練習の盤面）・時刻・操作の書き込みは useCaosSession、選んでいるものは useBoardSelection、
// 見せ方は components の部品。ここはどの管制盤を出すかだけを持ち、フックの値と操作を部品に渡す（右のパネルは selection.panel の 1 つだけ出す）。
export default function App() {
  const session = useCaosSession();
  const selection = useBoardSelection(session.cards, session);
  const typeNames = useItemTypeNames();
  useSeniorRefresh(session.simulating);
  const { lanes, looks, testPlay } = session;
  const { panel } = selection;

  const [controlViewMode, setControlViewMode] = useState<ControlViewMode>("a");
  const [timelineCommand, setTimelineCommand] =
    useState<TimelineCommand | null>(null);
  // 管制盤 A のタイムラインが NOW を追っているか（ヘッダーの「現在」の見た目）
  const [followingNow, setFollowingNow] = useState(true);
  const [testSetupOpen, setTestSetupOpen] = useState(false);
  const view = CONTROL_VIEWS[controlViewMode];
  // 注文番号の検索。見つかった注文を選び、そのカードを見せる（A はタイムラインのカードをタイムラインの命令で、ほかは並べた枠の中で）
  const search = useOrderSearch({
    digits: selection.searchDigits,
    open: selection.openSearch,
    setDigits: selection.setSearchDigits,
    close: selection.closeSearch,
    selectOrder: selection.selectOrder,
    showOnTimeline: view.timelineControls
      ? (cardKey) =>
          setTimelineCommand({ direction: "card", cardKey, id: Date.now() })
      : undefined,
    view: controlViewMode,
    // 番号から入れ直すのと同じ注文（本番は POS の注文、実データテスト中は届いた練習の注文）
    orders: session.emergency.orders,
    cards: session.cards,
    lanes,
    comments: session.comments,
    nowMs: session.nowMs,
  });
  // 予定を大きく過ぎた抽出（入れ忘れ・「次へ」の押し忘れかもしれない）を音で知らせる
  useForgottenBrewAlert(lanes, session.nowMs);
  // 右下のコメント：見ている注文（選んだ注文・印を押した注文）のコメントと、新しいコメントの知らせ（押すとその注文を探す）。
  // 開いたカードのパネル・番号の検索がコメントを出しているあいだは、見ている注文のコメントは右下に出さない
  const viewed = useViewedComments({
    selectedOrderId: selection.selectedOrderId,
    selectOrder: selection.selectOrder,
    cards: session.cards,
    looks,
    hidden:
      selection.searchDigits !== null ||
      Boolean(selection.rebrew?.card) ||
      Boolean(selection.scheduled),
  });
  const commentNotices = useCommentNotices(session.comments, viewed.label);
  // 未割当の欄の「未完了」のタブ（まだ提供していない注文。15 分超・新しいコメントはタブに件数の印）と、コメントにスタンプで返す
  const unfinished = useUnfinishedTab({
    orders: session.emergency.orders,
    cards: session.cards,
    lanes,
    comments: session.comments,
    nowMs: session.nowMs,
    practice: session.simulating,
    viewedLabel: viewed.label,
  });
  useCaosStateLog("ui.workspace.changed", {
    controlViewMode,
    followingNow,
    testSetupOpen,
    timelineCommand,
    unfinishedTab: unfinished.tab,
    viewedOrder: viewed.label,
  });
  // 返した注文の新しいコメントの知らせは閉じる
  const stampReply = useStampReply((orderId) =>
    commentNotices.dismiss(
      commentNotices.notices.filter((comment) => comment.orderId === orderId),
    ),
  );
  // ドリッパーのカードの上に出す操作（押すと開き、アイコンを押して決める）
  const cardMenu = useCardMenu({
    onRun: session.runCardAction,
    onEmergency: selection.openCard,
    onComments: viewed.open,
  });
  // 本番（cafeore-pos の注文）の盤面に戻る（テストの盤面を捨て、開いているものを閉じる）
  const backToLive = () => {
    session.reset();
    selection.clear();
  };
  // 補助のパネルを閉じる。テストを終えたあとなら本番の盤面に戻す（テストの盤面のまま戻し忘れないように）
  const closeAuxiliary = () => {
    if (testPlay.finished) backToLive();
    else selection.closeAuxiliary();
  };

  const page = (
    <div className="flex h-dvh w-screen select-none overflow-hidden bg-[#f0f4fa] font-sans text-[#0f172a]">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopHeader
          activeTab={panel?.kind === "auxiliary" ? panel.tab : "control"}
          controlViewMode={controlViewMode}
          onSelectTab={(tab: NavTab) =>
            tab === "control" ? closeAuxiliary() : selection.openAuxiliary(tab)
          }
          onSelectControlViewMode={setControlViewMode}
          timeStr={session.timeLabel}
          counts={session.counts}
          backlog={session.backlog}
          onFindOrder={(orderNo) => selection.openSearch(String(orderNo))}
          soundEnabled={session.soundEnabled}
          onToggleSound={session.toggleSound}
          simulating={session.simulating}
          showTimelineNow={view.timelineControls}
          onTimelineNow={() =>
            setTimelineCommand({ direction: "now", id: Date.now() })
          }
          followingNow={followingNow}
          testPlaying={testPlay.isActive}
          testProgressLabel={testPlay.remainingLabel}
          onOpenTestPlay={() => setTestSetupOpen(true)}
          onEndTestPlay={() => {
            testPlay.finish();
            selection.openAuxiliary("analytics");
          }}
          posStatus={session.posStatus}
          labelPrinter={session.labelPrinter}
          unsent={session.unsent}
          onOpenSearch={() => selection.openSearch("")}
          searchOpen={selection.searchDigits !== null}
          onOpenEmergency={selection.openRebrew}
          lastAction={session.lastAction}
        />

        <main className="flex flex-1 flex-col gap-2 overflow-hidden p-2">
          {session.simulating && (
            <TestBoardBanner
              onBackToLive={backToLive}
              isRunning={session.isRunning}
              onTogglePlay={session.toggleRunning}
              simSpeed={session.simSpeed}
              onCycleSpeed={session.cycleSpeed}
            />
          )}
          {/* 盤面のカードのコメントの印を押すと、その注文のコメントを右下に出す */}
          <OpenCommentsContext.Provider value={viewed.open}>
            <ControlWorkspace
              mode={controlViewMode}
              lanes={lanes}
              unassignedOrders={session.unassigned}
              looks={looks}
              nextAvailable={session.nextAvailable}
              selectedOrderId={selection.selectedOrderId}
              nowMs={session.nowMs}
              timelineCommand={timelineCommand}
              onSelectOrder={selection.selectOrder}
              cardMenu={cardMenu}
              onHoldCard={selection.openCard}
              onCancelEmergency={selection.cancelEmergency}
              onMoveTicket={selection.move}
              onReturnToUnassigned={selection.returnToUnassigned}
              onOpenEmptySlot={selection.openAssignSlot}
              onOpenLane={selection.openLane}
              onAssignToBay={selection.assign}
              onMergeOrders={selection.merge}
              onSplitCup={selection.split}
              onFollowNowChange={setFollowingNow}
              unfinished={{
                ...unfinished,
                selectedOrderId: selection.selectedOrderId,
                onSelectOrder: search.select,
              }}
            />
          </OpenCommentsContext.Provider>
        </main>

        {panel?.kind === "auxiliary" && (
          <AuxiliarySheet tab={panel.tab} onClose={closeAuxiliary}>
            <AuxiliaryContent
              tab={panel.tab}
              beans={session.beans}
              lanes={lanes}
              looks={looks}
              typeNames={typeNames}
              {...testPlay.analytics}
            />
          </AuxiliarySheet>
        )}
      </div>

      {selection.scheduled && (
        <TicketDetailPanel
          ticket={selection.scheduled.card}
          look={looks.get(selection.scheduled.card.key)}
          lane={lanes[selection.scheduled.bayId - 1]}
          onClose={selection.closeTicket}
          onMoveTicket={selection.move}
          onReturnToUnassigned={selection.returnToUnassigned}
          onSplitCup={selection.split}
          onCancelEmergency={selection.cancelEmergency}
        />
      )}

      {selection.rebrew && (
        <RebrewPanel
          key={selection.rebrew.card?.key ?? "byNumber"}
          card={selection.rebrew.card}
          look={selection.rebrew.card && looks.get(selection.rebrew.card.key)}
          lane={
            selection.rebrew.card?.dripper
              ? lanes[selection.rebrew.card.dripper - 1]
              : undefined
          }
          orders={session.emergency.orders}
          practice={session.simulating}
          onClose={selection.closeRebrew}
          onAdd={session.emergency.add}
          move={{
            onMoveTicket: selection.move,
            onReturnToUnassigned: selection.returnToUnassigned,
          }}
        />
      )}

      <CornerToasts
        toasts={session.cornerToasts}
        onDismiss={session.dismissToast}
        onConfirm={session.confirm}
      />

      <CommentDock
        viewing={viewed.viewing}
        onCloseViewing={viewed.close}
        notices={commentNotices.notices}
        onOpen={(comment) => {
          commentNotices.dismiss([comment]);
          search.show(comment.orderNo);
        }}
        onDismiss={commentNotices.dismiss}
      />

      {selection.searchDigits !== null && (
        <OrderSearchPanel
          digits={selection.searchDigits}
          found={search.found}
          pending={search.pending}
          looks={looks}
          onKey={search.press}
          onClose={search.finish}
        />
      )}

      {panel?.kind === "lane" && (
        <LanePanel
          lane={lanes[panel.bayId - 1]}
          onClose={selection.closeLane}
          onMoveQueue={session.moveQueue}
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
  // コメントの中身（右下・未完了の行・パネル）の下に、スタンプで返すボタンを出す
  return (
    <StampReplyContext.Provider value={stampReply}>
      {page}
    </StampReplyContext.Provider>
  );
}
