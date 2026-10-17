import { Check, Hand } from "lucide-react";
import comeHere from "../icons/reactions/come-here.png";
import done from "../icons/reactions/done.png";

/** 絵文字の立体表現を使わず、添付素材と単色アイコンで共通表示する。 */
export const ReactionIcon = ({ stamp }: { stamp: string }) => {
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
      {stamp === "OK" ? (
        <Check
          aria-hidden="true"
          className="h-5 w-5 text-emerald-600"
          strokeWidth={3}
        />
      ) : (
        <Hand aria-hidden="true" className="h-5 w-5 text-amber-600" />
      )}
      <span className="font-black text-[10px] text-slate-700">{stamp}</span>
    </span>
  );
};
