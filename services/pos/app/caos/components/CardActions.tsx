import type { CaosCard } from "@cafeore/common";
import type React from "react";
import type { CardMenu } from "../hooks/useCardMenu";
import closeIcon from "../icons/close.svg";
import commentIcon from "../icons/comment.svg";
import finishIcon from "../icons/done.svg";
import emergencyIcon from "../icons/emergency.svg";
import holdIcon from "../icons/hold.svg";
import lateIcon from "../icons/late.svg";
import startIcon from "../icons/start.svg";
import unstartIcon from "../icons/unstart.svg";
import { lateCard } from "../logic/alerts";
import { type CardAction, cardActions, cardStage } from "../logic/cardActions";
import type { CardLook } from "../logic/cards";
import type { Lane } from "../logic/lanes";

// ドリッパーのカード（管制盤 A・C・D）に重ねるもの：開いたカードの操作のアイコン（hooks/useCardMenu）と、
// 未着手の ✋・15 分を超えた注文の「15」の印。アイコンは現場で作った素材（icons/。色は素材のまま）

const ICONS: Record<CardAction, { src: string; label: string }> = {
  start: { src: startIcon, label: "始める" },
  finish: { src: finishIcon, label: "終える（待機の先頭を始める）" },
  hold: { src: holdIcon, label: "終える（次は待たせる）" },
  unstart: { src: unstartIcon, label: "未着手に戻す" },
  emergency: { src: emergencyIcon, label: "緊急（入れ直し）" },
  comment: { src: commentIcon, label: "コメントを見る" },
  close: { src: closeIcon, label: "閉じる" },
};

/** 素材のアイコン（白い丸に載せ、カードの地の色に染まらないようにする） */
const Icon: React.FC<{ src: string; className: string; label?: string }> = ({
  src,
  className,
  label = "",
}) => (
  <img
    src={src}
    alt={label}
    title={label || undefined}
    draggable={false}
    className={`rounded-full bg-white ${className}`}
  />
);

/**
 * カードの children に置く。未着手（抽出中の無い列の待機の先頭）は下の辺の真ん中に ✋、受けてから 15 分を超えてまだ始めていないカードは「15」。
 * menu で開いたカードには、その段階の操作のアイコンを真ん中に並べる（狭いカードでは左右へはみ出す）。
 * inset はアイコンを並べる幅の左の端（管制盤 A で、左の固定の列の下に隠れた分を避ける。無ければカードの左の端）
 */
export const CardOverlay: React.FC<{
  card: CaosCard;
  lane: Lane;
  look?: CardLook;
  nowMs: number;
  menu?: CardMenu;
  inset?: string;
}> = ({ card, lane, look, nowMs, menu, inset = "0px" }) => {
  const ready = cardStage(card, lane) === "ready";
  const late = lateCard(card, nowMs);
  return (
    <>
      {(ready || late) && (
        <span className="-bottom-2 -translate-x-1/2 pointer-events-none absolute left-1/2 z-20 flex gap-1">
          {ready && (
            <Icon src={holdIcon} label="未着手" className="h-6 w-6 shadow-sm" />
          )}
          {late && (
            <Icon
              src={lateIcon}
              label="受けてから 15 分を超えています"
              className="h-6 w-6 shadow-sm"
            />
          )}
        </span>
      )}
      {menu?.isOpen(card) && (
        <div
          style={{ left: inset }}
          className="pointer-events-none absolute inset-y-0 right-0 z-[90] flex items-center justify-center"
        >
          <div className="pointer-events-auto flex shrink-0 gap-1 rounded-full bg-slate-950/70 p-1 shadow-xl">
            {cardActions(card, lane, {
              nowMs,
              comments: Boolean(look?.comments),
            }).map(({ action, disabled }) => (
              <button
                key={action}
                type="button"
                disabled={disabled}
                aria-label={ICONS[action].label}
                title={ICONS[action].label}
                onClick={(event) => {
                  event.stopPropagation();
                  menu.run(card, action);
                }}
                className="h-10 w-10 shrink-0 touch-manipulation rounded-full active:scale-90 disabled:opacity-40"
              >
                <Icon src={ICONS[action].src} className="h-full w-full" />
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
};
