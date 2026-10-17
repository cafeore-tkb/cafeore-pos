import {
  type CaosCard,
  type CaosDeliverable,
  type CaosDeliveredOrder,
  caosDeliverables,
  caosUnstartedHead,
  deliverCaosDrip,
  dripperLabel,
  jstClock,
  readableTextColor,
  useColorSettings,
} from "@cafeore/common";
import { Check, ChevronRight, Coffee, Hourglass } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import { LaneName } from "./components/LaneParts";
import { PosStatusBadge } from "./components/TopHeader";
import { useLiveBoard } from "./hooks/useLiveBoard";
import { cardColor, cardItemName, orderLabel } from "./logic/cards";
import { type DeliverTone, deliverNotices, deliverTone } from "./logic/deliver";
import { clockLabel } from "./logic/format";
import { type Lane, boardLanes } from "./logic/lanes";

// ドリップ完了の報告（/master-sheet/deliver）。提供に置いた端末で、ドリッパーが淹れたカップを持って行ったときに押す。
// cafeore-pos の盤面（useLiveBoard）を読み、ドリッパーごとに報告できるカード（@cafeore/common の caosDeliverables：
// 抽出中と、マスターが ✓ で先に終えた直前のカード）を出す。カードを押して確かめたら POST /api/caos/drippers/{dripper}/deliver を送る。
// サーバーは抽出を終え（待機の先頭は始めない。始めるのはマスターの ▶）、注文のカップがそろえば呼び出す。
// 送ったあとは、注文ごとに呼び出したか・提供で仕上げるかを大きく知らせる（logic/deliver.ts）。
// CaOS の操作と違い、端末に残して送り直さない（通らなければ理由を出し、その場でもう一度押してもらう）。

/** 確かめの表示を閉じるまで（CaOS の「次へ」の確かめと同じ 8 秒） */
const CONFIRM_MS = 8000;
/** 報告の結果を出しておく長さ */
const NOTICE_MS = 6000;

type Picked = { dripper: number; card: CaosCard };
type Notice = { id: number; orders: CaosDeliveredOrder[] };

