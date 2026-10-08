import { type CaosCard, readableTextColor } from "@cafeore/common";
import { Check } from "lucide-react";
import type React from "react";
import {
  type CardLook,
  cardName,
  cardTypeName,
  orderLabel,
} from "../logic/cards";
import { moveTargets } from "../logic/lanes";

// カード（1 回のドリップ）。管制盤 A・C・D の未割当とドリッパーのカード、割当・詳細のパネルで共通。
// 置き場所ごとの違いは、文字の大きさ（size）と、選択中（selected）・添え書き（note）だけ（終わりはカードの状態で薄くする）。
// 大きさ・枠・操作（クリック・ドラッグ）は className と div の props で渡し、上に重ねるもの（1〜6 のボタンなど）は children。

const SIZES = {
  // 管制盤 C・D と割当のパネル
  sm: {
    pad: "px-1.5 py-1",
    no: "text-[16px]",
    cups: "px-1 py-0.5 text-[10px]",
    name: "text-[12px]",
  },
  // 管制盤 A のタイムライン
  md: {
    pad: "px-2 py-1.5",
    no: "text-[22px]",
    cups: "py-1 px-2 text-[15px]",
    name: "text-[14px]",
  },
  // 管制盤 A の未割当
  lg: {
    pad: "px-2 py-1",
    no: "text-[25px]",
    cups: "py-1 px-2.5 text-[17px]",
    name: "text-[15px]",
  },
  // 管制盤 C の未割当・詳細のパネル
  xl: {
    pad: "p-4",
    no: "text-[32px]",
    cups: "py-1 px-2.5 text-[20px]",
    name: "text-[18px]",
  },
};

// 色。終わったカードは薄い灰色。それ以外は色の設定の色（look.color。画面 master）で塗り、色の無いカードは白。
// 文字色は背景色から決める（POS と共通の readableTextColor）。商品の種類や名前で色を決め打ちしない。
const surfaceOf = (done: boolean, color: string | undefined) => {
  if (done)
    return {
      className: "border-slate-200 bg-slate-100 text-slate-500 opacity-50",
    };
  const backgroundColor = color ?? "#ffffff";
  return {
    className: "border-slate-300",
    style: { backgroundColor, color: readableTextColor(backgroundColor) },
  };
};

// 杯数の札。1 杯は白抜き、2 杯は塗り
const cupsClass = (cups: number) =>
  cups === 1
    ? "border-slate-950 bg-white text-black"
    : "border-slate-950 bg-slate-950 text-white";

export const OrderCard: React.FC<
  React.HTMLAttributes<HTMLDivElement> & {
    /** 注文のカップから組み立てたカード（@cafeore/common の buildCaosCards） */
    card: CaosCard;
    /** 色と、分けた注文の中の位置（logic/cards.ts の cardLooks） */
    look?: CardLook;
    size?: keyof typeof SIZES;
    selected?: boolean;
    /** ドラッグで運んでいるカード（中身だけ薄く。上に重ねた 1〜6 のボタンはそのまま） */
    dragging?: boolean;
    note?: string;
  }
> = ({
  card,
  look,
  size = "md",
  selected = false,
  dragging = false,
  note,
  className = "",
  style,
  children,
  ...props
}) => {
  const text = SIZES[size];
  const done = card.status === "done";
  const surface = surfaceOf(done, look?.color);
  const fade = dragging ? "opacity-30" : "";
  const name = cardName(card);
  const typeName = cardTypeName(card);
  const split = look?.split;
  return (
    <div
      {...props}
      style={{ ...surface.style, ...style }}
      className={`relative flex min-w-0 select-none flex-col justify-center rounded-lg border-2 transition-[box-shadow,border-color] ${text.pad} ${surface.className} ${selected ? "z-10 border-amber-500 shadow-lg ring-4 ring-amber-400" : "shadow-xs"} ${className}`}
    >
      {children}
      <div
        className={`flex min-w-0 items-center gap-1 overflow-hidden ${fade}`}
      >
        {/* 注文番号。分けた注文は濃く、1 枚だけの注文は少し薄く */}
        <span
          className={`shrink-0 font-black font-mono leading-none tracking-tight ${text.no} ${split ? "" : "opacity-75"}`}
        >
          {orderLabel(card)}
        </span>
        <span
          className={`shrink-0 whitespace-nowrap rounded-md border font-black font-mono leading-none ${text.cups} ${cupsClass(card.cups.length)}`}
        >
          {card.cups.length}杯
        </span>
        {done && (
          <Check className="ml-auto h-4 w-4 shrink-0 text-emerald-700">
            <title>完了</title>
          </Check>
        )}
      </div>
      <div
        className={`mt-1 flex min-w-0 items-center gap-1 overflow-hidden ${fade}`}
      >
        <span
          className={`max-w-[65%] shrink-0 truncate font-bold leading-tight tracking-tight ${text.name}`}
          title={name}
        >
          {name}
        </span>
        {/* 区分は商品の種類の表示名をそのまま出す */}
        {typeName && (
          <span
            title={`区分：${typeName}`}
            className="min-w-0 shrink truncate rounded bg-black/10 px-1.5 py-0.5 font-bold text-[10px] leading-none"
          >
            {typeName}
          </span>
        )}
        {split && (
          <span className="ml-auto shrink-0 whitespace-nowrap rounded bg-slate-200 px-1.5 py-0.5 font-black font-mono text-[10px] text-slate-700">
            {split.index}/{split.total}・計{split.cups}杯
          </span>
        )}
      </div>
      {note && (
        <div
          className={`mt-0.5 truncate font-bold text-[10px] leading-tight ${dragging ? "opacity-30" : "opacity-80"}`}
        >
          {note}
        </div>
      )}
    </div>
  );
};

