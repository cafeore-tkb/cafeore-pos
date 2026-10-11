import { readableTextColor } from "@cafeore/common";
import { Check } from "lucide-react";
import type React from "react";
import { type DripCard, orderLabel } from "../logic/cards";
import { laneOrdinal, moveTargets } from "../logic/lanes";

// カード（1 回のドリップ）。管制盤 A・C・D の未割当とドリッパーのカード、割当・詳細のパネルで共通。
// 置き場所ごとの違いは、文字の大きさ（size）と、終わり（done）・選択中（selected）・添え書き（note）だけ。
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

// 色。入れ直しは赤、指名のカードは紫、終わったカードは薄い灰色。それ以外は色の設定の色（color。画面 master）で塗り、
// 色の無いカードは白。文字色は背景色から決める（POS と共通の readableTextColor）。商品の種類や名前で色を決め打ちしない。
const surfaceOf = (card: DripCard, done: boolean) => {
  if (card.isRebrew)
    return {
      className: `border-red-300 bg-red-50 text-slate-900 ${done ? "opacity-55" : ""}`,
    };
  if (done)
    return {
      className: "border-slate-200 bg-slate-100 text-slate-500 opacity-50",
    };
  if (card.preferredBaristaId)
    return { className: "border-violet-300 bg-violet-50 text-slate-900" };
  const backgroundColor = card.color ?? "#ffffff";
  return {
    className: "border-slate-300",
    style: { backgroundColor, color: readableTextColor(backgroundColor) },
  };
};

// 注文番号の色。入れ直しは赤、指名は紫、分けた注文は濃く、1 枚だけの注文は少し薄く
const orderNoClass = (card: DripCard) => {
  if (card.isRebrew) return "text-red-700";
  if (card.preferredBaristaId) return "text-violet-700";
  return card.totalItemsInOrder > 1 ? "" : "opacity-75";
};

// 杯数の札。1 杯は白抜き、2 杯は塗り（指名のカードは紫）
const cupsClass = (card: DripCard) => {
  const tone = card.preferredBaristaId
    ? {
        border: "border-violet-700",
        fill: "bg-violet-700",
        ink: "text-violet-700",
      }
    : { border: "border-slate-950", fill: "bg-slate-950", ink: "text-black" };
  return card.cupCount === 1
    ? `${tone.border} bg-white ${tone.ink}`
    : `${tone.border} ${tone.fill} text-white`;
};

export const OrderCard: React.FC<
  React.HTMLAttributes<HTMLDivElement> & {
    card: DripCard;
    size?: keyof typeof SIZES;
    done?: boolean;
    /** 入れ直しのために止めた */
    interrupted?: boolean;
    /** 抽出中（入れ直しの札を「入れ直し中」にする） */
    brewing?: boolean;
    selected?: boolean;
    /** ドラッグで運んでいるカード（中身だけ薄く。上に重ねた 1〜6 のボタンはそのまま） */
    dragging?: boolean;
    note?: string;
  }
