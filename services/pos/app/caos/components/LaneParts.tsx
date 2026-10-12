import { dripperLabel } from "@cafeore/common";
import {
  KeyRound,
  Star,
  StarOff,
  TriangleAlert,
  UserRoundPen,
} from "lucide-react";
import type React from "react";
import { toast } from "sonner";
import { useCaosLanes } from "../hooks/useCaosLanes";

// ドリッパーの見出しの担当者。「1st 山田★」のように、番号（各画面がもう出している）の横に名前と上級生の印を出す。
// 担当者がいなければ何も出さない（番号だけ）。

/** 上級生の印 */
export const SeniorMark: React.FC<{ className?: string }> = ({
  className = "",
}) => (
  <span
    title="上級生"
    aria-label="上級生"
    className={`inline-flex shrink-0 items-center text-amber-500 ${className}`}
  >
    <Star className="h-3.5 w-3.5 fill-current" />
  </span>
);

/** そのドリッパーの担当者の名前と上級生の印。担当者がいなければ何も出さない */
export const LaneName: React.FC<{ dripper: number; className?: string }> = ({
  dripper,
  className = "",
}) => {
  const lane = useCaosLanes().lanes.find((l) => l.dripper === dripper);
  if (!lane?.name) return null;
  return (
    <span
      data-lane-name={dripper}
      title={lane.senior ? `${lane.name}（上級生）` : lane.name}
      className={`inline-flex min-w-0 items-center gap-0.5 ${className}`}
    >
      <span className="truncate">{lane.name}</span>
      {lane.senior && <SeniorMark />}
    </span>
  );
};

/** その担当者が淹れられるもの（上級生のみのカードを淹れられるか）。担当者がいなければ何も出さない */
export const LaneAbility: React.FC<{ dripper: number }> = ({ dripper }) => {
  const lane = useCaosLanes().lanes.find((l) => l.dripper === dripper);
  if (!lane?.name) return null;
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 font-bold text-[11px] leading-none ${lane.senior ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-500"}`}
    >
      {lane.senior ? "上級生のみも可" : "上級生のみ不可"}
    </span>
  );
};

// 「交代」のボタンの形（押しても下のカード・列の操作には届かない）
const LaneButton: React.FC<
  React.ComponentProps<"button"> & { dripper: number }
> = ({ dripper, onClick, className = "", ...props }) => (
  <button
    type="button"
    data-lane-change={dripper}
    onClick={(event) => {
      event.stopPropagation();
      onClick?.(event);
    }}
    onPointerDown={(event) => event.stopPropagation()}
    className={`min-w-0 max-w-full touch-manipulation rounded-md border font-black text-[11px] active:scale-95 ${className}`}
    {...props}
  />
);

// 見出しの「交代」の並べ方。stacked は「交代 →」の下に次の人（幅の狭い A・D の見出し）、inline は 1 行（列の操作のパネル・C）
const LAYOUTS = {
  stacked: "flex flex-col items-start justify-center px-1 py-0.5",
  inline: "inline-flex h-7 items-center gap-1 px-1.5",
};

/**
 * 列の見出し・列の操作のパネルの「交代」。押したらすぐ次の人（sohosai-shift の予定で、今の担当者より後ろの最初の人）に替え、ボタンに次の人を出す。
 * 次の人がいなければ押せない見た目にし、押すと理由を通知で出す。閲覧だけの画面では出さない
 */
export const LaneChangeButton: React.FC<{
  dripper: number;
  layout?: keyof typeof LAYOUTS;
  className?: string;
}> = ({ dripper, layout = "stacked", className = "" }) => {
  const { editable, nextOf, changeToNext } = useCaosLanes();
  if (!editable) return null;
  const found = nextOf(dripper);
  const head = (arrow: string) => (
    <span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[10px] leading-tight">
      <UserRoundPen className="h-3 w-3 shrink-0" />
      交代{arrow}
    </span>
  );
  if ("reason" in found)
    return (
      <LaneButton
        dripper={dripper}
        aria-disabled
        title={found.reason}
        onClick={() =>
          toast(found.reason, {
            description:
              "ほかの人にするときは、ヘッダーの「ドリッパー」の「交代」から選ぶか名前を入れます",
          })
        }
        className={`${LAYOUTS[layout]} border-slate-300 border-dashed bg-slate-50 text-slate-400 ${className}`}
      >
        {head("")}
        <span className="max-w-full truncate font-bold text-[10px] leading-tight">
          次の人なし
        </span>
      </LaneButton>
    );
  const { name, senior, reasons } = found.next;
  return (
    <LaneButton
      dripper={dripper}
      title={`交代 → ${name}（${reasons.join("・")}）`}
      aria-label={`交代 → ${name}`}
      onClick={() => changeToNext(dripper, found.next)}
      className={`${LAYOUTS[layout]} border-slate-300 bg-white text-slate-500 hover:bg-slate-50 ${className}`}
    >
      {head(" →")}
      <span className="flex min-w-0 max-w-full items-center text-[12px] text-slate-950 leading-tight">
        <span className="truncate">{name}</span>
        {senior && <SeniorMark />}
      </span>
    </LaneButton>
  );
};

