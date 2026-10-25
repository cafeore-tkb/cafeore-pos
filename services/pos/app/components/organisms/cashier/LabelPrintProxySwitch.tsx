import { memo } from "react";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";
import { Label } from "../../ui/label";

type props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** オンのとき、まだ刷れていない代理印刷の数 */
  waiting: number;
};

/**
 * レジのヘッダーに出す、代理印刷のスイッチ。オンのレジは、CaOS・マスターが直接刷れなかった緊急のシールを
 * このレジのラベル用のプリンターで刷る（label/print-relay）。この端末に覚える
 */
export const LabelPrintProxySwitch = memo(
  ({ checked, onCheckedChange, waiting }: props) => (
    <div
      className="flex items-center gap-2"
      title="オンにすると、CaOS・マスターがプリンターに直接刷れなかった緊急のシールを、このレジのラベル用のプリンターで代わりに刷ります。開いたときに、ほかに代理印刷をしているレジが無ければ自動でオンになります"
    >
      <Switch
        id="label-print-proxy"
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
      <Label
        htmlFor="label-print-proxy"
        className={cn(
          "whitespace-nowrap text-[13px] text-stone-500",
          checked && "font-bold text-slate-700",
        )}
      >
        代理印刷
        {checked && waiting > 0 && (
          <span className="ml-1 text-orange-600 tabular-nums">
            待ち {waiting}
          </span>
        )}
      </Label>
    </div>
  ),
);
