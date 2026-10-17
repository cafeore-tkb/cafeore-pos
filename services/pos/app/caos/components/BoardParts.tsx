import { type CaosCard, dripperLabel } from "@cafeore/common";
import { Clock3, type LucideIcon, Pause, Play, Plus } from "lucide-react";
import type React from "react";
import { Button } from "~/components/ui/button";
import type { OpenCornerToast } from "../hooks/useCornerToasts";
import { longWaitMinutes } from "../logic/alerts";
import { orderAndCupCounts, orderLabel } from "../logic/cards";
import { clockLabel } from "../logic/format";
import type { LanePhase, LaneStatus } from "../logic/queue";

// 管制盤 A・C・D で共通の部品（パネルの見出し・列の番号と状態・右上の確かめ・知らせ（「次へ」の確かめ・統合と上級生のみの知らせ）・空きスロット・次に空く・長く待っている未割当の札）

/** パネルの見出し（アイコン・題・右に添えるもの）。題の代わりにタブを置くときは icon・title を渡さない */
export const PanelHeader: React.FC<{
  icon?: LucideIcon;
  title?: string;
  className?: string;
  backgroundClassName?: string;
  children?: React.ReactNode;
}> = ({
  icon: Icon,
  title,
  className = "border-slate-200 border-b",
  children,
  backgroundClassName = "bg-slate-50",
}) => (
  <header
    className={`flex h-11 shrink-0 items-center gap-2 rounded-t-lg px-3 ${backgroundClassName} ${className}`}
  >
    {Icon && <Icon className="h-4 w-4 shrink-0 text-slate-700" />}
    {title && (
      <h2 className="shrink-0 font-black text-[15px] text-slate-950">
        {title}
      </h2>
    )}
    {children}
  </header>
);

/** カードの注文の数（「8 件」）に杯数を小さく添える（未割当の見出し）。統合したカードは中の注文をみな、分けた注文は 1 つと数える */
export const OrderCountLabel: React.FC<{ cards: readonly CaosCard[] }> = ({
  cards,
}) => {
  const { orders, cups } = orderAndCupCounts(cards);
  return (
    <>
      {orders} 件<span className="ml-1 text-[0.8em] opacity-75">{cups} 杯</span>
    </>
  );
};

/** 列の番号（1st〜6th。右のパネルの列の一覧）。担当者の名前は出さない */
export const LaneBadge: React.FC<{ bayId: number }> = ({ bayId }) => (
  <span className="flex h-8 w-fit min-w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 px-1 font-bold font-mono text-[13px] text-slate-600">
    {dripperLabel(bayId)}
  </span>
);

// 列の状態の色と札（ドリッパーの番号に出す）。空きは「今すぐ割り当てられる」ので一番目立たせ、待機（始めていない）は青、
// 抽出中は白、まもなくは黄、予定より長くかかっている継続中は薄い赤（caos.css の --caos-overtime。緊急の赤と分ける）。
// 色だけに頼らず札の文字も出す。継続中のうち予定を大きく過ぎた抽出（入れ忘れ・終えるのを押し忘れたのかもしれない。logic/alerts）は FORGOTTEN
const PHASES: Record<LanePhase, { label: string; className: string }> = {
  empty: {
    label: "空き",
    className: "border-emerald-700 bg-emerald-500 text-white",
  },
  waiting: { label: "待機", className: "border-sky-800 bg-sky-600 text-white" },
  brewing: {
    label: "抽出中",
    className: "border-emerald-600 bg-white text-slate-950",
  },
  soon: {
    label: "まもなく",
    className: "border-amber-600 bg-amber-300 text-slate-950",
  },
  overtime: {
    label: "継続中",
    className:
      "border-(color:--caos-overtime-line) bg-(color:--caos-overtime) text-(color:--caos-overtime-text)",
  },
};

// 予定を大きく過ぎた抽出。継続中の赤を濃くし、点滅させ（caos.css の .caos-forgotten）、札は「要確認」と過ぎた時間
const FORGOTTEN = {
  label: "要確認",
  className:
    "caos-forgotten border-(color:--caos-overtime-text) bg-(color:--caos-overtime-line) text-white",
};

/**
 * ドリッパーの番号（数字だけ。担当者の名前を広く出せるよう細くする）を、列の状態のインジケーターにしたもの（管制盤 A・C・D の列の見出し）。
 * 番号の地の色と札で状態（空き・待機・抽出中・まもなく・継続中・要確認）を、抽出中は残り、要確認は予定を過ぎた時間も（札の下に）出す。
 * そのドリッパーを待っている指名（未割当）があれば、角に「指名 2」（杯数）を付ける。
 * 押すと列の操作（担当者の交代・待機をまとめて移す）を開く（onOpenLane を渡したときだけ）
 */
