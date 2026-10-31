import { useEffect, useRef, useState } from "react";
import {
  type KeyCapture,
  cancelHeldKeys,
  captureKeyDown,
  captureKeyUp,
  capturedKey,
  emptyKeyCapture,
} from "~/components/functional/keyCapture";
import { Button } from "~/components/ui/button";
import { checkMenuKey, menuKeyPartLabel } from "~/lib/menuKey";
import { cn } from "~/lib/utils";

/**
 * メニューのキーを、実際に押して決める欄。開いている間に押したキーは、ページの操作には使わずに覚える。
 * 決めたキーはフォームのキー欄に入れるだけで、保存はフォームの「保存」で
 */
export function MenuKeyCapture({
  otherMenus,
  onCapture,
  onClose,
}: {
  /** 他のメニュー。同じキーは選べない */
  otherMenus: readonly { name: string; key: string }[];
  onCapture: (key: string) => void;
  onClose: () => void;
}) {
  const [capture, setCapture] = useState<KeyCapture>(emptyKeyCapture);
  const panelRef = useRef<HTMLDivElement>(null);
  const pressing = capture.held.size > 0;
  const key = capturedKey(capture);
  const check = key === null ? null : checkMenuKey(key, otherMenus);
  const canApply = key !== null && capture.error === null && check?.ok === true;

  // 「キーをキャプチャ」にフォーカスが残ると Enter・Space でまた押されるので、欄に移す
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    // 商品管理のシートは Esc で閉じる（document で聞いている）ので、それより先に window で聞いて、先へは渡さない
    const keydown = (event: KeyboardEvent) => {
      event.stopPropagation();
      // Space のスクロールや Tab のフォーカス移動などはさせない。Ctrl・⌘ との組（再読み込みなど）はブラウザに任せる
      if (!event.ctrlKey && !event.metaKey) event.preventDefault();
      if (event.key === "Escape") {
        onClose();
        return;
      }
      setCapture((current) => captureKeyDown(current, event));
    };
    const keyup = (event: KeyboardEvent) => {
      event.stopPropagation();
      // Space で押したボタンは離したときに押される
      event.preventDefault();
      setCapture((current) => captureKeyUp(current, event));
    };
    const blur = () => setCapture(cancelHeldKeys);
    window.addEventListener("keydown", keydown, { capture: true });
    window.addEventListener("keyup", keyup, { capture: true });
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keydown, { capture: true });
      window.removeEventListener("keyup", keyup, { capture: true });
      window.removeEventListener("blur", blur);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="grid gap-3 rounded-md border border-primary bg-muted/40 p-3 outline-none ring-2 ring-primary/20"
    >
      <p className="text-muted-foreground text-xs">
        レジで使うキーボード（キーパッド）のキーを押して離します。同時押しは、押したまま次のキーを押してから全部離します。Shift
        と一緒に押すと記号（* など）や大文字になります。Ctrl・⌘
        と一緒に押したキーは使えません
      </p>
      <div className="flex min-h-12 items-center">
        {capture.keys.length === 0 ? (
          <span className="animate-pulse text-muted-foreground">
            キーを押してください…
          </span>
        ) : (
          <KeyLabel parts={capture.keys} active={pressing} />
        )}
      </div>
      <p aria-live="polite" className="min-h-5 text-sm">
        {pressing ? (
          <span className="text-muted-foreground">
            押しています。全部離すと決まります
          </span>
        ) : capture.error ? (
          <span className="text-destructive">{capture.error}</span>
        ) : check && !check.ok ? (
          <span className="text-destructive">{check.message}</span>
        ) : check?.ok && check.warning ? (
          <span className="text-amber-700">{check.warning}</span>
        ) : check?.ok ? (
          <span className="text-muted-foreground">
            このキーにできます。違うときはもう一度押し直してください
          </span>
        ) : null}
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          やめる（Esc）
        </Button>
        <Button
          type="button"
          disabled={!canApply}
          onClick={() => {
            if (key === null) return;
            onCapture(key);
            onClose();
          }}
        >
          このキーにする
        </Button>
      </div>
    </div>
  );
}

/** キーの札。同時押しは + でつなぐ */
function KeyLabel({
  parts,
  active,
}: {
  parts: readonly string[];
  /** 押している間 */
  active: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2 font-mono text-2xl">
      {parts.map((part, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: 同時押しのキーの並びは変わらない
          key={index}
          className="inline-flex items-center gap-2"
        >
          {index > 0 && <span className="text-muted-foreground">+</span>}
          <kbd
            className={cn(
              "rounded border bg-background px-3 py-1 font-semibold",
              active && "border-primary bg-primary text-primary-foreground",
            )}
          >
            {menuKeyPartLabel(part)}
          </kbd>
        </span>
      ))}
    </span>
  );
}
