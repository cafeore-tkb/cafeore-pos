import { createContext, useContext, useRef, useState } from "react";
import { toast } from "sonner";
import { useCurrentTime } from "~/components/functional/useCurrentTime";

// 操作のあと「1つ戻す」が押せる秒
const UNDO_SEC = 10;

/** 戻す処理。戻せたら true、断られたら理由を通知で出して false。"retry" なら覚えたままにする（もう一度押せる） */
export type UndoRun = () => UndoResult | Promise<UndoResult>;
type UndoResult = boolean | "retry";

// 「1つ戻す」。この画面が最後にした操作（盤面の操作と、見出しの「交代」ですぐ替えた担当者）を 1 つだけ、UNDO_SEC 秒のあいだ覚える
// （画面のメモリだけ。再読み込みで消える）。盤面（useCaosSession）と担当者（CaosLanesProvider）が同じものに覚えるよう、画面の外側の CaosUndoProvider が持つ。
// nowMs は実時間の今（1 秒ごとに変わるので、残りの秒が数え下がる）。戻したら（断られても）忘れる（結果がまだ届いていないときは覚えたまま）。
const useUndoState = (nowMs: number) => {
  const [last, setLast] = useState<{
    label: string;
    atMs: number;
    run: UndoRun;
  } | null>(null);
  const [pending, setPending] = useState(false);
  // 二度押し（画面が変わる前に続けて押した）で 2 回送らない
  const running = useRef(false);
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
      if (!action || running.current) return;
      running.current = true;
      setPending(true);
      void Promise.resolve(action.run())
        .then((result) => {
          if (result === true) toast.success(`「${action.label}」を戻しました`);
          if (result !== "retry")
            setLast((current) => (current === action ? null : current));
        })
        .finally(() => {
          running.current = false;
          setPending(false);
        });
    },
  };
};

type CaosUndo = ReturnType<typeof useUndoState>;

/** 閲覧だけの画面には無い（null） */
export const CaosUndoContext = createContext<CaosUndo | null>(null);

export const CaosUndoProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const value = useUndoState(useCurrentTime(1000).getTime());
  return (
    <CaosUndoContext.Provider value={value}>
      {children}
    </CaosUndoContext.Provider>
  );
};

export const useCaosUndo = () => {
  const value = useContext(CaosUndoContext);
  if (!value) throw new Error("useCaosUndo は CaosUndoProvider の中で使う");
  return value;
};
