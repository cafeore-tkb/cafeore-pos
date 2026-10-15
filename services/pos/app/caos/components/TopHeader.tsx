import {
  BarChart3,
  CalendarClock,
  Coffee,
  Database,
  Eye,
  LayoutGrid,
  type LucideIcon,
  Pause,
  Play,
  Printer,
  RotateCcw,
  Search,
  Volume2,
  VolumeX,
} from "lucide-react";
import type React from "react";
import { Link } from "react-router";
import { EmergencyIcon } from "~/components/molecules/EmergencyForm";
import { PendingPrints } from "~/components/molecules/PendingPrints";
import { PrinterStatus } from "~/components/molecules/PrinterStatus";
import type { useCaosOutboxSender } from "../hooks/useCaosOutbox";
import type { PosConnectionStatus } from "../hooks/usePosOrders";
import { LATE_ORDER_MIN, type orderBacklog } from "../logic/backlog";
import { orderNoLabel } from "../logic/cards";
import { clockLabel } from "../logic/format";
import { CONTROL_VIEWS, type ControlViewMode } from "./ControlWorkspace";
import { LaneHeaderStatus } from "./LaneParts";
import { AUXILIARY_TITLES, type AuxiliaryTab } from "./SidePanels";
import { UnsentOps } from "./UnsentOps";

export type NavTab = "control" | AuxiliaryTab;

/** 注文の数と杯数（logic/cards.ts の orderAndCupCounts） */
type Counts = { orders: number; cups: number };

/** シールのプリンターがつながっているか（usePrinter の status） */
type LabelPrinterStatus = React.ComponentProps<typeof PrinterStatus>["status"];

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
  /** 未割当と、全ドリッパーの待ち（抽出中・待機）の注文の数と杯数 */
  counts: { unassigned: Counts; waiting: Counts };
  /** 抽出を始めていない注文の待ち（いちばん古い未割当・LATE_ORDER_MIN 分を超えた注文） */
  backlog: ReturnType<typeof orderBacklog>;
  /** 注文番号でその注文を選ぶ（番号の検索と同じ） */
  onFindOrder: (orderNo: number) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  /** 実データテストの時計（一時停止・速さ・やめる）を出すか */
  simulating: boolean;
  isRunning: boolean;
  onTogglePlay: () => void;
  simSpeed: number;
  onCycleSpeed: () => void;
  onResetData: () => void;
  /** 「現在」（管制盤 A のタイムラインを NOW へ戻す）を出すか */
  showTimelineNow: boolean;
  onTimelineNow: () => void;
  testPlaying: boolean;
  testProgressLabel: string | null;
  onOpenTestPlay: () => void;
  onEndTestPlay: () => void;
  posStatus: PosConnectionStatus;
  /** この端末のシールのプリンター（つながっているか・証明書を許可するページ・刷れずに残っているシールの数と、送り直し） */
  labelPrinter: {
    status: LabelPrinterStatus;
    certificateUrl: string;
    pendingCount: number;
    retry: () => void;
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
}> = ({ icon: Icon, label, tone }) => (
  <output
    aria-label={label}
    title={label}
    className={`flex min-h-[44px] items-center gap-1 rounded-lg border px-2 font-black text-xs ${TONES[tone].box}`}
  >
    <Icon className="h-4 w-4" />
    <span className={`h-2 w-2 rounded-full ${TONES[tone].dot}`} />
  </output>
);

const POS_STATUS: Record<PosConnectionStatus, { label: string; tone: Tone }> = {
  off: { label: "実データテスト中は停止", tone: "off" },
  connecting: { label: "接続中", tone: "waiting" },
  open: { label: "接続済み", tone: "ok" },
  reconnecting: { label: "再接続中", tone: "waiting" },
};

