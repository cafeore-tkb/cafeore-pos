import {
  BarChart3,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Database,
  Eye,
  LayoutGrid,
  Pause,
  Play,
  RotateCcw,
  Undo2,
  Volume2,
  VolumeX,
} from "lucide-react";
import type React from "react";
import { Link } from "react-router";
import { EmergencyIcon } from "~/components/molecules/EmergencyForm";
import { PendingPrints } from "~/components/molecules/PendingPrints";
import type { PosConnectionStatus } from "../hooks/usePosOrders";
import { CONTROL_VIEWS, type ControlViewMode } from "./ControlWorkspace";
import { LaneHeaderStatus } from "./LaneParts";
import { AUXILIARY_TITLES, type AuxiliaryTab } from "./SidePanels";

export type NavTab = "control" | AuxiliaryTab;

// 画面切替（管制盤と、補助のタブ。補助のタブの名前は右のパネルの題と同じ）
const NAV_ITEMS = [
  { id: "control", label: "CaOS", icon: null },
  { id: "bays", label: AUXILIARY_TITLES.bays, icon: LayoutGrid },
  { id: "beans", label: AUXILIARY_TITLES.beans, icon: Coffee },
  { id: "analytics", label: AUXILIARY_TITLES.analytics, icon: BarChart3 },
] as const;

interface TopHeaderProps {
  activeTab: NavTab;
  controlViewMode: ControlViewMode;
  onSelectTab: (tab: NavTab) => void;
  onSelectControlViewMode: (mode: ControlViewMode) => void;
  timeStr: string;
  unassignedCups: number;
  totalWaitingCups: number;
  soundEnabled: boolean;
  onToggleSound: () => void;
  /** 実データテストの時計（一時停止・速さ・やめる）を出すか */
  simulating: boolean;
  isRunning: boolean;
  onTogglePlay: () => void;
  simSpeed: number;
  onCycleSpeed: () => void;
  onResetData: () => void;
  showTimelineControls: boolean;
  onTimelineNavigate: (direction: "back" | "now" | "forward") => void;
  testPlaying: boolean;
  testProgressLabel: string | null;
  onOpenTestPlay: () => void;
  onEndTestPlay: () => void;
  posStatus: PosConnectionStatus;
  /** この端末のシールのプリンター（刷れずに残っているシールの数と、送り直し） */
  labelPrinter: { pendingCount: number; retry: () => void };
  /** この端末のまだ送れていない盤面の操作の数と、送り直し */
  unsent: { count: number; retry: () => void };
  /** 緊急（入れ直し）の入力を番号から開く。無ければ（実データテスト中）出さない */
  onOpenEmergency?: () => void;
  /** 「1つ戻す」で戻せる操作の名前。戻せなければ null */
  undoLabel: string | null;
  /** 戻せる残りの秒 */
  undoSecondsLeft: number;
  undoPending: boolean;
  onUndo: () => void;
}

// 注文の接続の札（文字・枠・点の色）
const POS_STATUS: Record<
  PosConnectionStatus,
  { label: string; box: string; dot: string }
> = {
  off: {
    label: "実データテスト中は停止",
    box: "border-slate-200 bg-slate-100 text-slate-400",
    dot: "bg-slate-300",
  },
  connecting: {
    label: "接続中",
    box: "border-amber-300 bg-amber-50 text-amber-800",
    dot: "bg-amber-400",
  },
  open: {
    label: "接続済み",
    box: "border-emerald-300 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
  },
  reconnecting: {
    label: "再接続中",
    box: "border-amber-300 bg-amber-50 text-amber-800",
    dot: "bg-amber-400",
  },
};

/** 注文の接続の札（閲覧だけの画面（ReadOnlyBoard）でも使う） */
export const PosStatusBadge: React.FC<{ status: PosConnectionStatus }> = ({
  status,
}) => (
  <output
    aria-label={`cafeore-pos ${POS_STATUS[status].label}`}
    title={`cafeore-posの注文: ${POS_STATUS[status].label}`}
    className={`flex min-h-[44px] items-center gap-1 rounded-lg border px-2 font-black text-xs ${POS_STATUS[status].box}`}
  >
    <Database className="h-4 w-4" />
    <span className={`h-2 w-2 rounded-full ${POS_STATUS[status].dot}`} />
  </output>
);

// 「テスト」の色。テスト中は濃い青、テストを終えてもテストの盤面のあいだは本番と見分けられる色
const testButtonTone = (testPlaying: boolean, testBoard: boolean) => {
  if (testPlaying) return "border-blue-700 bg-blue-700 text-white";
  if (testBoard)
    return "border-amber-500 bg-amber-100 text-amber-950 hover:bg-amber-200";
  return "border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100";
};

