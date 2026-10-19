import { CircleCheck, KeyRound, Star, TriangleAlert } from "lucide-react";
import type React from "react";
import { useCaosLanes } from "../hooks/useCaosLanes";
import changeDripperIcon from "../icons/change-dripper.svg";
import { dripWarnings } from "../logic/dripSupport";

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

// 4文字以内は1行を優先し、枠自体より狭い場合だけ省略する。
const nameClass = (name: string, wrap: boolean) =>
  [...name].length <= 4
    ? "max-w-full shrink-0 truncate"
    : wrap
      ? "line-clamp-2 break-all"
      : "truncate";

/** そのドリッパーの担当者の名前と上級生の印。担当者がいなければ何も出さない。wrap なら入らない名前を 2 行まで折り返す（列の見出し） */
export const LaneName: React.FC<{
  dripper: number;
  wrap?: boolean;
  className?: string;
}> = ({ dripper, wrap = false, className = "" }) => {
  const lane = useCaosLanes().lanes.find((l) => l.dripper === dripper);
  if (!lane?.name) return null;
  return (
    <span
      data-lane-name={dripper}
      title={lane.senior ? `${lane.name}（上級生）` : lane.name}
      className={`inline-flex min-w-0 max-w-full items-center gap-0.5 ${[...lane.name].length <= 4 ? "flex-wrap" : "flex-nowrap"} ${className}`}
    >
      <span className={nameClass(lane.name, wrap)}>{lane.name}</span>
      {lane.senior && <SeniorMark />}
    </span>
  );
};

/** その担当者が上級生か（上級生のみのカードを置くと警告の印が付くか）。担当者がいなければ何も出さない */
export const LaneAbility: React.FC<{ dripper: number }> = ({ dripper }) => {
  const lane = useCaosLanes().lanes.find((l) => l.dripper === dripper);
  if (!lane?.name) return null;
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 font-bold text-[11px] leading-none ${lane.senior ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-500"}`}
    >
      {lane.senior ? "上級生のみも可" : "上級生のみは ⚠"}
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

/** 添付の交代SVG。文字色に合わせる。 */
const ChangeIcon: React.FC<{ className?: string }> = ({
  className = "h-5 w-5",
}) => (
  <span
    aria-hidden="true"
    className={`inline-block shrink-0 bg-current ${className}`}
    style={{
      maskImage: `url("${changeDripperIcon}")`,
      WebkitMaskImage: `url("${changeDripperIcon}")`,
      maskRepeat: "no-repeat",
      maskPosition: "center",
      maskSize: "contain",
      WebkitMaskRepeat: "no-repeat",
      WebkitMaskPosition: "center",
      WebkitMaskSize: "contain",
    }}
  />
);
const CHANGE_TONE =
  "rounded-lg border-slate-300 bg-white text-slate-700 shadow-xs hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500";

/** 現在の名前そのものが交代ボタン。次の名前の予告は実際の開始10分前から。 */
export const LaneChangeButton: React.FC<{
  dripper: number;
  className?: string;
}> = ({ dripper, className = "" }) => {
  const { editable, lanes, upcomingOf, changeToNext, openChange } =
    useCaosLanes();
  const lane = lanes.find((item) => item.dripper === dripper);
  if (!editable)
    return <LaneName dripper={dripper} wrap className={className} />;
  const upcoming = upcomingOf(dripper);
  const label = lane?.name || "担当者なし";
  return (
    <div className="inline-flex min-w-0 max-w-full flex-col items-start gap-1">
      <LaneButton
        dripper={dripper}
        title={
          upcoming
            ? `${label}から${upcoming.name}へ交代`
            : `${label}の担当者を選んで交代`
        }
        aria-label={
          upcoming
            ? `${label}から${upcoming.name}へ交代`
            : `${label}の担当者を選んで交代`
        }
        onClick={() => {
          if (upcoming) changeToNext(dripper, upcoming);
          else openChange(dripper);
        }}
        className={`flex min-h-11 flex-col items-start justify-center px-1 py-1 text-[16px] ${CHANGE_TONE} ${className}`}
      >
        <span className="flex min-w-0 max-w-full flex-wrap items-center gap-1 leading-tight">
          <span className={nameClass(label, true)}>{label}</span>
          <span className="inline-flex shrink-0 items-center gap-1">
            {lane?.senior && <SeniorMark />}
            <ChangeIcon />
          </span>
        </span>
        {upcoming && (
          <span className="mt-0.5 flex min-w-0 max-w-full items-center gap-0.5 text-[12px] leading-tight">
            <span className="truncate">次：{upcoming.name}</span>
            {upcoming.senior && <SeniorMark />}
          </span>
        )}
      </LaneButton>
      <LaneDripHints dripper={dripper} />
    </div>
  );
};

/** できない抽出だけ表示する。全部対応・未登録は何も付けない。 */
export const LaneDripHints = ({ dripper }: { dripper: number }) => {
  const { lanes, shiftFeed } = useCaosLanes();
  const name = lanes.find((lane) => lane.dripper === dripper)?.name ?? "";
  const warnings = dripWarnings(shiftFeed.feed, name);
  if (!warnings.length) return null;
  return (
    <div
      className="flex max-w-full flex-wrap gap-1"
      aria-label={`${name}の未対応の抽出（割当は可能）`}
    >
      {warnings.map((label) => (
        <span
          key={label}
          className="rounded border border-amber-400 bg-amber-50 px-1 py-0.5 font-black text-[12px] text-red-800 leading-tight"
        >
          {label}
        </span>
      ))}
    </div>
  );
};

/** 設定画面の「ドリッパー」の「交代」。交代の画面を開き、候補を選ぶ・名前を入れる・入れ替える・空きにする。閲覧だけの画面では出さない */
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
      className={`inline-flex min-h-[52px] min-w-24 shrink-0 items-center justify-center gap-2 px-4 text-[16px] ${CHANGE_TONE} ${className}`}
    >
      <ChangeIcon className="h-6 w-6" />
      交代
    </LaneButton>
  );
};

