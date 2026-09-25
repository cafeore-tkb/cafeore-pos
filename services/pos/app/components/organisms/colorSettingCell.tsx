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
  // 未設定のときに実際に使われる色の説明（例: タイプの色、既定の色）
  fallbackLabel: string;
  fallbackColor?: string;
  onChanged: () => Promise<unknown>;
};

export function ColorSettingCell({
  targetType,
  targetId,
  screen,
  setting,
  fallbackLabel,
  fallbackColor,
  onChanged,
}: Props) {
  const [draft, setDraft] = useState(
    setting?.color ?? fallbackColor ?? "#ffffff",
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (setting) setDraft(setting.color);
  }, [setting]);

  const save = async () => {
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
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border bg-background p-1"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={submitting || draft === setting?.color}
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
      <p className="flex items-center gap-1 text-muted-foreground text-xs">
        {setting ? (
          setting.color
        ) : (
          <>
            {fallbackColor && (
              <span
                className="inline-block h-3 w-3 rounded-sm border"
                style={{ backgroundColor: fallbackColor }}
              />
            )}
            未設定（{fallbackLabel}）
          </>
        )}
      </p>
    </div>
  );
}
