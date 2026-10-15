import { type CaosCard, readableTextColor } from "@cafeore/common";
import { Check, Star, TriangleAlert } from "lucide-react";
import type React from "react";
import { Fragment } from "react";
import { TwoStepButton } from "~/components/molecules/TwoStepButton";
import { useBayPadPlacement } from "../hooks/useBayPadPlacement";
import {
  type CardLook,
  cardItemName,
  cardNominee,
  cardOrderNos,
  cardOrderParts,
  emergencyReasons,
  orderLabel,
  orderNoLabel,
} from "../logic/cards";
import { type DropSide, moveTargets } from "../logic/lanes";
import { CommentMark } from "./OrderComments";

// カード（1 回のドリップ）。管制盤 A・C・D の未割当とドリッパーのカード、割当・詳細のパネルで共通。
// いちばん大きく「何番が何杯か」（注文番号を左上、杯数はいつもカードの右上）、商品の略称を次の行に小さく出す
// （どの注文から割り当てるか・何番を入れているかを番号で合わせる。1 杯のカードは統合の判断に商品が要るので、2 行目でも読める大きさにする）。
// 置き場所ごとの違いは、文字の大きさ（size）と、選択中（selected）・添え書き（note）・統合する相手（mergeInto）・注文ごとの段（byOrder）だけ（終わりはカードの状態で薄くする）。
// 統合したカード（2 つ以上の注文が入った）は、後ろにもう 1 枚ずらして重ねた枠で見せる（管制盤 A・C）。
// 管制盤 D（byOrder）は重ねず、入っている注文ごとの段（注文番号・コメントの印・緊急の理由・杯数）に分ける（表では元の注文の行にまたがって縦に長い）。
// 大きさ・枠・操作（クリック・ドラッグ）は className と div の props で渡し、上に重ねるもの（1〜6 のボタンなど）は children。
//
// 色の役目を分ける：地の色は商品の色（色の設定。look.color）だけに使い、意味（指名・選択中）は地の色に頼らず、
// 枠の形・札の文字で出す（指名は黒い点線の枠と「指名 2nd」、選択中は外側の黄の輪だけ（札は付けない）。同じ注文は、選ぶとどこにあっても選択中になる。
// 入れ直しは赤い「緊急」の札と理由）。
// 商品の色が意味の色と近くても見分けられる。

// no は 1 行目の注文番号（D の統合したカードは 1 行目の商品と、段の注文番号）、item は 2 行目の商品の略称、meta は 2 行目の札（指名・上級生・豆など）。
// emergencyBelow は緊急の札を 2 行目の先頭に出す（幅の狭いカード。1 行目の番号・杯数を押し出さない）
const SM = {
  pad: "px-1.5 py-1",
  no: "text-[14px]",
  cups: "px-0.5 text-[13px]",
  meta: "text-[11px]",
  item: "text-[12px]",
  emergencyBelow: true,
};
const SIZES = {
  // 管制盤 C・D と割当のパネル
  sm: SM,
  // 管制盤 C のドリッパーの列（カードの高さのまま番号を大きく）
  lane: {
    ...SM,
    no: "text-[17px]",
    item: "text-[14px]",
    emergencyBelow: false,
  },
  // 管制盤 A の未割当。注文番号・杯数を遠目でも拾え、商品名も読み取りやすい大きさ
  queue: {
    pad: "px-2.5 py-1.5",
    no: "text-[21px]",
    cups: "px-1.5 text-[18px]",
    meta: "text-[15px]",
    emergencyBelow: false,
    item: "text-[15px]",
  },
  // 管制盤 A のタイムライン
  md: {
    pad: "px-2 py-1",
    no: "text-[19px]",
    cups: "px-1.5 text-[17px]",
    meta: "text-[12px]",
    emergencyBelow: false,
    item: "text-[15px]",
  },
  // 詳細のパネル
  xl: {
    pad: "p-4",
    no: "text-[26px]",
    cups: "px-2 text-[22px]",
    meta: "text-[15px]",
    emergencyBelow: false,
    item: "text-[18px]",
  },
};

