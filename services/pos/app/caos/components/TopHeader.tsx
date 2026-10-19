import {
  BellRing,
  type LucideIcon,
  Printer,
  Search,
  Settings,
  Volume2,
  VolumeX,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { EmergencyIcon } from "~/components/molecules/EmergencyForm";
import { PendingPrints } from "~/components/molecules/PendingPrints";
import { PrinterStatus } from "~/components/molecules/PrinterStatus";
import type { useCaosOutboxSender } from "../hooks/useCaosOutbox";
import { orderNoLabel } from "../logic/cards";
import { CONTROL_VIEW_BUTTONS, type ControlViewMode } from "./ControlWorkspace";
import { FloatingStatusNotices } from "./FloatingWindows";
import type { AuxiliaryTab } from "./SidePanels";
import { UnsentOps } from "./UnsentOps";

export type NavTab = "control" | AuxiliaryTab;

/** シールのプリンターがつながっているか（usePrinter の status） */
type LabelPrinterStatus = React.ComponentProps<typeof PrinterStatus>["status"];

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
  /** 実データテストの盤面を出している（本番の提供済み一覧は隠す） */
  simulating: boolean;
  /** 「現在」（管制盤 A のタイムラインを NOW へ戻す）を出すか */
  showTimelineNow: boolean;
  onTimelineNow: () => void;
  /** タイムラインが NOW を追っている（「現在」を押した形にする。手でスクロールしたら押していない形にして、押すと戻ることを見せる） */
  followingNow: boolean;
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
  onOpenPastOrders: () => void;
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
  labelPrinter,
  unsent,
  onOpenSearch,
  searchOpen,
  onOpenEmergency,
  onOpenPastOrders,
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
  const shiftReminderUrgent = minute >= 55;
  const cancellation =
    cancelledOrderNo === null
      ? null
      : `キャンセル #${orderNoLabel(cancelledOrderNo)}`;
  const notices = [cancellation, shiftReminder].filter(Boolean);
  return (
    <header
      data-caos-layer
      className="relative flex h-[56px] shrink-0 select-none items-center justify-between gap-2 border-[#bdd1e2] border-b bg-[#e4eff8] px-2 shadow-md"
    >
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
      <div className="flex h-full min-w-0 items-center gap-2">
        <fieldset
          className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-600 bg-slate-800 p-1"
          aria-label="管制盤の表示切替"
        >
          {CONTROL_VIEW_BUTTONS.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              aria-pressed={activeTab === "control" && controlViewMode === mode}
              onClick={() => {
                onSelectControlViewMode(mode);
                onSelectTab("control");
              }}
              className={`h-10 min-w-10 touch-manipulation whitespace-nowrap rounded-md px-2.5 font-black text-[14px] ${activeTab === "control" && controlViewMode === mode ? "bg-sky-300 text-slate-950 shadow-sm" : "bg-slate-700 text-slate-100 hover:bg-slate-600"}`}
            >
              {label}
            </button>
          ))}
        </fieldset>

        {/* 左側は表示切替、時計、現在の順。 */}
        <div className="flex h-full w-[240px] shrink-0 items-center justify-center">
          <time className="grid h-full w-full shrink-0 place-items-center whitespace-nowrap text-center font-bold font-mono text-[48px] text-slate-900 tabular-nums leading-none">
            {timeStr}
          </time>
        </div>

        {showTimelineNow && (
          <button
            type="button"
            onClick={onTimelineNow}
            aria-pressed={followingNow}
            title={
              followingNow ? "現在時刻を追っています" : "現在時刻へ戻って追う"
            }
            className="group flex h-11 w-12 shrink-0 touch-manipulation flex-col items-center justify-center gap-1 whitespace-nowrap rounded-lg border-2 border-red-500 bg-white font-black text-[11px] text-red-600 leading-none aria-pressed:bg-red-500 aria-pressed:text-white"
          >
            <span className="h-2 w-2 rounded-full bg-red-500 group-aria-pressed:bg-white" />
            現在
          </button>
        )}
      </div>

      <output
        aria-live="polite"
        aria-atomic="true"
        title={notices.join("・") || undefined}
        className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-2 text-center font-black text-[16px] leading-tight"
      >
        {cancellation && (
          <span className="max-w-full truncate text-red-800">
            {cancellation}
          </span>
        )}
        {shiftReminder && (
          <span
            className={`inline-flex max-w-full items-center gap-2 whitespace-nowrap rounded-lg border-2 px-4 py-1 text-[18px] shadow-md ${
              shiftReminderUrgent
                ? "border-red-600 bg-red-100 text-red-800"
                : "border-amber-900 bg-yellow-300 text-slate-950 ring-2 ring-white/90"
            }`}
          >
            <BellRing className="h-5 w-5 shrink-0" />
            <span className="truncate">{shiftReminder}</span>
          </span>
        )}
      </output>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onSelectTab("settings")}
          aria-pressed={
            activeTab === "settings" ||
            activeTab === "bays" ||
            activeTab === "beans"
          }
          title="設定"
          className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-700 aria-pressed:border-slate-950 aria-pressed:bg-slate-950 aria-pressed:text-white"
        >
          <Settings className="h-5 w-5" />
          <span className="sr-only">設定</span>
        </button>

        <button
          type="button"
          onClick={onToggleSound}
          title={soundEnabled ? "通知音 ON" : "通知音 消音"}
          className={`flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg border text-xs transition-colors ${
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
        {!simulating && (
          <button
            type="button"
            onClick={onOpenPastOrders}
            className="h-11 shrink-0 touch-manipulation whitespace-nowrap rounded-lg border border-slate-300 bg-slate-100 px-3 font-bold text-slate-700 text-sm hover:bg-slate-200"
          >
            提供済み一覧
          </button>
        )}
        {/* 緊急（入れ直し）は接続状況より左に置く。 */}
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
        {/* シールのプリンターの状態は右端に表示する。 */}
        <div className="flex flex-col gap-0.5 [&>output]:h-[21px] [&>output]:min-h-0">
          <StatusBadge
            icon={Printer}
            label={`ラベルプリンター: ${PRINTER_STATUS[labelPrinter.status].label}`}
            tone={PRINTER_STATUS[labelPrinter.status].tone}
          />
        </div>
      </div>
    </header>
  );
};
