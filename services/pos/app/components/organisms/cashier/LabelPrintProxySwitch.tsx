import { memo } from "react";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";
import { HelpMark } from "../../molecules/HelpMark";
import { Label } from "../../ui/label";

type props = {
  checked: boolean;
  /** ラベル用のプリンターにつながっていない（代理印刷できないので、切り替えさせない） */
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** オンのとき、まだ刷れていない代理印刷の数 */
  waiting: number;
};

/**
 * レジのヘッダーに出す、代理印刷のスイッチ。オンのレジは、CaOS・マスターが直接刷れなかった緊急のシールを
 * このレジのラベル用のプリンターで刷る（label/print-relay）。ラベル用のプリンターにつながっていればオンで、
 * 手でオフにしたら、この端末に覚える（useLabelPrintProxySetting）
 */
export const LabelPrintProxySwitch = memo(
  ({ checked, disabled, onCheckedChange, waiting }: props) => (
    <div
      className="flex items-center gap-2"
      title={
        disabled
          ? "ラベル用のプリンターにつながっていないので、代理印刷しません"
          : undefined
      }
    >
      <Switch
        id="label-print-proxy"
        checked={checked}
        disabled={disabled}
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
      <HelpMark title="クラウド代理印刷" size="sm" panelClassName="w-72">
        <p>
          <span className="font-bold text-stone-800">クラウド代理印刷：</span>
          CaOS
          がプリンターに繋がっていない時、クラウド経由でこのレジからラベルを印刷できます
        </p>
      </HelpMark>
    </div>
  ),
);