// 地と枠。終わったカードは薄い灰色（選んだ注文でなければ全体も薄くする。薄くすると選択中の黄の輪も薄くなる）。それ以外は色の設定の色（look.color。画面 master・指名は nominated）で塗り、色の無いカードは白。
// 文字色は背景色から決める（POS と共通の readableTextColor）。商品の種類や名前で色を決め打ちしない。
// 指名のカードは黒い点線の太い枠（地の色が近くても枠の形で分かる）
const surfaceOf = (
  done: boolean,
  nominated: boolean,
  selected: boolean,
  color?: string,
) => {
  if (done)
    return {
      className: `border-2 border-slate-200 bg-slate-100 text-slate-500 ${selected ? "" : "opacity-50"}`,
    };
  const backgroundColor = color ?? "#ffffff";
  // 地の色は --caos-card-bg に入れ、統合したカードの後ろの 1 枚（shadowOf）にも同じ色を使う
  return {
    className: `bg-(color:--caos-card-bg) ${nominated ? "border-[3px] border-slate-900 border-dashed" : "border-2 border-slate-300"}`,
    style: {
      "--caos-card-bg": backgroundColor,
      color: readableTextColor(backgroundColor),
    } as React.CSSProperties,
  };
};

// 影。統合したカードは、右下にずらしたもう 1 枚（カードの地の色と枠の線）を影で描く（終わったカードは灰色の地）。
// 選択中は黄の輪（外へ 6px）の外に出るよう 8px ずらす（並べる枠はカードの外に 8px 空ける）
const shadowOf = (merged: boolean, selected: boolean) => {
  if (!merged) return selected ? "shadow-lg" : "shadow-xs";
  return selected
    ? "shadow-[8px_8px_0_-2px_var(--caos-card-bg,var(--color-slate-100)),8px_8px_0_0_var(--caos-card-stack-line)]"
    : "shadow-[5px_5px_0_-2px_var(--caos-card-bg,var(--color-slate-100)),5px_5px_0_0_var(--caos-card-stack-line)]";
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
    /** 色と豆（logic/cards.ts の cardLooks） */
    look?: CardLook;
    size?: keyof typeof SIZES;
    selected?: boolean;
    /** ドラッグで運んでいるカード（中身だけ薄く。上に重ねた 1〜6 のボタンはそのまま） */
    dragging?: boolean;
    note?: string;
    /** 開いたカードをもう一度押すと統合する相手。統合の印とその注文番号（「#012」）を出す */
    mergeInto?: CaosCard;
    /** 統合したカードを、重ねた枠でなく注文ごとの段に分けて出す（管制盤 D） */
    byOrder?: boolean;
  }
