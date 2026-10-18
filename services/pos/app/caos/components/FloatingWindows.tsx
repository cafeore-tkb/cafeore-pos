import { GripHorizontal, PanelsTopLeft } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

type Entry = { title: string; restore: () => void };
const WindowsContext = createContext<{
  entries: Record<string, Entry>;
  update: (id: string, entry: Entry | null) => void;
} | null>(null);
const ScopeContext = createContext<{
  active: boolean;
  activate: () => void;
  suspend?: () => void;
} | null>(null);
export const FloatingWindowScope = ScopeContext.Provider;

export function FloatingWindowsProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const update = useCallback((id: string, entry: Entry | null) => {
    setEntries((old) => {
      const next = { ...old };
      if (entry) next[id] = entry;
      else delete next[id];
      return next;
    });
  }, []);
  return (
    <WindowsContext.Provider value={{ entries, update }}>
      {children}
    </WindowsContext.Provider>
  );
}

/** 元の起動ボタンからも、下書きを保持して非表示のウィンドウを戻す。 */
export function useRestoreFloatingWindow() {
  const manager = useContext(WindowsContext);
  return (title: string) => {
    for (const entry of Object.values(manager?.entries ?? {})) {
      if (entry.title === title) entry.restore();
    }
  };
}

/** 隠した画面はアンマウントしない。入力・確認内容は解決するまで部品自身が保持する。 */
export function useFloatingWindow(title: string, enabled = true) {
  const manager = useContext(WindowsContext);
  const scope = useContext(ScopeContext);
  const id = useId();
  const ref = useRef<HTMLElement | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled) setHidden(false);
  }, [enabled]);
  const scopeActive = scope?.active;
  useEffect(() => {
    if (scopeActive) setHidden(false);
  }, [scopeActive]);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const latest = useRef(scope);
  latest.current = scope;
  const restore = useCallback(() => {
    latest.current?.activate();
    setHidden(false);
  }, []);
  const hide = useCallback(() => {
    latest.current?.suspend?.();
    setHidden(true);
  }, []);
  const isHidden = hidden || scope?.active === false;
  const update = manager?.update;
  useEffect(() => {
    update?.(id, enabled && isHidden ? { title, restore } : null);
    return () => update?.(id, null);
  }, [id, title, isHidden, restore, update, enabled]);
  const drag = useRef<{ x: number; y: number; rect: DOMRect } | null>(null);
  const clamp = useCallback(
    (left: number, top: number, width: number, height: number) => {
      const nextWidth = Math.min(width, window.innerWidth);
      const nextHeight = Math.min(height, (window.innerHeight - 56) * 0.85);
      return {
        left: Math.max(0, Math.min(left, window.innerWidth - nextWidth)),
        top: Math.max(56, Math.min(top, window.innerHeight - nextHeight)),
        width: nextWidth,
        height: nextHeight,
      };
    },
    [],
  );
  useEffect(() => {
    const resize = () =>
      setPosition((old) =>
        old ? clamp(old.left, old.top, old.width, old.height) : null,
      );
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [clamp]);
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !ref.current) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      rect: ref.current.getBoundingClientRect(),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handle = (
    <button
      type="button"
      aria-label={`${title}を移動`}
      title="ドラッグして移動・矢印キーで移動"
      className="flex h-10 w-10 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-slate-500 hover:bg-slate-200 active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        setPosition(
          clamp(
            start.rect.left + event.clientX - start.x,
            start.rect.top + event.clientY - start.y,
            start.rect.width,
            start.rect.height,
          ),
        );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const direction = {
          ArrowLeft: [-16, 0],
          ArrowRight: [16, 0],
          ArrowUp: [0, -16],
          ArrowDown: [0, 16],
        }[event.key];
        if (!direction || !ref.current) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = ref.current.getBoundingClientRect();
        setPosition(
          clamp(
            rect.left + direction[0],
            rect.top + direction[1],
            rect.width,
            rect.height,
          ),
        );
      }}
    >
      <GripHorizontal className="h-5 w-5" />
    </button>
  );
  const style: CSSProperties = isHidden
    ? { display: "none" }
    : position
      ? {
          position: "fixed",
          left: position.left,
          top: position.top,
          width: position.width,
          maxHeight: window.innerHeight - position.top,
          right: "auto",
          bottom: "auto",
          margin: 0,
          transform: "none",
          overflowY: "auto",
        }
      : {};
  return {
    ref,
    hidden: isHidden,
    hide,
    restore,
    handle,
    style,
  };
}

export function FloatingWindowTray() {
  const manager = useContext(WindowsContext);
  if (!manager || !Object.keys(manager.entries).length) return null;
  return (
    <div
      data-caos-layer
      data-popup-tray
      className="flex min-w-12 max-w-[20vw] shrink items-center gap-1 overflow-x-auto"
      aria-label="非表示の未完了パネル"
    >
      {Object.entries(manager.entries).map(([id, entry]) => (
        <button
          key={id}
          type="button"
          onClick={entry.restore}
          title={`${entry.title}を再表示`}
          aria-label={`${entry.title}を再表示`}
          className="flex h-11 w-12 shrink-0 touch-manipulation flex-col items-center justify-center rounded-lg border-2 border-amber-400 bg-amber-50 text-amber-900"
        >
          <PanelsTopLeft className="h-4 w-4" />
          <span className="max-w-full truncate px-0.5 text-[9px]">
            {entry.title}
          </span>
        </button>
      ))}
    </div>
  );
}

/** 接続エラー・未送信など、内容自身が解決時に消える通知の共通枠。 */
export function FloatingStatusNotices({
  children,
  active,
}: { children: ReactNode; active: boolean }) {
  const floating = useFloatingWindow("接続・未送信・印刷", active);
  return (
    <section
      data-caos-layer
      data-popup-hidden={floating.hidden}
      ref={(element) => {
        floating.ref.current = element;
      }}
      style={floating.style}
      className={`absolute top-full right-2 z-[160] mt-1 flex max-w-[95vw] flex-col gap-1 ${active ? "rounded-lg border-2 border-red-300 bg-white p-1.5 shadow-lg" : ""}`}
    >
      {active && (
        <header className="flex items-center gap-1 pl-1 font-bold text-sm">
          {floating.handle}
          <span className="min-w-0 flex-1">接続・未送信・印刷</span>
          <button
            type="button"
            onClick={floating.hide}
            aria-label="接続・未送信・印刷の通知を非表示"
            className="h-10 w-10 shrink-0"
          >
            ×
          </button>
        </header>
      )}
      {children}
    </section>
  );
}
