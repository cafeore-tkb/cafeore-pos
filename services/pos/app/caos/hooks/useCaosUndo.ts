import { useState } from "react";
import { toast } from "sonner";

// 操作のあと「1つ戻す」が押せる秒
const UNDO_SEC = 10;

/** 戻す処理。戻せたら true（断られたら理由を通知で出して false） */
export type UndoRun = () => boolean | Promise<boolean>;

// 「1つ戻す」。この画面が最後にした操作を 1 つだけ、UNDO_SEC 秒のあいだ覚える（画面のメモリだけ。再読み込みで消える）。
// nowMs は実時間の今（1 秒ごとに変わるので、残りの秒が数え下がる）。戻したら（断られても）忘れる。
export const useCaosUndo = (nowMs: number) => {
  const [last, setLast] = useState<{
    label: string;
    atMs: number;
    run: UndoRun;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const secondsLeft = last
    ? Math.min(UNDO_SEC, Math.ceil(UNDO_SEC - (nowMs - last.atMs) / 1000))
    : 0;
  const action = secondsLeft > 0 ? last : null;

  return {
    /** 戻せる操作の名前（「割当 #038 → 2nd」）。戻せなければ null */
    label: action?.label ?? null,
    /** 戻せる残りの秒 */
    secondsLeft,
    pending,
    /** 通った操作を覚える（前の操作は戻せなくなる） */
    remember: (label: string, run: UndoRun) =>
      setLast({ label, atMs: Date.now(), run }),
    forget: () => setLast(null),
    undo: () => {
      if (!action || pending) return;
      setPending(true);
      void Promise.resolve(action.run())
        .then((ok) => {
          if (ok) toast.success(`「${action.label}」を戻しました`);
        })
        .finally(() => {
          setPending(false);
          setLast((current) => (current === action ? null : current));
        });
    },
  };
};
