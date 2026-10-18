import { type CaosCard, caosCardServed } from "@cafeore/common";
import type React from "react";
import type { CardMenu } from "../hooks/useCardMenu";
import finishBrewIcon from "../icons/finish-brew.svg";
import requestRebrewIcon from "../icons/request-rebrew.svg";
import startBrewIcon from "../icons/start-brew.svg";
import unassignIcon from "../icons/unassign.svg";
import undoBrewStartIcon from "../icons/undo-brew-start.svg";
import viewCommentsIcon from "../icons/view-comments.svg";
import { type CardAction, cardActions, cardStage } from "../logic/cardActions";
import type { CardLook } from "../logic/cards";
import type { Lane } from "../logic/lanes";

// ドリッパーのカード（管制盤 A・C・D）に重ねるもの：開いたカードの操作のアイコン（hooks/useCardMenu）と、
// 未着手の ✋ の印。アイコンは現場で作った素材（icons/。色は素材のまま）

const ICONS: Record<
  Exclude<CardAction, `assign:${number}`>,
  { src: string; label: string }
> = {
  start: { src: startBrewIcon, label: "始める" },
  finish: { src: finishBrewIcon, label: "終える（待機の先頭を始める）" },
  unstart: { src: undoBrewStartIcon, label: "未着手に戻す" },
  emergency: { src: requestRebrewIcon, label: "緊急（入れ直し）" },
  comment: { src: viewCommentsIcon, label: "コメントを見る" },
  unassign: { src: unassignIcon, label: "未割当に戻す" },
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
 * カードの children に置く。未着手（抽出中の無い列の待機の先頭）は下の辺の真ん中に ✋。
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
  const servedRecovery = card.status === "brewing" && caosCardServed(card);
  return (
    <>
      {ready && (
        <span className="-bottom-2 -translate-x-1/2 pointer-events-none absolute left-1/2 z-20 flex gap-1">
          {ready && (
            <Icon
              src={undoBrewStartIcon}
              label="未着手"
              className="h-6 w-6 shadow-sm"
            />
          )}
        </span>
      )}
      {servedRecovery && menu && !menu.isOpen(card) && (
        <button
          type="button"
          aria-label="提供済み：抽出を終える（待機の先頭を始める）"
          title="提供済み：確認なしで抽出を終える"
          style={{ left: `max(calc(${inset} + 4px), calc(50% - 20px))` }}
          className="absolute bottom-0 z-[90] flex h-10 w-10 touch-manipulation items-center justify-center rounded-full bg-white shadow-lg active:scale-90"
          onClick={(event) => {
            event.stopPropagation();
            menu.run(card, "finish", event.currentTarget);
          }}
        >
          <Icon
            src={finishBrewIcon}
            className="caos-served-finish h-full w-full"
          />
        </button>
      )}
      {menu?.isOpen(card) && (
        <div
          style={{ left: inset }}
          className="pointer-events-none absolute inset-y-0 right-0 z-[90] flex items-center justify-center"
        >
          <div className="pointer-events-auto flex shrink-0 gap-3 rounded-2xl bg-slate-950/70 p-2 shadow-xl">
            {cardActions(card, lane, {
              nowMs,
              comments: Boolean(look?.comments?.length),
            }).map(({ action, disabled }) => {
              const target = action.startsWith("assign:")
                ? Number(action.slice(7))
                : null;
              const icon = ICONS[action as keyof typeof ICONS];
              const label = target ? `${target} に再割当` : icon.label;
              return (
                <button
                  key={action}
                  type="button"
                  disabled={disabled}
                  aria-label={label}
                  title={label}
                  onClick={(event) => {
                    event.stopPropagation();
                    menu.run(card, action, event.currentTarget);
                  }}
                  className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full bg-white font-black text-lg text-slate-950 active:scale-90 disabled:opacity-40"
                >
                  {target ?? (
                    <Icon
                      src={icon.src}
                      className={`h-full w-full ${action === "finish" && servedRecovery ? "caos-served-finish" : ""}`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
};
