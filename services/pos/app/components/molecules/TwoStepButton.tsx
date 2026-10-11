import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

/** 1 回目を押してから、もう一度押せば決まる間（ミリ秒） */
const ARMED_MS = 4000;

/**
 * 押し間違えないよう 2 回押して決めるボタン（マスターと CaOS の緊急の取り消し）。
 * 1 回目で confirmLabel に変え、もう一度押したら onConfirm（ほかを押すか、数秒たつと戻る。iPad の Safari はボタンにフォーカスを当てないので、時間でも戻す）。
 * カードの中に置いても、カードを押したことにはしない
 */
export const TwoStepButton = ({
  label,
  confirmLabel,
  onConfirm,
  className,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARMED_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <Button
      type="button"
      size="sm"
      variant={armed ? "destructive" : "outline"}
      className={cn("w-full", className)}
      onBlur={() => setArmed(false)}
      onClick={(event) => {
        event.stopPropagation();
        if (armed) onConfirm();
        setArmed(!armed);
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
};