// 1〜6 のボタンの色（ドラッグで指の下は青）
const padTone = (bayId: number, hoveredBay: number | null) =>
  hoveredBay === bayId
    ? "border-white bg-blue-500 text-white"
    : "border-slate-300 bg-white text-slate-950";

// カードの上に前半（1〜3）、下に後半（4〜6）を出すドリッパーのボタン（カードの children に置く）。
// 未割当カード（管制盤 A・C）と待機カード（管制盤 A）で共通。待機カードは今のドリッパーのボタンが「先頭」（このドリッパーの待機の先頭へ）。
// ドラッグで指を滑らせて選べるよう、ボタンは data-bay-target を持つ（useCardDrag の bayTargetAt）。
export const BayPad: React.FC<{
  /** 待機カードの今のドリッパー */
  currentBayId?: number;
  /** ドラッグで指の下にあるドリッパー */
  hoveredBay: number | null;
  /** toFront は「先頭」（今のドリッパーの待機の先頭へ） */
  onPick: (bayId: number, toFront: boolean) => void;
}> = ({ currentBayId, hoveredBay, onPick }) => {
  const targets = moveTargets(currentBayId ?? null);
  const half = Math.ceil(targets.length / 2);
  return [targets.slice(0, half), targets.slice(half)].map((row, index) => (
    <div
      key={row[0].bayId}
      className={`${index === 0 ? "-top-[38px]" : "-bottom-[38px]"} absolute right-0 left-0 z-[90] grid h-[34px] grid-cols-3 gap-1 rounded-lg bg-slate-950 p-1 shadow-xl`}
    >
      {row.map(({ bayId, toFront }) => (
        <button
          key={bayId}
          type="button"
          data-bay-target={bayId}
          onClick={(event) => {
            event.stopPropagation();
            onPick(bayId, toFront);
          }}
          className={`h-full touch-none rounded-md border font-black font-mono text-[17px] transition-colors ${padTone(bayId, hoveredBay)}`}
        >
          {toFront ? "先頭" : bayId}
        </button>
      ))}
    </div>
  ));
};

// 統合できる相手のカードに重ねる「統合する」（管制盤 A・D の未割当）
export const MergeOverlay: React.FC = () => (
  <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md border-2 border-blue-500 bg-blue-50/90 p-1">
    <span className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 font-black text-[16px] text-white shadow-md">
      <svg
        className="h-5 w-7 shrink-0"
        viewBox="0 0 25.04 19.03"
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M3.04,12.26c-.63-.55-1.04-1.35-1.04-2.26V2h12v1h0,0v.03h2v-1.03c0-1.1-.9-2-2-2H2C.9,0,0,.9,0,2v8c0,2.07,1.27,3.86,3.07,4.61-.02-.19-.03-.39-.03-.58v-1.77Z"
        />
        <path
          fill="currentColor"
          d="M20.04,4.03H6.04c-1.1,0-2,.9-2,2v8c0,.3.04.6.09.88.07.37.16.72.3,1.06.76,1.79,2.54,3.06,4.61,3.06h6c2.76,0,5-2.24,5-5,2.76,0,5-2.24,5-5s-2.24-5-5-5ZM18.04,14.03c0,1.65-1.35,3-3,3h-6c-.9,0-1.69-.4-2.24-1.03-.26-.29-.45-.63-.58-1-.11-.31-.18-.63-.18-.97V6.03h12v8ZM20.04,12.03v-6c1.65,0,3,1.35,3,3s-1.35,3-3,3Z"
        />
        <path
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M9.15,11.51h5.76M12.03,8.51v5.76"
        />
      </svg>
      統合する
    </span>
  </div>
);
