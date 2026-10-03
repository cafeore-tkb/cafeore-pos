import { HiBell, HiBellAlert } from "react-icons/hi2";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

type props = {
  isReady: boolean;
  // 応答待ち。押しても無視される
  busy: boolean;
  changeReady: () => void;
};

export const ReadyBell = ({ isReady, busy, changeReady }: props) => {
  return (
    <Button
      type="button"
      onClick={changeReady}
      aria-busy={busy}
      className={cn(
        "hover:-translate-y-0.5 flex h-16 w-20 flex-col items-center transition-all duration-150 hover:bg-orange-200 hover:shadow-md active:translate-y-0 active:scale-95",
        isReady ? "bg-stone-200" : "bg-orange-600",
        busy && "animate-pulse cursor-wait",
      )}
    >
      {isReady ? (
        <HiBellAlert className="h-7 w-7 rotate-12 fill-orange-600" />
      ) : (
        <HiBell className="h-7 w-7 fill-white" />
      )}
      <span
        className={cn("text-xs", isReady ? "text-orange-600" : "text-white")}
      >
        {isReady ? "呼び出し中" : "呼び出す"}
      </span>
    </Button>
  );
};