> = ({
  card,
  look,
  size = "md",
  selected = false,
  dragging = false,
  note,
  mergeInto,
  byOrder = false,
  className = "",
  style,
  children,
  ...props
}) => {
  const text = SIZES[size];
  const done = card.status === "done";
  const nominee = cardNominee(card);
  const surface = surfaceOf(done, nominee !== "", selected, look?.color);
  const fade = dragging ? "opacity-30" : "";
  const name = cardItemName(card);
  const merged = cardOrderNos(card).length > 1;
  // 注文ごとの段（byOrder の統合したカード）。1 行目に商品、注文番号と緊急の理由は段に出す
  const parts = byOrder && merged ? cardOrderParts(card, look) : null;
  const reasons = parts ? "" : emergencyReasons(card);
  // 豆の札（在庫対象の名前をそのまま）。豆の無い（商品のアイテムの在庫が無い）カードには出さない
  const bean = look?.bean?.name;
  // 注文番号の札と、商品の略称
  const noTag = (label: string, size: string) => (
    <span
      className={`rounded bg-black/10 px-1 py-0.5 font-black font-mono ${size}`}
      title={label}
    >
      {label}
    </span>
  );
  const orderNo = (size: string) => noTag(orderLabel(card), size);
  // 入れ直し（緊急）の理由の札
  const reasonTag = (label: string, className: string) => (
    <span
      title={label}
      className={`min-w-0 shrink truncate rounded bg-red-50 px-1 py-0.5 font-black text-red-700 ${className}`}
    >
      {label}
    </span>
  );
  // 入れ直し（緊急）の札
  const emergencyTag = (className: string) =>
    card.emergency && (
      <span
        className={`shrink-0 whitespace-nowrap rounded-md border-2 border-red-800 bg-red-600 py-0.5 font-black text-white ${className}`}
      >
        緊急
      </span>
    );
  const itemName = (size: string) => (
    <span
      className={`min-w-0 truncate font-black tracking-tight ${size}`}
      title={name}
    >
      {name}
    </span>
  );
  // 1 行目にいちばん大きく出す注文番号と、2 行目の商品（2 行目では、後ろの豆の札と指名・上級生の札を先に縮め、商品は入らなければ省略する。
  // 1 杯のカードは統合の判断に商品が要るので、狭いカードでも商品を残す）。
  // 番号は縮めない。統合した長い番号（「#120+#121」）だけは杯数の札と同じ大きさで字の間を詰め、
  // それでも入らなければ省略する（杯数の札をカードの外へ押し出さない）。注文ごとの段（D の統合したカード）は 1 行目が商品で、番号は段に出す
  const [headline, subline] = parts
    ? [itemName(text.no), null]
    : [
        orderNo(
          merged
            ? `min-w-0 truncate tracking-tighter ${text.cups}`
            : `shrink-0 ${text.no}`,
        ),
        itemName(`max-w-full shrink-0 ${text.item}`),
      ];
  return (
    <div
      {...props}
      style={{ ...surface.style, ...style }}
      className={`relative flex min-w-0 select-none flex-col justify-center gap-1 rounded-lg transition-[box-shadow] ${text.pad} ${surface.className} ${shadowOf(merged && !parts, selected)} ${selected ? "z-10 ring-4 ring-amber-500 ring-offset-2" : ""} ${className}`}
    >
      {children}
      {/* コメントのある注文は左上の角に印（押すと中身を右下に出す。開いたカードのパネル・番号の検索にも出す） */}
      {look?.comments && (
        <CommentMark count={look.comments.length} label={orderLabel(card)} />
      )}
      {/* 何番が何杯か（注文ごとの段では何が何杯か） */}
      <div
        className={`flex min-w-0 shrink-0 items-center gap-1 leading-none ${fade}`}
      >
        {headline}
        {/* 杯数はいつも右上（緊急の札・終わりの印はその左。幅の狭いカードの緊急の札は 2 行目） */}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {!text.emergencyBelow && emergencyTag(text.cups)}
          {done && (
            <Check className="h-4 w-4 text-emerald-700">
              <title>完了</title>
            </Check>
          )}
          <span
            className={`whitespace-nowrap rounded-md border-2 py-0.5 font-black font-mono ${text.cups} ${cupsClass(card.cups.length)}`}
          >
            {card.cups.length}杯
          </span>
        </span>
      </div>
      {/* 注文ごとの段（上から注文番号の小さい順）。段は上と下の端に寄せ（表では元の注文の行の高さに来る）、間の真ん中に点線 */}
      {parts && (
        <div className={`flex min-h-0 flex-1 flex-col ${fade}`}>
          {parts.map((part, index) => (
            <Fragment key={part.orderNo}>
              {index > 0 && (
                <div className="flex min-h-1.5 flex-1 items-center">
                  <div className="border-(color:--caos-card-order-line) w-full border-t-2 border-dashed" />
                </div>
              )}
              {/* D の表の狭い枠でも杯数をカードの外へ出さないよう、コメントの印は番号の札の右上に重ね、番号は字の間を、段は札の間を詰める */}
              <div className="flex min-w-0 shrink-0 items-center gap-0.5 leading-none">
                <span className="relative shrink-0">
                  {noTag(
                    `#${orderNoLabel(part.orderNo)}`,
                    `tracking-tighter ${text.no}`,
                  )}
                  {part.comments > 0 && (
                    <CommentMark
                      count={part.comments}
                      label={`#${orderNoLabel(part.orderNo)}`}
                      className="-top-1.5 -right-1.5 absolute h-4 w-4 border border-white"
                    />
                  )}
                </span>
                {part.reason && reasonTag(part.reason, text.meta)}
                <span
                  className={`ml-auto shrink-0 whitespace-nowrap font-black font-mono ${text.no}`}
                >
                  {part.cups}杯
                </span>
              </div>
            </Fragment>
          ))}
        </div>
      )}
      {/* 商品・指名・上級生のみ（縮めるのは豆・緊急の理由のあと）・緊急の理由か豆 */}
      <div
        className={`flex min-w-0 shrink-0 items-center gap-1 overflow-hidden leading-none ${text.meta} ${fade}`}
      >
        <span className="flex max-w-full shrink-0 items-center gap-1">
          {text.emergencyBelow && emergencyTag("px-1")}
          {/* 統合する相手は 2 行目の先頭（1 行目は番号・緊急・杯数でいっぱいになる。右下は「取り消す」が重なる） */}
          {mergeInto && (
            <span className="bg-(color:--caos-merge) inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 font-black font-mono text-white">
              <MergeIcon className="h-[1em] w-[1.3em] shrink-0" />
              {orderLabel(mergeInto)}
            </span>
          )}
          {subline}
          {/* 狭いカード（D の表の枠など）では、指名・上級生の札は切らずに省略する（1 つの注文の番号は縮めない） */}
          {nominee && (
            <span className="min-w-0 truncate rounded bg-slate-900 px-1 py-0.5 font-black text-white">
              指名 {nominee}
            </span>
          )}
          {/* 上級生でない担当者のドリッパーにあれば警告の色と印（置くのは止めない） */}
          {card.seniorOnly &&
            (look?.offSenior ? (
              <span
                title="上級生のみ（担当者が上級生ではありません）"
                className="inline-flex min-w-0 items-center rounded bg-red-600 px-1 py-0.5 font-black text-white"
              >
                <TriangleAlert className="h-3 w-3 shrink-0" />
                <span className="truncate">上級生</span>
              </span>
            ) : (
              <span
                title="上級生のみ"
                className="inline-flex min-w-0 items-center rounded bg-amber-100 px-1 py-0.5 font-black text-amber-900"
              >
                <Star className="h-3 w-3 shrink-0 fill-current" />
                <span className="truncate">上級生</span>
              </span>
            ))}
        </span>
        {/* 入れ直し（緊急）は理由を、ほかは豆を出す */}
        {reasons
          ? reasonTag(reasons, "ml-auto")
          : bean && (
              <span
                title={`豆：${bean}`}
                className="ml-auto min-w-0 shrink truncate font-bold opacity-75"
              >
                {bean}
              </span>
            )}
      </div>
      {note && (
        <div
          className={`truncate font-bold text-[11px] leading-tight ${dragging ? "opacity-30" : "opacity-80"}`}
        >
          {note}
        </div>
      )}
    </div>
  );
};