/** 注文の接続の札（閲覧だけの画面（ReadOnlyBoard）でも使う） */
export const PosStatusBadge: React.FC<{ status: PosConnectionStatus }> = ({
  status,
}) => (
  <StatusBadge
    icon={Database}
    label={`cafeore-posの注文: ${POS_STATUS[status].label}`}
    tone={POS_STATUS[status].tone}
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
  counts,
  backlog,
  onFindOrder,
  soundEnabled,
  onToggleSound,
  simulating,
  isRunning,
  onTogglePlay,
  simSpeed,
  onCycleSpeed,
  onResetData,
  showTimelineNow,
  onTimelineNow,
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
  const oldest = backlog.oldestUnassigned;
  return (
    <header className="relative flex h-[56px] shrink-0 select-none items-center justify-between gap-2 border-[#e2e8f0] border-b bg-white px-2 shadow-xs">
      {/* まだ送れていない盤面の操作と、つながらないシールのプリンター（証明書を許可するページの案内）・刷れずに残っているシール。
          ヘッダーの下に重ねて出す（ヘッダーの並びを詰めず、A の「次へ」の列も隠さない） */}
      <div className="absolute top-full right-[108px] z-[160] mt-1 flex flex-col items-end gap-1 [&>*]:rounded-lg [&>*]:border-2 [&>*]:border-red-300 [&>*]:bg-white [&>*]:px-3 [&>*]:py-1 [&>*]:shadow-lg">
        {labelPrinter.status === "disconnected" && (
          <PrinterStatus
            name="ラベル"
            status={labelPrinter.status}
            certificateUrl={labelPrinter.certificateUrl}
          />
        )}
        <UnsentOps
          entries={unsent.entries}
          onRetry={unsent.retry}
          onDiscard={unsent.discard}
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
            {showTimelineNow && (
              <button
                type="button"
                onClick={onTimelineNow}
                title="現在時刻へ戻る"
                className={`flex h-10 touch-manipulation items-center gap-1 whitespace-nowrap rounded-lg bg-red-500 px-2 font-black text-[12px] text-white ${simulating ? "ml-1" : ""}`}
              >
                <span className="h-2 w-2 rounded-full bg-white" />
                現在
              </button>
            )}
          </div>
        </div>

        {/* 注文の数（杯数は小さく添える）。統合したカードは中の注文をみな、分けた注文は 1 つと数える */}
        <div className="flex shrink-0 flex-col justify-center rounded-md border border-[#d3e5f8] bg-[#eef5fc] px-2 py-0.5 font-semibold text-[#475569] text-[11px] leading-tight">
          <CountLine
            label="未割当"
            counts={counts.unassigned}
            className="text-[#ef4444]"
          />
          <CountLine
            label="待ち"
            counts={counts.waiting}
            className="text-[#0f172a]"
          />
        </div>

        {/* 入れ忘れ・飛ばしに気づく：いちばん古い未割当と、受けてから LATE_ORDER_MIN 分を超えて始めていない注文。押すとその注文を選ぶ */}
        <BacklogButton
          label="最古の未割当"
          value={
            oldest
              ? `#${orderNoLabel(oldest.orderNo)} ${clockLabel(oldest.waitSec)}`
              : "なし"
          }
          late={oldest !== null && oldest.waitSec > LATE_ORDER_MIN * 60}
          title={
            oldest
              ? `いちばん古い未割当 #${orderNoLabel(oldest.orderNo)}（受けてから ${clockLabel(oldest.waitSec)}）を選ぶ`
              : "未割当の注文はありません"
          }
          onClick={oldest ? () => onFindOrder(oldest.orderNo) : undefined}
        />
        <BacklogButton
          label={`${LATE_ORDER_MIN}分超`}
          value={`${backlog.late.length}件`}
          late={backlog.late.length > 0}
          title={
            backlog.late.length > 0
              ? `受けてから ${LATE_ORDER_MIN} 分を超えて、まだ抽出を始めていない注文（いちばん古い #${orderNoLabel(backlog.late[0].orderNo)} を選ぶ）`
              : `受けてから ${LATE_ORDER_MIN} 分を超えて、まだ抽出を始めていない注文はありません`
          }
          onClick={
            backlog.late.length > 0
              ? () => onFindOrder(backlog.late[0].orderNo)
              : undefined
          }
        />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
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
        {/* リベロビュー（閲覧のみ）。この画面を閉じないよう、別のタブで開く */}
        <Link
          to="/master-sheet/libero"
          target="_blank"
          title="リベロビュー（閲覧のみ。別のタブで開く）"
          className="flex min-h-[44px] shrink-0 touch-manipulation items-center gap-1 whitespace-nowrap rounded-lg border border-[#cbd5e1] bg-[#f1f5f9] px-2 font-black text-slate-700 text-xs"
        >
          <Eye className="h-4 w-4" />
          リベロ
        </Link>
        {/* ドリッパーの担当者：上級生がいないときの知らせと、sohosai-shift の合言葉の設定 */}
        <LaneHeaderStatus />
        {/* 注文の接続とシールのプリンター。ヘッダーの幅を使わないよう上下に重ねる */}
        <div className="flex flex-col gap-0.5 [&>output]:h-[21px] [&>output]:min-h-0">
          <PosStatusBadge status={posStatus} />
          <StatusBadge
            icon={Printer}
            label={`ラベルプリンター: ${PRINTER_STATUS[labelPrinter.status].label}`}
            tone={PRINTER_STATUS[labelPrinter.status].tone}
          />
        </div>
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
        {/* 直前の操作（この画面が最後にした操作。間違えたら逆の操作で直す）。並びが動かないよう幅を決めておく */}
        <output
          aria-label="直前の操作"
          title={lastAction ?? undefined}
          className="flex h-11 w-[124px] shrink-0 flex-col justify-center rounded-lg border border-slate-300 bg-slate-50 px-2 leading-tight"
        >
          <span className="font-bold text-[10px] text-slate-500">
            直前の操作
          </span>
          <span
            className={`truncate font-black text-[12px] ${lastAction ? "text-slate-950" : "text-slate-300"}`}
          >
            {lastAction ?? "なし"}
          </span>
        </output>

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

/** ヘッダーの注文の数の 1 行（「未割当 8件 10杯」） */
const CountLine: React.FC<{
  label: string;
  counts: Counts;
  className: string;
}> = ({ label, counts, className }) => (
  <span className="flex items-baseline gap-1 whitespace-nowrap">
    <span className="w-[3em]">{label}</span>
    <span className={`font-extrabold font-mono text-[16px] ${className}`}>
      {counts.orders}
    </span>
    件<span className="font-mono text-[10px]">{counts.cups}杯</span>
  </span>
);

/** 待っている注文の札（押すとその注文を選ぶ。押せる注文が無ければ押せない）。late なら赤くする */
const BacklogButton: React.FC<{
  label: string;
  value: string;
  late: boolean;
  title: string;
  onClick?: () => void;
}> = ({ label, value, late, title, onClick }) => (
  <button
    type="button"
    disabled={!onClick}
    onClick={onClick}
    title={title}
    className={`flex h-11 shrink-0 touch-manipulation flex-col items-start justify-center whitespace-nowrap rounded-md border px-2 leading-tight disabled:opacity-60 ${late ? "border-red-300 bg-red-50 text-red-700" : "border-slate-300 bg-white text-slate-700"}`}
  >
    <span className="font-bold text-[10px]">{label}</span>
    <span className="font-black font-mono text-[14px]">{value}</span>
  </button>
);