export default function DeliverBoard() {
  const nowMs = useCurrentTime(1000).getTime();
  const { cards, status } = useLiveBoard({ enabled: true, nowMs });
  const { colorSettings } = useColorSettings();
  const lanes = useMemo(() => boardLanes(cards), [cards]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // 確かめは 8 秒で閉じる（やめる扱い）。報告の結果も数秒で消す
  useEffect(() => {
    if (!picked) return;
    const timer = setTimeout(() => setPicked(null), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [picked]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // 確かめている間にカードがほかの端末で動いたら（マスターが外した・ほかのドリッパーへ移したなど）閉じる
  const stillThere =
    picked !== null &&
    lanes.some(
      (lane) =>
        lane.id === picked.dripper &&
        caosDeliverables(lane, nowMs).some(
          ({ card, locked }) => card.key === picked.card.key && !locked,
        ),
    );
  useEffect(() => {
    if (picked && !stillThere && !sending) setPicked(null);
  }, [picked, stillThere, sending]);

  const report = async ({ dripper, card }: Picked) => {
    if (sending || !card.dripId) return;
    setSending(true);
    const result = await deliverCaosDrip(dripper, card.dripId);
    setSending(false);
    setPicked(null);
    if (result.error !== undefined) {
      toast.error(result.error);
      return;
    }
    setNotice({ id: Date.now(), orders: result.data.orders });
  };

  return (
    <div className="flex h-dvh w-screen select-none flex-col gap-2 overflow-hidden bg-[#f0f4fa] p-2 font-sans text-[#0f172a]">
      <header className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <span className="rounded-lg bg-slate-900 px-2.5 py-1.5 font-black text-sm text-white">
          CaOS
        </span>
        <h1 className="font-black text-xl">ドリップ完了の報告</h1>
        <p className="order-last min-w-0 basis-full font-bold text-slate-600 text-sm sm:order-none sm:flex-1 sm:basis-auto">
          カップを提供に置いたら、自分のドリッパーのカードを押してください
        </p>
        <span className="font-black font-mono text-3xl tabular-nums">
          {jstClock(nowMs)}
        </span>
        <PosStatusBadge status={status} />
      </header>
      {/* iPad の横置きでは 3 列 2 段に収め、狭い画面では列ごとに高さを持たせて盤面だけをスクロールする */}
      <div className="grid min-h-0 flex-1 auto-rows-[minmax(16rem,1fr)] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3 lg:grid-rows-2">
        {lanes.map((lane) => (
          <LanePanel
            key={lane.id}
            lane={lane}
            nowMs={nowMs}
            colorOf={(card) => cardColor(card, colorSettings)}
            disabled={sending}
            onPick={(card) => setPicked({ dripper: lane.id, card })}
          />
        ))}
      </div>
      {picked && stillThere && (
        <ConfirmDeliver
          pick={picked}
          color={cardColor(picked.card, colorSettings)}
          sending={sending}
          onConfirm={() => report(picked)}
          onCancel={() => setPicked(null)}
        />
      )}
      {notice && (
        <DeliverNotice
          key={notice.id}
          orders={notice.orders}
          onClose={() => setNotice(null)}
        />
      )}
    </div>
  );
}

// 1 つのドリッパー。番号・担当者と、報告できるカード（淹れた順）。無ければ、まだ始まっていない待機の先頭を知らせる
const LanePanel: React.FC<{
  lane: Lane;
  nowMs: number;
  colorOf: (card: CaosCard) => string | undefined;
  disabled: boolean;
  onPick: (card: CaosCard) => void;
}> = ({ lane, nowMs, colorOf, disabled, onPick }) => {
  const deliverables = caosDeliverables(lane, nowMs);
  const unstarted = caosUnstartedHead(lane);
  return (
    <section
      data-deliver-dripper={lane.id}
      aria-label={dripperLabel(lane.id)}
      className={`flex min-h-0 flex-col gap-2 rounded-xl border-4 p-2 ${deliverables.length > 0 ? "border-slate-300 bg-white" : "border-transparent bg-slate-200/50 text-slate-400"}`}
    >
      <div className="flex min-w-0 items-center gap-2 leading-tight">
        <span
          title={dripperLabel(lane.id)}
          className="shrink-0 rounded-lg border-4 border-current px-2 font-black font-mono text-3xl leading-none"
        >
          {lane.id}
        </span>
        <LaneName dripper={lane.id} className="font-black text-2xl" />
      </div>
      {deliverables.map((deliverable) => (
        <DeliverButton
          key={deliverable.card.key}
          deliverable={deliverable}
          nowMs={nowMs}
          color={colorOf(deliverable.card)}
          disabled={disabled}
          onPick={() => onPick(deliverable.card)}
        />
      ))}
      {deliverables.length === 0 && (
        <p className="flex flex-1 items-center justify-center text-center font-bold text-lg">
          {unstarted
            ? `${orderLabel(unstarted)} はまだ始まっていません（マスターに伝えてください）`
            : "報告するカードはありません"}
        </p>
      )}
    </section>
  );
};

// 報告できるカード。注文番号と杯数をいちばん大きく出す（カップのシールの番号と見比べる）
const DeliverButton: React.FC<{
  deliverable: CaosDeliverable;
  nowMs: number;
  color: string | undefined;
  disabled: boolean;
  onPick: () => void;
}> = ({
  deliverable: { card, brewing, locked },
  nowMs,
  color,
  disabled,
  onPick,
}) => {
  const backgroundColor = color ?? "#ffffff";
  const elapsedSec = card.startedAt
    ? (nowMs - card.startedAt.getTime()) / 1000
    : 0;
  return (
    <button
      type="button"
      data-deliver-card={card.key}
      disabled={disabled || locked}
      onClick={onPick}
      style={{ backgroundColor, color: readableTextColor(backgroundColor) }}
      className="flex min-h-0 flex-1 touch-manipulation flex-col justify-center gap-2 rounded-xl border-2 border-slate-400 p-3 text-left shadow-sm active:scale-[0.98] disabled:opacity-50"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate font-black font-mono text-5xl leading-none">
          {orderLabel(card)}
        </span>
        <span className="shrink-0 font-black text-3xl">
          {card.cups.length}杯
        </span>
      </span>
      <span className="truncate font-black text-2xl">{cardItemName(card)}</span>
      <span className="flex flex-wrap items-center justify-between gap-2 text-base">
        <span className="flex items-center gap-1 rounded-lg bg-white/80 px-2 py-0.5 font-bold text-slate-900">
          {brewing ? (
            <>
              <Hourglass className="h-4 w-4" />
              {locked ? "始めたばかり" : `抽出中 ${clockLabel(elapsedSec)}`}
            </>
          ) : (
            <>
              <Check className="h-4 w-4" />
              抽出済み
            </>
          )}
        </span>
        {!locked && (
          <span className="flex items-center gap-0.5 rounded-lg bg-slate-900 px-2 py-0.5 font-black text-white">
            届けたら押す
            <ChevronRight className="h-4 w-4" />
          </span>
        )}
      </span>
    </button>
  );
};

// 押したカードを届けたか確かめる。押し間違えると、ほかの人の抽出を終えたり、まだのカップで呼び出したりするので
const ConfirmDeliver: React.FC<{
  pick: Picked;
  color: string | undefined;
  sending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ pick: { dripper, card }, color, sending, onConfirm, onCancel }) => {
  const backgroundColor = color ?? "#ffffff";
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4">
      <div
        role="alertdialog"
        aria-label="ドリップ完了の報告"
        className="flex w-full max-w-xl flex-col gap-4 rounded-2xl bg-white p-6 shadow-xl"
      >
        <p className="font-bold text-slate-600 text-xl">
          {dripperLabel(dripper)}
          <LaneName dripper={dripper} className="ml-2" />
        </p>
        <div
          style={{ backgroundColor, color: readableTextColor(backgroundColor) }}
          className="flex items-baseline justify-between gap-3 rounded-xl border-2 border-slate-400 p-4"
        >
          <span className="font-black font-mono text-6xl">
            {orderLabel(card)}
          </span>
          <span className="font-black text-3xl">
            {cardItemName(card)} {card.cups.length}杯
          </span>
        </div>
        <p className="font-black text-2xl">このカップを提供に届けましたか？</p>
        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <button
            type="button"
            disabled={sending}
            onClick={onConfirm}
            className="flex touch-manipulation items-center justify-center gap-2 rounded-xl bg-theme-primary px-4 py-5 font-black text-2xl text-white disabled:opacity-60"
          >
            <Coffee className="h-7 w-7" />
            {sending ? "送信中…" : "届けた"}
          </button>
          <button
            type="button"
            disabled={sending}
            onClick={onCancel}
            className="touch-manipulation rounded-xl border-2 border-slate-300 bg-white px-4 py-5 font-bold text-slate-700 text-xl disabled:opacity-60"
          >
            やめる
          </button>
        </div>
      </div>
    </div>
  );
};

const TONE_LOOK: Record<DeliverTone, string> = {
  good: "border-green-600 bg-green-50 text-green-900",
  ask: "border-amber-500 bg-amber-50 text-amber-950",
  info: "border-slate-400 bg-white text-slate-800",
};

// 報告の結果。注文ごとに、呼び出したか・提供で仕上げるかなど。押すと閉じる
const DeliverNotice: React.FC<{
  orders: CaosDeliveredOrder[];
  onClose: () => void;
}> = ({ orders, onClose }) => {
  const notices = deliverNotices(orders);
  return (
    <button
      type="button"
      onClick={onClose}
      aria-live="polite"
      className={`fade-in slide-in-from-top-4 fixed inset-x-4 top-4 z-50 mx-auto flex max-w-2xl animate-in flex-col gap-2 rounded-2xl border-4 p-5 text-left shadow-xl ${TONE_LOOK[deliverTone(notices)]}`}
    >
      {notices.map((notice) => (
        <span key={notice.key} className="flex flex-col">
          <span className="font-black text-3xl">
            <span className="font-mono">{notice.label}</span>
            {notice.text}
          </span>
          <span className="font-bold text-lg opacity-80">{notice.hint}</span>
        </span>
      ))}
    </button>
  );
};