// 1〜6 のボタンの色（ドラッグで指の下は青。指名の番号でないボタンは押せない）
const padTone = (bayId: number, hoveredBay: number | null) =>
  hoveredBay === bayId
    ? "border-white bg-blue-500 text-white"
    : "border-slate-300 bg-white text-slate-950 disabled:border-slate-700 disabled:bg-slate-700 disabled:text-slate-500";

// カードの上に前半（1〜3）、下に後半（4〜6）を出すドリッパーのボタン（カードの children に置く）。未割当カード（管制盤 A・C）で使い、番号はそのドリッパーの列の最後へ。
// 段がヘッダー・帯・ほかのカードの下になったり枠で切れたりして押せないときは、両方の段を下か上に寄せる（useBayPadPlacement）。
// 指名の番号のあるカードは、その番号のボタンだけ押せる（logic/lanes の moveTargets）。
// ドラッグで指を滑らせて選べるよう、番号のボタンは data-bay-target を持つ（useCardDrag の bayTargetAt）。
export const BayPad: React.FC<{
  card: CaosCard;
  /** ドラッグで指の下にあるドリッパー */
  hoveredBay: number | null;
  onPick: (bayId: number) => void;
}> = ({ card, hoveredBay, onPick }) => {
  const targets = moveTargets(card, null);
  const half = Math.ceil(targets.length / 2);
  // 段の位置と高さは useBayPadPlacement が決める
  const placement = useBayPadPlacement();
  return (
    <div ref={placement.ref} className="contents">
      {[targets.slice(0, half), targets.slice(half)].map((row, index) => (
        <div
          key={row[0].bayId}
          style={placement.rows[index]}
          className="absolute right-0 left-0 z-[90] grid grid-cols-3 gap-1 rounded-lg bg-slate-950 p-1 shadow-xl"
        >
          {row.map(({ bayId, disabled }) => (
            <button
              key={bayId}
              type="button"
              disabled={disabled}
              data-bay-target={bayId}
              onClick={(event) => {
                event.stopPropagation();
                onPick(bayId);
              }}
              className={`h-full touch-none rounded-md border font-black font-mono text-[17px] transition-colors ${padTone(bayId, hoveredBay)}`}
            >
              {bayId}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
};

// 入れ直し（緊急）のカードの「取り消す」。開いた未割当・待機のカードに重ねる（2 回押しで決める）
export const CancelEmergencyButton: React.FC<{ onConfirm: () => void }> = ({
  onConfirm,
}) => (
  <TwoStepButton
    label="取り消す"
    confirmLabel="緊急を取り消す"
    onConfirm={onConfirm}
    className="absolute right-1 bottom-1 z-[85] h-7 w-auto px-2 text-xs"
  />
);

/** 統合の印（2 つのカップを 1 つに） */
const MergeIcon: React.FC<{ className: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 25.04 19.03" aria-hidden="true">
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
);

// 統合できる相手のカードに重ねる「統合する」（管制盤 A・C・D の未割当）。
// 「統合する」は、隣の開いたカードの 1〜6 のボタン（z-40 のカードの中）より上に出し、押せるようにする（押すとカードの onClick）
export const MergeOverlay: React.FC = () => (
  <>
    <div className="pointer-events-none absolute inset-0 z-20 rounded-md border-2 border-blue-500 bg-blue-50/90" />
    <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center p-1">
      <span className="bg-(color:--caos-merge) pointer-events-auto inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-lg px-4 py-2 font-black text-[16px] text-white shadow-md">
        <MergeIcon className="h-5 w-7 shrink-0" />
        統合する
      </span>
    </div>
  </>
);

/**
 * 統合の解除。統合したカードの 1 杯ずつの「外す」（外した 1 杯は未割当に戻る。残すほうを選べる）。開いたカードの children
 * （注文番号の行を隠さないよう下の行に重ねる）か、詳細のパネルに置く
 */
export const SplitCupButtons: React.FC<{
  card: CaosCard;
  onSplit: (cupId: string) => void;
  className?: string;
}> = ({
  card,
  onSplit,
  className = "absolute bottom-1 left-1 z-[75] flex",
}) => (
  <div className={`gap-1 ${className}`}>
    {card.cups.map((cup) => (
      <button
        key={cup.id}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onSplit(cup.id);
        }}
        className="min-h-[32px] touch-manipulation whitespace-nowrap rounded-md border-2 border-red-300 bg-white px-2 font-black font-mono text-[12px] text-red-700 shadow-sm active:bg-red-50"
      >
        #{orderNoLabel(cup.orderNo)} 外す
      </button>
    ))}
  </div>
);

/**
 * ドラッグで指の下にある列のカードの印（カードの children に置く）。前は左の縁、後ろは右の縁に入れる所の線、
 * 統合はカードを囲む統合の色の枠（落とす先の札は指に付いた写しに出す。hooks/useCardDrag の dropTargetLabel）
 */
export const DropMark: React.FC<{ side?: DropSide }> = ({ side }) => {
  if (!side) return null;
  if (side === "merge")
    return (
      <div className="border-(color:--caos-merge) pointer-events-none absolute inset-0 z-[95] rounded-lg border-4 bg-white/30" />
    );
  return (
    <div
      className={`-top-1 -bottom-1 pointer-events-none absolute z-[95] w-[6px] rounded-full bg-blue-600 shadow-[0_0_0_2px_white] ${side === "before" ? "-left-[7px]" : "-right-[7px]"}`}
    />
  );
};
