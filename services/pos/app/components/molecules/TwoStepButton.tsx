import { useState } from "react";
import { Button } from "../ui/button";

/**
 * マスターのカップの緊急ボタン。押し間違えないよう、1 回目で「入れ直す」に変え、もう一度押したら入れ直す
 * （ほかを押すと戻る）
 */
export const EmergencyCupButton = ({
  onConfirm,
}: {
  onConfirm: () => void;
}) => {
  const [armed, setArmed] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant={armed ? "destructive" : "outline"}
      className="mt-1 w-full"
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (armed) onConfirm();
        setArmed(!armed);
      }}
    >
      {armed ? "入れ直す" : "緊急"}
    </Button>
  );
};