/** ヘッダーの「ドリッパー」の「交代」。交代の画面を開き、候補を選ぶ・名前を入れる・入れ替える・空きにする。閲覧だけの画面では出さない */
export const LaneChooseButton: React.FC<{
  dripper: number;
  className?: string;
}> = ({ dripper, className = "" }) => {
  const { editable, openChange } = useCaosLanes();
  if (!editable) return null;
  return (
    <LaneButton
      dripper={dripper}
      onClick={() => openChange(dripper)}
      title="担当者を交代"
      className={`inline-flex h-7 shrink-0 items-center gap-0.5 border-slate-300 bg-white px-1.5 text-slate-700 hover:bg-slate-50 ${className}`}
    >
      <UserRoundPen className="h-3.5 w-3.5" />
      交代
    </LaneButton>
  );
};

// ヘッダーに出す担当者のこと：どのドリッパーにも上級生がいなければ知らせる（指名の無い上級生のみのカードをどこにも置けない）。
// 上級生の名簿から外れたのに、指名の無い上級生のみのカードが待っているので上級生のままにしている担当者がいれば知らせ、押したら確かめて外す。
// 操作の画面では、この端末の sohosai-shift の合言葉の設定も開ける。

// 合言葉のボタンの色（合言葉が無ければ点線、読めなければ赤）
const keyTone = ({
  feedKey,
  error,
}: { feedKey: string; error: string | null }) => {
  if (!feedKey) return "border-slate-300 border-dashed bg-white text-slate-400";
  if (error) return "border-red-200 bg-red-50 text-red-600";
  return "border-[#cbd5e1] bg-[#f1f5f9] text-slate-700";
};

export const LaneHeaderStatus: React.FC = () => {
  const {
    hasSenior,
    editable,
    openSettings,
    shiftFeed,
    heldSeniors,
    releaseHeldSeniors,
  } = useCaosLanes();
  // 閲覧だけの画面は予定を読まないので出ない
  const held = heldSeniors
    .map(({ dripper, name }) => `${dripperLabel(dripper)} ${name}`)
    .join("・");
  return (
    <>
      {held && (
        <button
          type="button"
          data-held-senior
          onClick={releaseHeldSeniors}
          aria-label={`${held} は上級生の名簿にありません。上級生から外す`}
          title={`${held} は sohosai-shift の上級生の名簿にありません。指名の無い上級生のみのカードが待っているので、上級生のままにしています（カードが無くなれば、次に予定を読み直したときに外します）。押すと確かめてから外します`}
          className="flex min-h-[44px] min-w-[44px] shrink-0 touch-manipulation items-center justify-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 font-black text-[11px] text-amber-900 leading-tight"
        >
          <StarOff className="h-4 w-4 shrink-0" />
          {/* 幅が狭いと印だけ出す（ヘッダーに余裕が無いので。中身は title） */}
          <span className="hidden whitespace-nowrap 2xl:inline">
            {held} は上級生の名簿にありません（★を外す）
          </span>
        </button>
      )}
      {!hasSenior && (
        <output
          data-no-senior
          aria-label="上級生がいません（指名の無い上級生のみのカードを置けません）"
          title="上級生のみのカードは、指名が無ければ上級生のドリッパーにしか置けません。各ドリッパーの「交代」で上級生を入れてください"
          className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 font-black text-[11px] text-amber-900 leading-tight"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {/* 幅が狭いと印だけ出す（ヘッダーに余裕が無いので。中身は title） */}
          <span className="hidden whitespace-nowrap 2xl:inline">
            上級生がいません（指名の無い上級生のみのカードを置けません）
          </span>
        </output>
      )}
      {editable && (
        <button
          type="button"
          onClick={openSettings}
          title="sohosai-shift の合言葉（この端末の設定）"
          aria-label="sohosai-shift の合言葉"
          className={`flex h-11 w-11 touch-manipulation items-center justify-center rounded-lg border ${keyTone(shiftFeed)}`}
        >
          <KeyRound className="h-4 w-4" />
        </button>
      )}
    </>
  );
};
