import {
  BarChart3,
  Bean,
  CalendarClock,
  Database,
  History,
  type LucideIcon,
  Printer,
  Search,
  Volume2,
  VolumeX,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { EmergencyIcon } from "~/components/molecules/EmergencyForm";
import { PendingPrints } from "~/components/molecules/PendingPrints";
import { PrinterStatus } from "~/components/molecules/PrinterStatus";
import type { useCaosOutboxSender } from "../hooks/useCaosOutbox";
import type { PosConnectionStatus } from "../hooks/usePosOrders";
import openDripperSettingsIcon from "../icons/open-dripper-settings.svg";
import { orderNoLabel } from "../logic/cards";
import { CONTROL_VIEWS, type ControlViewMode } from "./ControlWorkspace";
import { FloatingStatusNotices, FloatingWindowTray } from "./FloatingWindows";
import { LaneHeaderStatus } from "./LaneParts";
import { AUXILIARY_TITLES, type AuxiliaryTab } from "./SidePanels";
import { UnsentOps } from "./UnsentOps";

export type NavTab = "control" | AuxiliaryTab;

/** シールのプリンターがつながっているか（usePrinter の status） */
type LabelPrinterStatus = React.ComponentProps<typeof PrinterStatus>["status"];

/** 支給SVGをマスクとして使い、選択状態に合わせた文字色をそのまま継承する。 */
const DripperNavIcon: React.FC<{ className?: string }> = ({
  className = "",
}) => (
  <span
    aria-hidden="true"
    className={`inline-block bg-current ${className}`}
    style={{
      maskImage: `url("${openDripperSettingsIcon}")`,
      WebkitMaskImage: `url("${openDripperSettingsIcon}")`,
      maskSize: "contain",
      WebkitMaskSize: "contain",
      maskRepeat: "no-repeat",
      WebkitMaskRepeat: "no-repeat",
      maskPosition: "center",
      WebkitMaskPosition: "center",
    }}
  />
);

// 画面切替（管制盤と、補助のタブ。補助のタブの名前は右のパネルの題と同じ）
const NAV_ITEMS = [
  { id: "control", label: "CaOS", icon: null },
  { id: "bays", label: AUXILIARY_TITLES.bays, icon: DripperNavIcon },
  { id: "beans", label: AUXILIARY_TITLES.beans, icon: Bean },
  { id: "analytics", label: AUXILIARY_TITLES.analytics, icon: BarChart3 },
] as const;

interface TopHeaderProps {
  activeTab: NavTab;
  controlViewMode: ControlViewMode;
  onSelectTab: (tab: NavTab) => void;
  onSelectControlViewMode: (mode: ControlViewMode) => void;
  timeStr: string;
  /** 盤面の時計。シフト交換の予告にも使う */
  nowMs: number;
  /** 今日届いた直近の注文キャンセル（練習中・未受信時はnull） */
  cancelledOrderNo: number | null;
  soundEnabled: boolean;
  onToggleSound: () => void;
  /** 実データテストの盤面を出している（「テスト」の色を変える。時計の操作は盤面の上の帯 TestBoardBanner） */
  simulating: boolean;
  /** 「現在」（管制盤 A のタイムラインを NOW へ戻す）を出すか */
  showTimelineNow: boolean;
  onTimelineNow: () => void;
  /** タイムラインが NOW を追っている（「現在」を押した形にする。手でスクロールしたら押していない形にして、押すと戻ることを見せる） */
  followingNow: boolean;
  testPlaying: boolean;
  testProgressLabel: string | null;
  onOpenTestPlay: () => void;
  onEndTestPlay: () => void;
  posStatus: PosConnectionStatus;
  /** この端末のシールのプリンター（つながっているか・証明書を許可するページ・刷れずに残っているシールの数と、送り直し・レジで印刷待ちのシールの数） */
  labelPrinter: {
    status: LabelPrinterStatus;
    certificateUrl: string;
    pendingCount: number;
    retry: () => void;
    relayedCount: number;
    relayAvailable?: boolean;
  };
  /** この端末のまだ送れていない盤面の操作と、送り直し・消す */
  unsent: ReturnType<typeof useCaosOutboxSender>;
  /** 注文番号の検索を開く */
  onOpenSearch: () => void;
  /** 注文番号の検索を開いている */
  searchOpen: boolean;
  /** 緊急（入れ直し）の入力を番号から開く。無ければ（実データテスト中）出さない */
  onOpenEmergency?: () => void;
  /** この画面が直前にした操作の名前（しばらくたつと null） */
  lastAction: string | null;
}

// 接続の札の色（枠・点）。注文の接続とシールのプリンターで共通
const TONES = {
  off: {
    box: "border-slate-200 bg-slate-100 text-slate-400",
    dot: "bg-slate-300",
  },
  waiting: {
    box: "border-amber-300 bg-amber-50 text-amber-800",
    dot: "bg-amber-400",
  },
  ok: {
    box: "border-emerald-300 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
  },
  ng: { box: "border-red-200 bg-red-50 text-red-500", dot: "bg-red-500" },
};
type Tone = keyof typeof TONES;

/** 接続の札（印と、色の点）。何がどうかは label（読み上げと、押し続けたときの title） */
const StatusBadge: React.FC<{
  icon: LucideIcon;
  label: string;
  tone: Tone;
  text?: string;
}> = ({ icon: Icon, label, tone, text }) => (
  <output
    aria-label={label}
    title={label}
    className={`flex min-h-[44px] items-center gap-1 rounded-lg border px-2 font-black text-xs ${TONES[tone].box}`}
  >
    <Icon className="h-4 w-4" />
    <span className={`h-2 w-2 rounded-full ${TONES[tone].dot}`} />
    {text && <span className="whitespace-nowrap">{text}</span>}
  </output>
);

const POS_STATUS: Record<PosConnectionStatus, { label: string; tone: Tone }> = {
  off: { label: "実データテスト中は停止", tone: "off" },
  connecting: { label: "接続中", tone: "waiting" },
  open: { label: "接続済み", tone: "ok" },
  reconnecting: { label: "再接続中", tone: "waiting" },
};

/** 注文の接続の札（閲覧だけの画面（ReadOnlyBoard）でも使う） */
export const PosStatusBadge: React.FC<{
  status: PosConnectionStatus;
  pendingCount?: number;
}> = ({ status, pendingCount = 0 }) => (
  <StatusBadge
    icon={Database}
    label={`cafeore-posの注文: ${POS_STATUS[status].label}${pendingCount ? `・DB保存待ち ${pendingCount}件` : ""}`}
    tone={pendingCount ? "waiting" : POS_STATUS[status].tone}
    text={pendingCount ? `保存待ち ${pendingCount}` : undefined}
  />
);

// シールのプリンターの札（つなぐ前はつないでいるところとして出す）
const PRINTER_STATUS: Record<
  LabelPrinterStatus,
  { label: string; tone: Tone }
> = {
  init: { label: "接続中", tone: "waiting" },
  connecting: { label: "接続中", tone: "waiting" },
  connected: { label: "接続完了", tone: "ok" },
  disconnected: { label: "未接続", tone: "ng" },
};

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
  nowMs,
  cancelledOrderNo,
  soundEnabled,
  onToggleSound,
  simulating,
  showTimelineNow,
  onTimelineNow,
  followingNow,
  testPlaying,
  testProgressLabel,
  onOpenTestPlay,
  onEndTestPlay,
  posStatus,
  labelPrinter,
  unsent,
  onOpenSearch,
  searchOpen,
  onOpenEmergency,
  lastAction,
}) => {
  // 「隠す」は現在の未接続にだけ適用し、接続状態が変わったら解除する。
  const [printerWarningHidden, setPrinterWarningHidden] = useState(false);
  useEffect(() => {
    if (labelPrinter.status !== "disconnected") {
      setPrinterWarningHidden(false);
    }
  }, [labelPrinter.status]);
  const showPrinterWarning =
    labelPrinter.status === "disconnected" &&
    !labelPrinter.relayAvailable &&
    !printerWarningHidden;
  const minute = new Date(nowMs).getUTCMinutes();
  const shiftReminder =
    minute >= 55 ? "シフト交換5分前" : minute >= 50 ? "シフト交換10分前" : null;
  const cancellation =
    cancelledOrderNo === null
      ? null
      : `キャンセル #${orderNoLabel(cancelledOrderNo)}`;
  const notices = [cancellation, shiftReminder].filter(Boolean);
  return (
    <header className="relative flex h-[56px] shrink-0 select-none items-center justify-between gap-2 border-[#e2e8f0] border-b bg-white px-2 shadow-xs">
      {/* まだ送れていない盤面の操作と、つながらないシールのプリンター（証明書を許可するページの案内）・刷れずに残っているシール。
          ヘッダーの下に重ねて出す（ヘッダーの並びを詰めない） */}
      <FloatingStatusNotices
        active={
          showPrinterWarning ||
          unsent.entries.length > 0 ||
          labelPrinter.pendingCount > 0 ||
          labelPrinter.relayedCount > 0
        }
      >
        {showPrinterWarning && (
          <div className="flex items-center gap-3">
            <PrinterStatus
              name="ラベル"
              status={labelPrinter.status}
              certificateUrl={labelPrinter.certificateUrl}
            />
            <button
              type="button"
              onClick={() => setPrinterWarningHidden(true)}
              className="min-h-11 shrink-0 rounded-lg border border-slate-300 px-3 text-slate-700 text-sm hover:bg-slate-100"
              aria-label="プリンター未接続の警告を隠す"
            >
              隠す
            </button>
          </div>
        )}
        <UnsentOps
          entries={unsent.entries}
          sending={unsent.sending}
          failure={unsent.failure}
          onRetry={unsent.retry}
          onDiscard={unsent.discard}
        />
        <PendingPrints
          count={labelPrinter.pendingCount}
          onRetry={labelPrinter.retry}
          relayedCount={labelPrinter.relayedCount}
        />
      </FloatingStatusNotices>
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
          {/* 時刻と、その下に直前の操作（この画面が最後にした操作。間違えたら逆の操作で直す）。並びが動かないよう幅を決めておく */}
          <div className="flex w-[118px] shrink-0 flex-col leading-none">
            <div className="font-bold font-mono text-[#0f172a] text-[24px] tracking-tight">
              {timeStr}
            </div>
            <output
              aria-label="直前の操作"
              title={lastAction ? `直前の操作：${lastAction}` : undefined}
              className={`mt-1 flex min-w-0 items-center gap-0.5 font-black text-[11px] ${lastAction ? "text-slate-950" : "text-slate-400"}`}
            >
              <History className="h-3 w-3 shrink-0" />
              <span className="truncate">{lastAction ?? "直前の操作なし"}</span>
            </output>
          </div>
          {showTimelineNow && (
            <button
              type="button"
              onClick={onTimelineNow}
              aria-pressed={followingNow}
              title={
                followingNow ? "現在時刻を追っています" : "現在時刻へ戻って追う"
              }
              className="group flex h-10 w-11 shrink-0 touch-manipulation flex-col items-center justify-center gap-1 whitespace-nowrap rounded-lg border-2 border-red-500 bg-white font-black text-[11px] text-red-600 leading-none aria-pressed:bg-red-500 aria-pressed:text-white"
            >
              <span className="h-2 w-2 rounded-full bg-red-500 group-aria-pressed:bg-white" />
              現在
            </button>
          )}
        </div>
      </div>

      <FloatingWindowTray />
      <output
        aria-live="polite"
        aria-atomic="true"
        title={notices.join("・") || undefined}
        className="flex min-w-0 flex-1 flex-col px-2 text-center font-black text-[16px] text-red-600 leading-tight"
      >
        {cancellation && <span className="truncate">{cancellation}</span>}
        {shiftReminder && <span className="truncate">{shiftReminder}</span>}
      </output>

      <div className="flex shrink-0 items-center gap-1">
        {/* 注文番号の検索（右のパネルにテンキー。キーボードの数字でも開く）。ヘッダーの並びを詰めないよう、印の下に小さく「番号」 */}
        <button
          type="button"
          onClick={onOpenSearch}
          aria-pressed={searchOpen}
          title="注文番号で探す"
          className="flex h-11 w-11 shrink-0 touch-manipulation flex-col items-center justify-center rounded-lg border border-[#cbd5e1] bg-[#f1f5f9] font-black text-[11px] text-slate-700 leading-none aria-pressed:border-slate-950 aria-pressed:bg-slate-950 aria-pressed:text-white"
        >
          <Search className="mb-0.5 h-4 w-4" />
          番号
        </button>
        {/* ドリッパーの担当者：上級生がいないときの知らせと、sohosai-shift の合言葉の設定 */}
        <LaneHeaderStatus />
        {/* 注文の接続とシールのプリンター。ヘッダーの幅を使わないよう上下に重ねる */}
        <div className="flex flex-col gap-0.5 [&>output]:h-[21px] [&>output]:min-h-0">
          <PosStatusBadge
            status={posStatus}
            pendingCount={unsent.pendingCount}
          />
          <StatusBadge
            icon={Printer}
            label={`ラベルプリンター: ${PRINTER_STATUS[labelPrinter.status].label}`}
            tone={PRINTER_STATUS[labelPrinter.status].tone}
          />
        </div>
        <button
          type="button"
          onClick={testPlaying ? onEndTestPlay : onOpenTestPlay}
          className={`flex h-11 min-w-11 touch-manipulation flex-col items-center justify-center whitespace-nowrap rounded-lg border px-1 font-black text-[11px] leading-none shadow-xs ${testButtonTone(testPlaying, simulating)}`}
          title={
            testPlaying
              ? "テストプレイを終了して実績を表示"
              : "過去の実データでテストプレイ"
          }
        >
          {/* ヘッダーの並びを詰めないよう、印の下に小さく */}
          {testPlaying ? (
            <BarChart3 className="mb-0.5 h-4 w-4" />
          ) : (
            <CalendarClock className="mb-0.5 h-4 w-4" />
          )}
          <span>
            {testPlaying ? `終了 ${testProgressLabel || ""}` : "テスト"}
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
