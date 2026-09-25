import {
  type ColorScreen,
  type ColorSetting,
  type ColorTargetType,
  type WithId,
  colorSettingRepository,
} from "@cafeore/common";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";

type Props = {
  targetType: ColorTargetType;
  targetId: string;
  screen: ColorScreen;
  setting: WithId<ColorSetting> | undefined;
  onChanged: () => Promise<unknown>;
};

// 未設定のときにカラーピッカーに出しておく色。この色のままでは保存できない
const PICKER_PLACEHOLDER = "#ffffff";

export function ColorSettingCell({
  targetType,
  targetId,
  screen,
  setting,
  onChanged,
}: Props) {
  // null は「まだ色を選んでいない」。未設定のセルで既定の白を保存しないために区別する
  const [draft, setDraft] = useState<string | null>(setting?.color ?? null);
  const [submitting, setSubmitting] = useState(false);

  const savedColor = setting?.color;
  // 保存・解除で設定が変わったらピッカーを合わせる（解除後に消した色が残らないように）
  useEffect(() => {
    setDraft(savedColor ?? null);
  }, [savedColor]);

  const save = async () => {
    if (draft === null) return;
    try {
      setSubmitting(true);
      await colorSettingRepository.save({
        target_type: targetType,
        target_id: targetId,
        screen,
        color: draft,
      });
      await onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const clear = async () => {
    if (!setting) return;
    try {
      setSubmitting(true);
      await colorSettingRepository.delete(setting.id);
      await onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "解除に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${screen} の背景色`}
          value={draft ?? PICKER_PLACEHOLDER}
          onChange={(e) => setDraft(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border bg-background p-1"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={submitting || draft === null || draft === savedColor}
          onClick={save}
        >
          保存
        </Button>
        {setting && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={submitting}
            onClick={clear}
          >
            解除
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{savedColor ?? "未設定"}</p>
    </div>
  );
}
