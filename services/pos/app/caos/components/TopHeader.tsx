import {
  BarChart3,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Database,
  LayoutGrid,
  Pause,
  Play,
  RotateCcw,
  Undo2,
  Volume2,
  VolumeX,
} from "lucide-react";
import type React from "react";
import type { AuxiliaryTab } from "../hooks/useAuxiliaryWindow";
import type { PosConnectionStatus } from "../hooks/usePosOrders";
import { CONTROL_VIEWS, type ControlViewMode } from "./ControlWorkspace";
import { AUXILIARY_TITLES } from "./SidePanels";

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
  isRunning: boolean;
  onTogglePlay: () => void;
  simSpeed: number;
  onCycleSpeed: () => void;
  onResetData: () => void;
  showTimelineControls: boolean;
  onTimelineNavigate: (direction: "back" | "now" | "forward") => void;
  /** 1つ戻すで戻せる操作（無ければ null） */
  undoLabel: string | null;
  onUndo: () => void;
  testPlaying: boolean;
  testProgressLabel: string | null;
  onOpenTestPlay: () => void;
  onEndTestPlay: () => void;
  posStatus: PosConnectionStatus;
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
  isRunning,
  onTogglePlay,
  simSpeed,
  onCycleSpeed,
  onResetData,
  showTimelineControls,
  onTimelineNavigate,
  undoLabel,
  onUndo,
  testPlaying,
  testProgressLabel,
  onOpenTestPlay,
  onEndTestPlay,
  posStatus,
}) => {
  return (
    <header className="flex h-[56px] shrink-0 select-none items-center justify-between gap-2 border-[#e2e8f0] border-b bg-white px-2 shadow-xs">
      {/* Left side: Clock and Top Metrics */}
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
                id={`nav-tab-${item.id}`}
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

        {/* Large Digital Clock */}
        <div className="flex items-center gap-2">
          <div className="font-bold font-mono text-[#0f172a] text-[28px] leading-none tracking-tight">
            {timeStr}
          </div>
          {/* Quick Sim Controls */}
          <div className="flex items-center gap-1 rounded-md border border-[#e2e8f0] bg-[#f1f5f9] p-1">
            <button
              type="button"
              id="sim-play-pause-btn"
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
              id="sim-speed-btn"
              onClick={onCycleSpeed}
              title="シミュレーション速度切替"
              className="h-10 min-w-10 touch-manipulation rounded-lg px-1.5 font-bold font-mono text-[11px] text-slate-700 transition-colors hover:bg-white"
            >
              {simSpeed}x
            </button>
            <button
              type="button"
              id="sim-reset-btn"
              onClick={onResetData}
              title="初期状態にリセット"
              className="flex h-10 w-10 touch-manipulation items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            {showTimelineControls && (
              <div className="ml-1 flex items-center gap-1 border-slate-300 border-l pl-1">
                <button
                  type="button"
                  onClick={() => onTimelineNavigate("back")}
                  title="5分前を表示"
                  className="flex h-10 touch-manipulation items-center gap-0.5 rounded-lg border border-slate-300 bg-white px-2 font-black text-[12px] text-slate-700"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  −5分
                </button>
                <button
                  type="button"
                  onClick={() => onTimelineNavigate("now")}
                  title="現在時刻へ戻る"
                  className="flex h-10 touch-manipulation items-center gap-1 rounded-lg bg-red-500 px-3 font-black text-[12px] text-white"
                >
                  <span className="h-2 w-2 rounded-full bg-white" />
                  現在
                </button>
                <button
                  type="button"
                  onClick={() => onTimelineNavigate("forward")}
                  title="5分先を表示"
                  className="flex h-10 touch-manipulation items-center gap-0.5 rounded-lg border border-slate-300 bg-white px-2 font-black text-[12px] text-slate-700"
                >
                  ＋5分
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Metric 1: 未割当オーダー (Unassigned Orders) */}
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

        {/* Metric 2: 全ベイ待機杯数 (Total Queued Cups in Bays) */}
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

      {/* Right side: only persistent operational controls */}
      <div className="flex items-center gap-2">
        <output
          aria-label={`cafeore-pos ${POS_STATUS[posStatus].label}`}
          title={`cafeore-posの注文: ${POS_STATUS[posStatus].label}`}
          className={`flex min-h-[44px] items-center gap-1 rounded-lg border px-2 font-black text-xs ${POS_STATUS[posStatus].box}`}
        >
          <Database className="h-4 w-4" />
          <span
            className={`h-2 w-2 rounded-full ${POS_STATUS[posStatus].dot}`}
          />
        </output>
        <button
          type="button"
          onClick={testPlaying ? onEndTestPlay : onOpenTestPlay}
          className={`flex min-h-[44px] touch-manipulation items-center gap-1.5 rounded-lg border px-3 font-black text-xs shadow-xs ${testPlaying ? "border-blue-700 bg-blue-700 text-white" : "border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100"}`}
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
            {testPlaying
              ? `終了・実績 ${testProgressLabel || ""}`
              : "実データテスト"}
          </span>
        </button>
        <button
          id="btn-undo"
          type="button"
          disabled={undoLabel === null}
          onClick={onUndo}
          title={
            undoLabel ? `${undoLabel}を元に戻す` : "元に戻せる操作はありません"
          }
          className="flex min-h-[44px] touch-manipulation items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 font-black text-slate-800 text-xs shadow-xs transition-colors hover:bg-slate-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        >
          <Undo2 className="h-4 w-4" />
          <span>1つ戻す</span>
        </button>

        {/* Sound toggle */}
        <button
          type="button"
          id="btn-toggle-sound"
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
      </div>
    </header>
  );
};
