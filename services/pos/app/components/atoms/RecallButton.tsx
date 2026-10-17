import { HiMegaphone } from "react-icons/hi2";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { PendingSpinner } from "./PendingSpinner";

type props = {
  // 応答待ち。押しても無視される
  busy: boolean;
  onRecall: () => void;
};

/** 呼び出し中の注文の「呼び出し催促」。呼び出し画面が「お急ぎ、提供口までお越しください」と読み上げる */
export const RecallButton = ({ busy, onRecall }: props) => {
  return (
    <Button
      type="button"
      onClick={onRecall}
      aria-busy={busy}
      className={cn(
        // 6 文字の名前が収まるよう、左右の余白を詰める
        "hover:-translate-y-0.5 relative flex h-16 w-20 flex-col items-center bg-red-600 px-1 transition-all duration-150 hover:bg-red-500 hover:shadow-md active:translate-y-0 active:scale-95",
        busy && "cursor-wait",
      )}
    >
      <HiMegaphone className="h-7 w-7 fill-white" />
      <span className="text-white text-xs">呼び出し催促</span>
      {busy && <PendingSpinner className="text-white" />}
    </Button>
  );
};
