import { CheckIcon, Cross2Icon, UpdateIcon } from "@radix-ui/react-icons";
import { memo } from "react";

type props = {
  status: "init" | "disconnected" | "connecting" | "connected";
};

export const PrinterStatus = memo(({ status }: props) => {
  return (
    <div className="flex items-center">
      {status === "connected" && (
        <>
          <CheckIcon className="h-5 w-5 stroke-stone-400" />
          <div className="text-stone-400">プリンター接続完了</div>
        </>
      )}
      {status === "connecting" && (
        <>
          <UpdateIcon className="h-6 w-6 animate-spin stroke-orange-600" />
          <div className="ml-1 font-bold text-orange-600">プリンター接続中</div>
        </>
      )}
      {status === "disconnected" && (
        <>
          <Cross2Icon className="h-7 w-7 stroke-red-600" />
          <div className="ml-1 font-bold text-red-600">プリンター未接続</div>
        </>
      )}
    </div>
  );
});
