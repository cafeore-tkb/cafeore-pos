import { CheckIcon, Cross2Icon, UpdateIcon } from "@radix-ui/react-icons";
import { memo } from "react";

type props = {
  /** どのプリンターか（ラベル・レシート） */
  name: string;
  status: "init" | "disconnected" | "connecting" | "connected";
  /** つながらないときに案内する、端末でプリンターの証明書を許可するページ */
  certificateUrl?: string;
};

export const PrinterStatus = memo(({ name, status, certificateUrl }: props) => {
  return (
    <div className="flex items-center">
      {status === "connected" && (
        <>
          <CheckIcon className="h-5 w-5 stroke-stone-400" />
          <div className="text-stone-400">{name}プリンター接続完了</div>
        </>
      )}
      {status === "connecting" && (
        <>
          <UpdateIcon className="h-6 w-6 animate-spin stroke-orange-600" />
          <div className="ml-1 font-bold text-orange-600">
            {name}プリンター接続中
          </div>
        </>
      )}
      {status === "disconnected" && (
        <>
          <Cross2Icon className="h-7 w-7 stroke-red-600" />
          <div className="ml-1">
            <div className="font-bold text-red-600">{name}プリンター未接続</div>
            {certificateUrl && (
              <a
                href={certificateUrl}
                target="_blank"
                rel="noreferrer"
                className="text-red-600 text-xs underline"
              >
                iPad は {certificateUrl} を一度開いて証明書を許可
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
});
