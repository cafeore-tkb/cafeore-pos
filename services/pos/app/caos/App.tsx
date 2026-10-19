import { jstDate } from "@cafeore/common";
import { useState } from "react";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";
import { CornerToasts, TestBoardBanner } from "./components/BoardParts";
import {
  CONTROL_VIEWS,
  type ControlViewMode,
  ControlWorkspace,
} from "./components/ControlWorkspace";
import {
  FloatingWindowScope,
  useRestoreFloatingWindow,
} from "./components/FloatingWindows";
import { OperationNotices } from "./components/OperationNotices";
import { OrderChatPanel } from "./components/OrderChatPanel";
import {
  CommentDock,
  FreshCommentsContext,
  OpenCommentsContext,
  StampReplyContext,
} from "./components/OrderComments";
import { OrderSearchPanel } from "./components/OrderSearchPanel";
import { PastOrdersPanel } from "./components/PastOrdersPanel";
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
import { useServedCardAlert } from "./hooks/useServedCardAlert";
import { useStampReply } from "./hooks/useStampReply";
import type { TimelineCommand } from "./hooks/useTimelineScroll";
import { useUnfinishedTab } from "./hooks/useUnfinishedTab";
import { useViewedComments } from "./hooks/useViewedComments";
import { orderNoLabel } from "./logic/cards";