export const DripperIndicator: React.FC<{
  bayId: number;
  status: LaneStatus;
  nominatedCups: number;
  onOpenLane?: (bayId: number) => void;
  className?: string;
}> = ({ bayId, status, nominatedCups, onOpenLane, className = "" }) => {
  const phase = status.forgotten ? FORGOTTEN : PHASES[status.phase];
  const showsRemaining = status.phase === "brewing" || status.phase === "soon";
  return (
    <button
      type="button"
      disabled={!onOpenLane}
      onClick={() => onOpenLane?.(bayId)}
      data-lane-phase={status.forgotten ? "forgotten" : status.phase}
      aria-label={`${dripperLabel(bayId)} ${phase.label}`}
      className={`relative flex shrink-0 touch-manipulation flex-col items-center justify-center rounded-lg border-2 pt-1.5 leading-none enabled:active:scale-95 ${phase.className} ${className}`}
    >
      <span className="font-black font-mono text-[24px]">{bayId}</span>
      <span className="mt-0.5 whitespace-nowrap font-black text-[10px] tracking-tighter">
        {phase.label}
      </span>
      {showsRemaining && (
        <span className="mt-0.5 font-black font-mono text-[12px] tabular-nums">
          {clockLabel(status.remainingSec)}
        </span>
      )}
      {status.forgotten && (
        <span className="mt-0.5 font-black font-mono text-[12px] tabular-nums">
          +{clockLabel(status.overSec)}
        </span>
      )}
      {nominatedCups > 0 && (
        <span
          title={`${dripperLabel(bayId)}への指名が ${nominatedCups} 杯、未割当で待っています`}
          className="-top-2.5 -translate-x-1/2 absolute left-1/2 z-10 whitespace-nowrap rounded-full border-2 border-white border-dashed bg-slate-900 px-1.5 py-0.5 font-black text-[11px] text-white leading-none shadow"
        >
          指名{nominatedCups}
        </span>
      )}
    </button>
  );
};

// 知らせのあとに添える文
const FIX_HINT = "違っていたら逆の操作（外す・移す）で直してください。";

// 確かめ・知らせの文（題・中身・進めるボタン（知らせは無し）・枠の色・読み上げの名前）
const toastText = (toast: OpenCornerToast) => {
  if (toast.kind === "next")
    return {
      label: `${dripperLabel(toast.bayId)}の抽出を終える確かめ`,
      title: `${dripperLabel(toast.bayId)} の ${orderLabel(toast.card)} を終えますか？`,
      body: `始めてからまだ ${clockLabel(toast.elapsedSec)} です。押す列を間違えていませんか？`,
      action: toast.start === "none" ? "終える" : "次へ進める",
      frame: "border-orange-600",
    };
  if (toast.kind === "lateMerge")
    return {
      label: `${orderLabel(toast.into)}への統合の知らせ`,
      title: `${orderLabel(toast.into)} は抽出を始めてから ${clockLabel(toast.elapsedSec)} たっています`,
      body: `${orderLabel(toast.card)} を統合しました。${FIX_HINT}`,
      action: null,
      frame: "border-(color:--caos-merge)",
    };
  const { cards, lane } = toast;
  const who = `上級生でない ${dripperLabel(lane.dripper)} ${lane.name}`;
  return {
    label:
      cards.length === 1
        ? `${orderLabel(cards[0])}の上級生のみの知らせ`
        : "上級生のみのカードの知らせ",
    title:
      cards.length === 1
        ? `上級生のみの ${orderLabel(cards[0])} を${who}に置きました`
        : `上級生のみのカード ${cards.length} 枚を${who}に移しました`,
    body: `カードに警告の印を付けています。${FIX_HINT}`,
    action: null,
    frame: "border-(color:--caos-senior-warning)",
  };
};

/**
 * 右上の確かめと知らせ（hooks/useCornerToasts）。押し間違いかもしれない、抽出中のカードを終える操作（カードの ✓。抽出時間の半分もたっていない）は
 * ［やめる（残りの秒）］［次へ進める］。
 * 抽出を始めてから時間のたったカード（@cafeore/common の caosLateMerge）へ統合したときは、統合したうえで「#005 は抽出を始めてから 2:10 たっています」と、
 * 上級生のみのカードを上級生でない担当者のドリッパーに置いたとき（@cafeore/common の nonSeniorPlacement）は置いたうえで
 * 「上級生のみの #012 を上級生でない 3rd 佐藤に置きました」と知らせるだけ（［閉じる（残りの秒）］。押さなくても消える）。
 * 画面を占めず、背景も暗くしないので、出ているあいだも盤面の操作（割当・ほかのカードの操作）はそのまま。
 * 種類によらず右上に新しいものから縦に並べる（置く場所は caos.css の .caos-corner-toasts。右のパネルを避ける）
 */
