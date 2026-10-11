import { useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

/**
 * 押し間違えないよう 2 回押して決めるボタン（マスターの緊急・緊急の取り消し、CaOS の入れ直しの取り消し）。
 * 1 回目で confirmLabel に変え、もう一度押したら onConfirm（ほかを押すと戻る）。
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