// CaOS（ドリップ管制）の画面。盤面（cafeore-pos の注文のカップ・実データテストの練習の盤面）・時刻・操作の書き込みは useCaosSession、選んでいるものは useBoardSelection、
// 見せ方は components の部品。ここはどの管制盤を出すかだけを持ち、フックの値と操作を部品に渡す（選択中と非表示の未完了パネルを保持する）。
export default function App() {
  const restoreWindow = useRestoreFloatingWindow();
  const session = useCaosSession();
  const { orders, lastDeletedOrder } = useOrdersWSContext();
  const cancelledOrderNo =
    !session.simulating &&
    lastDeletedOrder &&
    jstDate(lastDeletedOrder.receivedAtMs) === jstDate(session.nowMs)
      ? lastDeletedOrder.orderNo
      : null;
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
  useServedCardAlert(
    session.cards,
    session.emergency.orders !== null,
    `${session.simulating ? "practice" : "live"}:${jstDate(session.nowMs)}`,
  );
  // 閲覧中のコメント（Aはポップアップ、C・Dは右側のチャット）：見ている注文（選んだ注文・印を押した注文）のコメントと、新しいコメントの知らせ（押すとその注文を探す）。
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
  // 未割当の欄の「未提供」のタブ（まだ提供していない注文。15 分超・新しいコメントはタブに件数の印）と、コメントにスタンプで返す
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
  const openTestPlay = () => {
    restoreWindow("実績でテストプレイ");
    setTestSetupOpen(true);
  };
  const endTestPlay = () => {
    testPlay.finish();
    selection.openAuxiliary("analytics");
  };

  const page = (
    <div className="flex h-[calc(100dvh-var(--pos-status-height,0px))] w-screen select-none overflow-hidden bg-[#f0f4fa] font-sans text-[#0f172a]">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopHeader
          activeTab={panel?.kind === "auxiliary" ? panel.tab : "control"}
          controlViewMode={controlViewMode}
          onSelectTab={(tab: NavTab) =>
            tab === "control" ? closeAuxiliary() : selection.openAuxiliary(tab)
          }
          onSelectControlViewMode={setControlViewMode}
          timeStr={session.timeLabel}
          nowMs={session.nowMs}
          cancelledOrderNo={cancelledOrderNo}
          soundEnabled={session.soundEnabled}
          onToggleSound={session.toggleSound}
          simulating={session.simulating}
          showTimelineNow={view.timelineControls}
          onTimelineNow={() =>
            setTimelineCommand({ direction: "now", id: Date.now() })
          }
          followingNow={followingNow}
          labelPrinter={session.labelPrinter}
          unsent={session.unsent}
          onOpenSearch={() => selection.openSearch("")}
          searchOpen={selection.searchDigits !== null}
          onOpenEmergency={selection.openRebrew}
          onOpenPastOrders={selection.openPastOrders}
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
          {/* 盤面のカードのコメントの印を押すと、その注文のコメントを開く */}
          <FreshCommentsContext.Provider value={commentNotices.notices}>
            <OpenCommentsContext.Provider value={viewed.open}>
              <ControlWorkspace
                mode={controlViewMode}
                commentsPanel={
                  controlViewMode !== "a" && viewed.viewing ? (
                    <OrderChatPanel
                      key={viewed.viewing.label}
                      label={viewed.viewing.label}
                      comments={viewed.viewing.comments}
                      onClose={viewed.close}
                    />
                  ) : undefined
                }
                lanes={lanes}
                unassignedOrders={session.unassigned}
                orders={session.emergency.orders}
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
          </FreshCommentsContext.Provider>
        </main>
      </div>

      {selection.panels.map((saved) => {
        const id = selection.panelKey(saved);
        const closeSaved = () => selection.closePanel(saved);
        const active = panel !== null && selection.panelKey(panel) === id;
        const ticket =
          saved.kind === "detail" || saved.kind === "rebrew"
            ? session.cards.find((card) => card.key === saved.key)
            : undefined;
        return (
          <FloatingWindowScope
            key={id}
            value={{
              active,
              activate: () => selection.activatePanel(saved),
              suspend: () => selection.suspendPanel(saved),
            }}
          >
            {saved.kind === "pastOrders" && !session.simulating && (
              <PastOrdersPanel orders={orders} onClose={closeSaved} />
            )}
            {saved.kind === "auxiliary" && (
              <AuxiliarySheet
                tab={saved.tab}
                onClose={() => {
                  if (active) closeAuxiliary();
                  else closeSaved();
                }}
              >
                <AuxiliaryContent
                  tab={saved.tab}
                  onSelectTab={selection.openAuxiliary}
                  testPlay={{
                    active: testPlay.isActive,
                    simulating: session.simulating,
                    progressLabel: testPlay.remainingLabel,
                    onOpen: openTestPlay,
                    onEnd: endTestPlay,
                  }}
                  beans={session.beans}
                  lanes={lanes}
                  looks={looks}
                  typeNames={typeNames}
                  liveAnalytics={!session.simulating}
                  {...testPlay.analytics}
                />
              </AuxiliarySheet>
            )}
            {saved.kind === "detail" &&
              ticket?.status === "queued" &&
              ticket.dripper && (
                <TicketDetailPanel
                  ticket={ticket}
                  look={looks.get(ticket.key)}
                  lane={lanes[ticket.dripper - 1]}
                  onClose={closeSaved}
                  onMoveTicket={selection.move}
                  onReturnToUnassigned={selection.returnToUnassigned}
                  onSplitCup={selection.split}
                  onCancelEmergency={selection.cancelEmergency}
                />
              )}
            {saved.kind === "rebrew" &&
              (saved.key === null ||
                ticket?.status === "brewing" ||
                ticket?.status === "done") && (
                <RebrewPanel
                  card={ticket}
                  look={ticket && looks.get(ticket.key)}
                  lane={ticket?.dripper ? lanes[ticket.dripper - 1] : undefined}
                  orders={session.emergency.orders}
                  practice={session.simulating}
                  onClose={closeSaved}
                  onAdd={session.emergency.add}
                  move={{
                    onMoveTicket: selection.move,
                    onReturnToUnassigned: selection.returnToUnassigned,
                  }}
                />
              )}
            {saved.kind === "lane" && (
              <LanePanel
                lane={lanes[saved.bayId - 1]}
                onClose={closeSaved}
                onMoveQueue={session.moveQueue}
              />
            )}
            {saved.kind === "assign" && (
              <AssignPanel
                bayId={saved.bayId}
                lanes={lanes}
                unassignedOrders={session.unassigned}
                looks={looks}
                onClose={closeSaved}
                onAssign={selection.assign}
              />
            )}
            {saved.kind === "search" && (
              <OrderSearchPanel
                digits={saved.digits}
                found={search.found}
                pending={search.pending}
                looks={looks}
                onKey={search.press}
                onClose={search.finish}
              />
            )}
          </FloatingWindowScope>
        );
      })}

      <OperationNotices />
      <CornerToasts
        toasts={session.cornerToasts}
        onDismiss={session.dismissToast}
        onConfirm={session.confirm}
      />

      <CommentDock
        key={session.simulating ? "practice" : "live"}
        viewing={controlViewMode === "a" ? viewed.viewing : undefined}
        onCloseViewing={viewed.close}
        onRestoreViewing={viewed.open}
        notices={commentNotices.notices}
        onOpen={(comment) => {
          commentNotices.dismiss([comment], "open");
          if (controlViewMode === "a") search.show(comment.orderNo);
          else viewed.open(`#${orderNoLabel(comment.orderNo)}`);
        }}
        onDismiss={(comments) => commentNotices.dismiss(comments)}
      />

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
  // コメントの中身（右下・未提供の行・パネル）の下に、スタンプで返すボタンを出す
  return (
    <StampReplyContext.Provider value={stampReply}>
      {page}
    </StampReplyContext.Provider>
  );
}