export const CornerToasts: React.FC<{
  toasts: readonly OpenCornerToast[];
  onDismiss: (id: string) => void;
  onConfirm: (id: string) => void;
}> = ({ toasts, onDismiss, onConfirm }) =>
  toasts.length > 0 && (
    <div
      data-caos-layer
      className="caos-corner-toasts pointer-events-none fixed top-[64px] z-[160] flex w-[400px] flex-col gap-2"
    >
      {toasts.map((toast) => {
        const { label, title, body, action, frame } = toastText(toast);
        return (
          <section
            key={toast.id}
            role={action ? "alertdialog" : "status"}
            aria-label={label}
            className={`fade-in-75 slide-in-from-right pointer-events-auto animate-in rounded-xl border-2 bg-white p-3 text-slate-950 shadow-2xl duration-200 ${frame}`}
          >
            <h2 className="font-black text-[16px]">{title}</h2>
            <p className="mt-1 font-bold text-[13px]">{body}</p>
            <div className="mt-2 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => onDismiss(toast.id)}
                className="h-11 touch-manipulation font-bold"
              >
                {action ? "やめる" : "閉じる"}（{toast.secondsLeft}）
              </Button>
              {action && (
                <Button
                  onClick={() => onConfirm(toast.id)}
                  className="h-11 touch-manipulation font-bold"
                >
                  {action}
                </Button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );

/** 空きスロット。未割当カードの選択中は直接割当し、未選択なら割当パネルを開く */
export const EmptySlotButton: React.FC<{
  onClick: () => void;
  className?: string;
  assigning?: boolean;
  disabled?: boolean;
}> = ({ onClick, className = "", assigning = false, disabled = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    data-unassigned-slot={assigning || undefined}
    title={
      disabled
        ? "指名のあるカードはこの担当者に割り当てられません"
        : assigning
          ? "選択中のコーヒーをこの担当者の列の最後に割り当て"
          : "タップして未割当オーダーをこのドリッパーに割り当て"
    }
    className={`flex touch-manipulation select-none items-center justify-center gap-1 rounded-lg border-2 border-dashed px-2 font-bold text-[12px] disabled:opacity-40 ${assigning && !disabled ? "border-emerald-600 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 active:bg-emerald-200" : "border-slate-300 bg-slate-50 text-slate-500 enabled:hover:border-blue-400 enabled:hover:text-blue-600 enabled:active:bg-blue-100/70"} ${className}`}
  >
    <Plus className="h-4 w-4 shrink-0" />
    {assigning ? "ここに割当" : "空きスロット"}
  </button>
);

/**
 * 長く待っている未割当のカードの札（「待ち 6分」。logic/alerts）。カードの children に置き、上の辺の左寄り（左上の角はコメントの印）に重ねる。
 * 提供の15分超過アイコンは未提供の一覧に表示する
 */
export const LongWaitTag: React.FC<{ card: CaosCard; nowMs: number }> = ({
  card,
  nowMs,
}) => {
  const minutes = longWaitMinutes(card, nowMs);
  return (
    minutes !== null && (
      <span
        title={`受けてから ${minutes} 分、未割当で待っています`}
        className="-top-2 border-(color:--caos-overtime-line) bg-(color:--caos-overtime) text-(color:--caos-overtime-text) pointer-events-none absolute left-5 z-20 flex items-center gap-0.5 whitespace-nowrap rounded-full border px-1.5 py-0.5 font-black text-[11px] leading-none shadow-xs"
      >
        <Clock3 className="h-3 w-3" />
        待ち {minutes}分
      </span>
    )
  );
};

/** ドリッパーに置いたカードの場所の札（「3rd 2番目」）。カードを包む relative の枠の右上に重ねる（管制盤 D の表） */
export const PlaceTag: React.FC<{ label?: string }> = ({ label }) =>
  label && (
    <span className="-top-2 absolute right-1 z-20 whitespace-nowrap rounded-full bg-slate-900 px-1.5 py-0.5 font-black font-mono text-[11px] text-white leading-none shadow-xs">
      {label}
    </span>
  );

/**
 * テストの盤面を出しているあいだ（実データテスト中・終えたあと）、盤面の上に出し続ける帯。「本番に戻る」で cafeore-pos の注文の盤面に戻る。
 * 練習の時計（一時停止・速さ）もここに置く（ヘッダーの並びを詰めない）
 */
export const TestBoardBanner: React.FC<{
  onBackToLive: () => void;
  isRunning: boolean;
  onTogglePlay: () => void;
  simSpeed: number;
  onCycleSpeed: () => void;
}> = ({ onBackToLive, isRunning, onTogglePlay, simSpeed, onCycleSpeed }) => (
  <div className="flex items-center gap-2 rounded-md border-2 border-amber-500 bg-amber-100 px-3 py-1.5 font-black text-amber-950">
    <span className="mr-auto">
      テストの盤面です（本番の注文は出ていません）
    </span>
    <button
      type="button"
      onClick={onTogglePlay}
      title={isRunning ? "一時停止" : "タイマー再開"}
      className="flex h-10 w-10 touch-manipulation items-center justify-center rounded-lg border border-amber-500 bg-white text-amber-950"
    >
      {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
    </button>
    <button
      type="button"
      onClick={onCycleSpeed}
      title="シミュレーション速度切替"
      className="h-10 min-w-12 touch-manipulation rounded-lg border border-amber-500 bg-white px-1.5 font-bold font-mono text-[13px] text-amber-950"
    >
      {simSpeed}x
    </button>
    <button
      type="button"
      onClick={onBackToLive}
      className="min-h-[40px] touch-manipulation rounded-lg bg-amber-600 px-3 text-sm text-white hover:bg-amber-700"
    >
      本番に戻る
    </button>
  </div>
);