export const TopHeader: React.FC<TopHeaderProps> = ({
  activeTab,
  controlViewMode,
  onSelectTab,
  onSelectControlViewMode,
  timeStr,
  unassignedCups,
  totalWaitingCups,
  soundEnabled,
  onToggleSound,
  simulating,
  isRunning,
  onTogglePlay,
  simSpeed,
  onCycleSpeed,
  onResetData,
  showTimelineControls,
  onTimelineNavigate,
  testPlaying,
  testProgressLabel,
  onOpenTestPlay,
  onEndTestPlay,
  posStatus,
  labelPrinter,
  unsent,
  onOpenEmergency,
  undoLabel,
  undoSecondsLeft,
  undoPending,
  onUndo,
}) => {
  return (
    <header className="relative flex h-[56px] shrink-0 select-none items-center justify-between gap-2 border-[#e2e8f0] border-b bg-white px-2 shadow-xs">
      {/* まだ送れていない盤面の操作と、刷れずに残っているシール。ヘッダーの下に重ねて出す（ヘッダーの並びを詰めず、A の「次へ」の列も隠さない） */}
      <div className="absolute top-full right-[108px] z-[160] mt-1 flex flex-col items-end gap-1 [&>*]:rounded-lg [&>*]:border-2 [&>*]:border-red-300 [&>*]:bg-white [&>*]:px-3 [&>*]:py-1 [&>*]:shadow-lg">
        <PendingPrints
          count={unsent.count}
          onRetry={unsent.retry}
          label="未送信"
          retryLabel="もう一度送る"
        />
        <PendingPrints
          count={labelPrinter.pendingCount}
          onRetry={labelPrinter.retry}
        />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <nav
          className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1"
          aria-label="画面切替"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                aria-pressed={active}
                title={item.label}
                className={`flex h-10 min-w-10 touch-manipulation items-center justify-center gap-1 rounded-md px-2 font-black text-[11px] ${active ? "bg-slate-950 text-white shadow-sm" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                {Icon && <Icon className="h-4 w-4" />}
                <span
                  className={item.id === "control" ? "" : "hidden 2xl:inline"}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
          {activeTab === "control" && (
            <fieldset
              className="ml-0.5 flex min-w-0 items-center gap-0.5 border-slate-300 border-l pl-1"
              aria-label="管制盤の表示切替"
            >
              {Object.entries(CONTROL_VIEWS).map(([mode, view]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={controlViewMode === mode}
                  onClick={() =>
                    onSelectControlViewMode(mode as ControlViewMode)
                  }
                  className={`h-10 min-w-9 touch-manipulation rounded-md font-black text-[12px] ${controlViewMode === mode ? "bg-blue-700 text-white" : "bg-white text-slate-600"}`}
                >
                  {view.label}
                </button>
              ))}
            </fieldset>
          )}
        </nav>

        <div className="flex items-center gap-2">
          <div className="font-bold font-mono text-[#0f172a] text-[26px] leading-none tracking-tight">
            {timeStr}
          </div>
          <div className="flex items-center gap-1 rounded-md border border-[#e2e8f0] bg-[#f1f5f9] p-1 empty:hidden">
            {simulating && (
              <>
                <button
                  type="button"
                  onClick={onTogglePlay}
                  title={isRunning ? "一時停止" : "タイマー再開"}
                  className="flex h-10 w-10 touch-manipulation items-center justify-center rounded-lg text-slate-700 text-xs transition-colors hover:bg-white"
                >
                  {isRunning ? (
                    <Pause className="h-3.5 w-3.5" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={onCycleSpeed}
                  title="シミュレーション速度切替"
                  className="h-10 min-w-10 touch-manipulation rounded-lg px-1.5 font-bold font-mono text-[11px] text-slate-700 transition-colors hover:bg-white"
                >
                  {simSpeed}x
                </button>
                <button
                  type="button"
                  onClick={onResetData}
                  title="初期状態にリセット"
                  className="flex h-10 w-10 touch-manipulation items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-white"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {showTimelineControls && (
              <div
                className={`flex items-center gap-1 ${simulating ? "ml-1 border-slate-300 border-l pl-1" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => onTimelineNavigate("back")}
                  title="5分前を表示"
                  className="flex h-10 touch-manipulation items-center whitespace-nowrap rounded-lg border border-slate-300 bg-white px-1.5 font-black text-[12px] text-slate-700"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  5分
                </button>
                <button
                  type="button"
                  onClick={() => onTimelineNavigate("now")}
                  title="現在時刻へ戻る"
                  className="flex h-10 touch-manipulation items-center gap-1 whitespace-nowrap rounded-lg bg-red-500 px-2 font-black text-[12px] text-white"
                >
                  <span className="h-2 w-2 rounded-full bg-white" />
                  現在
                </button>
                <button
                  type="button"
                  onClick={() => onTimelineNavigate("forward")}
                  title="5分先を表示"
                  className="flex h-10 touch-manipulation items-center whitespace-nowrap rounded-lg border border-slate-300 bg-white px-1.5 font-black text-[12px] text-slate-700"
                >
                  5分
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="hidden items-baseline gap-1.5 rounded-md border border-[#d3e5f8] bg-[#eef5fc] px-3 py-1.5 xl:flex">
          <span className="font-semibold text-[#475569] text-[12px]">
            未割当オーダー
          </span>
          <div className="flex items-baseline font-mono">
            <span className="font-extrabold text-[#ef4444] text-[19px] leading-none">
              {unassignedCups}
            </span>
            <span className="ml-1 font-bold text-[#475569] text-[12px]">
              杯
            </span>
          </div>
        </div>

        <div className="hidden items-baseline gap-1.5 rounded-md border border-[#d3e5f8] bg-[#eef5fc] px-3 py-1.5 xl:flex">
          <span className="font-semibold text-[#475569] text-[12px]">
            全ドリッパー待機杯数
          </span>
          <div className="flex items-baseline font-mono">
            <span className="font-extrabold text-[#0f172a] text-[19px] leading-none">
              {totalWaitingCups}
            </span>
            <span className="ml-1 font-bold text-[#475569] text-[12px]">
              杯
            </span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* リベロビュー（閲覧のみ）。この画面を閉じないよう、別のタブで開く */}
        <Link
          to="/master-sheet/libero"
          target="_blank"
          rel="noopener"
          title="リベロビュー（閲覧のみ。別のタブで開く）"
          className="flex min-h-[44px] shrink-0 touch-manipulation items-center gap-1 whitespace-nowrap rounded-lg border border-[#cbd5e1] bg-[#f1f5f9] px-2 font-black text-slate-700 text-xs"
        >
          <Eye className="h-4 w-4" />
          リベロ
        </Link>
        {/* ドリッパーの担当者：上級生がいないときの知らせと、sohosai-shift の合言葉の設定 */}
        <LaneHeaderStatus />
        <PosStatusBadge status={posStatus} />
        <button
          type="button"
          onClick={testPlaying ? onEndTestPlay : onOpenTestPlay}
          className={`flex min-h-[44px] touch-manipulation items-center gap-1 whitespace-nowrap rounded-lg border px-2 font-black text-xs shadow-xs ${testButtonTone(testPlaying, simulating)}`}
          title={
            testPlaying
              ? "テストプレイを終了して実績を表示"
              : "過去の実データでテストプレイ"
          }
        >
          {testPlaying ? (
            <BarChart3 className="h-4 w-4" />
          ) : (
            <CalendarClock className="h-4 w-4" />
          )}
          <span>
            {testPlaying ? `終了 ${testProgressLabel || ""}` : "テスト"}
          </span>
        </button>
        {/* 1つ戻す。この画面が最後にした操作を、10 秒のあいだ戻せる。押せるあいだは濃くし、何を戻すかと残りの秒を出す */}
        <button
          type="button"
          disabled={!undoLabel || undoPending}
          onClick={onUndo}
          title={
            undoLabel ? `「${undoLabel}」を戻す` : "戻せる操作はありません"
          }
          aria-label={undoLabel ? `1つ戻す：${undoLabel}` : "1つ戻す"}
          className="flex min-h-[44px] touch-manipulation items-center gap-1 whitespace-nowrap rounded-lg border border-slate-900 bg-slate-900 px-2 font-black text-white text-xs shadow-xs transition-colors hover:bg-slate-700 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        >
          <Undo2 className="h-4 w-4" />
          <span className="flex min-w-0 flex-col items-start leading-tight">
            <span>
              戻す
              {undoLabel && (
                <span className="font-mono">（{undoSecondsLeft}）</span>
              )}
            </span>
            {undoLabel && (
              <span className="max-w-[8rem] truncate font-bold text-[10px]">
                {undoLabel}
              </span>
            )}
          </span>
        </button>

        <button
          type="button"
          onClick={onToggleSound}
          title={soundEnabled ? "通知音 ON" : "通知音 消音"}
          className={`flex h-11 w-11 touch-manipulation items-center justify-center rounded-lg border text-xs transition-colors ${
            soundEnabled
              ? "border-[#cbd5e1] bg-[#f1f5f9] text-slate-700"
              : "border-red-200 bg-red-50 text-red-500"
          }`}
        >
          {soundEnabled ? (
            <Volume2 className="h-4 w-4" />
          ) : (
            <VolumeX className="h-4 w-4" />
          )}
        </button>
        {/* 緊急（入れ直し）。右端に置き、右手で押しても盤面を隠さない */}
        {onOpenEmergency && (
          <button
            type="button"
            onClick={onOpenEmergency}
            className="flex h-11 shrink-0 touch-manipulation items-center gap-1 whitespace-nowrap rounded-lg border-2 border-red-800 bg-red-600 px-3 font-black text-[15px] text-white shadow-xs hover:bg-red-700"
          >
            <EmergencyIcon className="h-5 w-5" />
            緊急
          </button>
        )}
      </div>
    </header>
  );
};