> = ({
  card,
  size = "md",
  done = false,
  interrupted = false,
  brewing = false,
  selected = false,
  dragging = false,
  note,
  className = "",
  style,
  children,
  ...props
}) => {
  const text = SIZES[size];
  const surface = surfaceOf(card, done);
  const fade = dragging ? "opacity-30" : "";
  // 豆と区分の札（「ケニア豆 / ホット」）。豆は在庫対象の名前、区分は商品の種類の表示名をそのまま出す。
  // 豆の無い（在庫の設定に「商品 → 豆」が無い）カードは区分だけ。狭いカードでは後ろが切れるので豆を先にする
  const beans = card.beans?.map((bean) => bean.name).join("・");
  const badge = [beans, card.typeName].filter(Boolean).join(" / ");
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
        <span
          className={`shrink-0 font-black font-mono leading-none tracking-tight ${text.no} ${orderNoClass(card)}`}
        >
          {orderLabel(card)}
        </span>
        <span
          className={`shrink-0 whitespace-nowrap rounded-md border font-black font-mono leading-none ${text.cups} ${cupsClass(card)}`}
        >
          {card.cupCount}杯
        </span>
        {card.preferredBaristaId && (
          <span className="min-w-0 truncate rounded bg-violet-700 px-1.5 py-0.5 font-black text-[11px] text-white">
            指名:{laneOrdinal(card.preferredBaristaId)}
          </span>
        )}
        {card.isRebrew && (
          <span className="min-w-0 truncate rounded bg-red-600 px-1.5 py-0.5 font-black text-[10px] text-white">
            {brewing ? "入れ直し中" : "入れ直し"}
          </span>
        )}
        {interrupted ? (
          <span className="ml-auto min-w-0 truncate rounded border border-red-300 bg-red-50 px-1.5 py-0.5 font-black text-[10px] text-red-700">
            中断
          </span>
        ) : (
          done && (
            <Check className="ml-auto h-4 w-4 shrink-0 text-emerald-700">
              <title>完了</title>
            </Check>
          )
        )}
      </div>
      <div
        className={`mt-1 flex min-w-0 items-center gap-1 overflow-hidden ${fade}`}
      >
        <span
          className={`max-w-[65%] shrink-0 truncate font-bold leading-tight tracking-tight ${text.name}`}
          title={card.beanName}
        >
          {card.beanName}
        </span>
        {badge && (
          <span
            title={`豆：${beans || "なし"}　区分：${card.typeName ?? "なし"}`}
            className="min-w-0 shrink truncate rounded bg-black/10 px-1.5 py-0.5 font-bold text-[10px] leading-none"
          >
            {badge}
          </span>
        )}
        {card.totalItemsInOrder > 1 && (
          <span className="ml-auto shrink-0 whitespace-nowrap rounded bg-slate-200 px-1.5 py-0.5 font-black font-mono text-[10px] text-slate-700">
            {card.itemIndex}/{card.totalItemsInOrder}・計{card.totalOrderCups}杯
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

// 1〜6 のボタンの色（ドラッグで指の下は青、指名のドリッパーは紫）
const padTone = (bayId: number, hoveredBay: number | null, card: DripCard) => {
  if (hoveredBay === bayId) return "border-white bg-blue-500 text-white";
  if (card.preferredBaristaId === bayId)
    return "border-violet-300 bg-violet-600 text-white";
  return "border-slate-300 bg-white text-slate-950";
};

// カードの上に前半（1〜3）、下に後半（4〜6）を出すドリッパーのボタン（カードの children に置く）。
// 未割当カード（管制盤 A・C）と待機カード（管制盤 A）で共通。待機カードは今のドリッパーのボタンが押せない。
// 指名のあるカードは指名のドリッパーだけ押せる。ドラッグで指を滑らせて選べるよう、ボタンは data-bay-target を持つ（useCardDrag の bayTargetAt）。
export const BayPad: React.FC<{
  card: DripCard;
  /** 待機カードの今のドリッパー */
  currentBayId?: number;
  /** ドラッグで指の下にあるドリッパー */
  hoveredBay: number | null;
  onPick: (bayId: number) => void;
}> = ({ card, currentBayId, hoveredBay, onPick }) => {
  const targets = moveTargets(card, currentBayId ?? null);
  const half = Math.ceil(targets.length / 2);
  return [targets.slice(0, half), targets.slice(half)].map((row, index) => (
    <div
      key={row[0].bayId}
      className={`${index === 0 ? "-top-[38px]" : "-bottom-[38px]"} absolute right-0 left-0 z-[90] grid h-[34px] grid-cols-3 gap-1 rounded-lg bg-slate-950 p-1 shadow-xl`}
    >
      {row.map(({ bayId, disabled }) => (
        <button
          key={bayId}
          type="button"
          data-bay-target={bayId}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onPick(bayId);
          }}
          className={`h-full touch-none rounded-md border font-black font-mono text-[17px] transition-colors disabled:border-slate-700 disabled:bg-slate-700 disabled:text-slate-500 ${padTone(bayId, hoveredBay, card)}`}
        >
          {bayId}
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
