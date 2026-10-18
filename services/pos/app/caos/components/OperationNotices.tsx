import { X } from "lucide-react";
import { type ToastT, toast, useSonner } from "sonner";
import { useFloatingWindow } from "./FloatingWindows";

/** CaOSではPOS共通の通知も同じ移動・非表示・確認済みの操作にそろえる。 */
export function OperationNotices() {
  const { toasts } = useSonner();
  return (
    <div
      data-caos-layer
      className="pointer-events-none fixed right-2 bottom-2 z-[210] flex max-h-[80vh] w-[360px] max-w-[95vw] flex-col gap-2 overflow-y-auto"
    >
      {toasts
        .filter((item) => !item.delete)
        .map((item) => (
          <OperationNotice key={item.id} notice={item} />
        ))}
    </div>
  );
}
function OperationNotice({ notice }: { notice: ToastT }) {
  const title =
    typeof notice.title === "function" ? notice.title() : notice.title;
  const description =
    typeof notice.description === "function"
      ? notice.description()
      : notice.description;
  const floating = useFloatingWindow(
    typeof title === "string" ? title : "操作の通知",
  );
  const finish = () => {
    notice.onDismiss?.(notice);
    toast.dismiss(notice.id);
  };
  return (
    <section
      ref={(element) => {
        floating.ref.current = element;
      }}
      style={floating.style}
      data-popup-hidden={floating.hidden}
      aria-live="polite"
      className="pointer-events-auto rounded-xl border-2 border-amber-300 bg-white p-3 text-slate-950 shadow-xl"
    >
      <header className="flex items-center gap-1">
        {floating.handle}
        <div className="min-w-0 flex-1 font-bold">{title}</div>
        <button
          type="button"
          onClick={floating.hide}
          aria-label="操作の通知を非表示"
          className="h-10 w-10 shrink-0"
        >
          <X className="h-5 w-5" />
        </button>
      </header>
      {description && <div className="mt-2 text-sm">{description}</div>}
      {notice.jsx}
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {notice.action &&
        typeof notice.action === "object" &&
        "onClick" in notice.action ? (
          <button
            type="button"
            className="min-h-11 rounded border px-3 font-bold"
            onClick={(event) => {
              if (
                notice.action &&
                typeof notice.action === "object" &&
                "onClick" in notice.action
              )
                notice.action.onClick(event);
              finish();
            }}
          >
            {notice.action.label}
          </button>
        ) : (
          notice.action
        )}
        {notice.cancel &&
        typeof notice.cancel === "object" &&
        "onClick" in notice.cancel ? (
          <button
            type="button"
            className="min-h-11 rounded border px-3 font-bold"
            onClick={(event) => {
              if (
                notice.cancel &&
                typeof notice.cancel === "object" &&
                "onClick" in notice.cancel
              )
                notice.cancel.onClick(event);
              finish();
            }}
          >
            {notice.cancel.label}
          </button>
        ) : (
          notice.cancel
        )}
        <button
          type="button"
          onClick={finish}
          className="min-h-11 rounded border px-3 font-bold"
        >
          確認済み
        </button>
      </div>
    </section>
  );
}