// 設定画面に出す担当者のこと：どのドリッパーにも上級生がいなければ知らせる（指名の無い上級生のみのカードは、どこに置いても警告の印が付く）。
// この端末の sohosai-shift の合言葉の設定もここから開ける。

// 合言葉のボタンの色（合言葉が無ければ点線、読めなければ赤）
const keyTone = ({
  feedKey,
  error,
}: { feedKey: string; error: string | null }) => {
  if (!feedKey) return "border-slate-300 border-dashed bg-white text-slate-400";
  if (error) return "border-red-200 bg-red-50 text-red-600";
  return "border-[#cbd5e1] bg-[#f1f5f9] text-slate-700";
};

export const LaneSettingsStatus: React.FC = () => {
  const { hasSenior, editable, openSettings, shiftFeed } = useCaosLanes();
  return (
    <div className="grid gap-2">
      <output
        data-no-senior={!hasSenior || undefined}
        aria-label={
          hasSenior
            ? "上級生が担当に入っています"
            : "上級生がいません（上級生のみのカードには警告の印が付きます）"
        }
        className={`flex min-h-[64px] items-center gap-3 rounded-xl border p-3 font-black text-[13px] leading-tight ${
          hasSenior
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-amber-300 bg-amber-50 text-amber-900"
        }`}
      >
        {hasSenior ? (
          <CircleCheck className="h-5 w-5 shrink-0" />
        ) : (
          <TriangleAlert className="h-5 w-5 shrink-0" />
        )}
        <span>
          {hasSenior
            ? "上級生が担当に入っています"
            : "上級生がいません（上級生のみのカードに警告の印）"}
        </span>
      </output>
      {editable && (
        <button
          type="button"
          onClick={openSettings}
          title="sohosai-shift の合言葉（この端末の設定）"
          aria-label="sohosai-shift の合言葉を入力"
          className={`flex min-h-[56px] w-full touch-manipulation items-center gap-3 rounded-xl border px-4 text-left font-black text-[14px] ${keyTone(shiftFeed)}`}
        >
          <KeyRound className="h-5 w-5 shrink-0" />
          <span className="flex flex-col gap-0.5">
            <span>合言葉入力</span>
            <span className="font-bold text-[11px] opacity-75">
              ドリッパー担当表を読み込むための端末設定
            </span>
          </span>
        </button>
      )}
    </div>
  );
};
