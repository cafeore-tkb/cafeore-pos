import { Eye, HandHeart } from "lucide-react";
import comeHere from "../icons/reactions/come-here.png";
import done from "../icons/reactions/done.png";

/** OKは🆗、待っては⏳️。その他は添付素材と単色アイコンで共通表示する。 */
export const ReactionIcon = ({ stamp }: { stamp: string }) => {
  if (stamp === "OK")
    return (
      <span role="img" aria-label="OK" className="text-[30px] leading-none">
        🆗
      </span>
    );
  if (stamp === "済み" || stamp === "来て！")
    return (
      <img
        src={stamp === "済み" ? done : comeHere}
        alt={stamp}
        draggable={false}
        className="h-9 w-12 object-contain"
      />
    );
  return (
    <span className="flex flex-col items-center gap-0.5">
      {stamp === "見た" ? (
        <Eye aria-hidden="true" className="h-5 w-5 text-sky-600" />
      ) : stamp === "ごめん" ? (
        <HandHeart aria-hidden="true" className="h-5 w-5 text-slate-600" />
      ) : (
        <span aria-hidden="true" className="text-[30px] leading-none">
          ⏳️
        </span>
      )}
      <span className="font-black text-[10px] text-slate-700">{stamp}</span>
    </span>
  );
};
