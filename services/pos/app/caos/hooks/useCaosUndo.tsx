import { createContext, useContext, useRef, useState } from "react";
import { toast } from "sonner";

// 操作のあと「1つ戻す」が押せる秒
const UNDO_SEC = 10;

/** 戻す処理。戻せたら true、断られたら理由を通知で出して false。"retry" なら覚えたままにする（もう一度押せる） */
export type UndoRun = () => UndoResult | Promise<UndoResult>;
type UndoResult = boolean | "retry";

// API の結果。断られたら理由を通知で出して false
export const succeeded = ({ error }: { error?: string }) => {
  if (error) toast.error(error);
  return !error;
};

/** 戻せない理由（@cafeore/common の caosUndoCups・caosLaneUndoBlock）を出す。結果がまだ届いていないだけなら覚えたままにする */
export const refuseUndo = ({
  error,
  arriving,
}: { error: string; arriving?: true }): UndoResult => {
  if (!arriving) return succeeded({ error });
  toast(error);
  return "retry";
};

type UndoEntry = { label: string; atMs: number; run: UndoRun };

// 覚えた操作。盤面（useCaosSession）と担当者（CaosLanesProvider）が同じものに覚えるよう、画面の外側の CaosUndoProvider が持つ
const CaosUndoContext = createContext<{
  last: UndoEntry | null;
  setLast: React.Dispatch<React.SetStateAction<UndoEntry | null>>;
} | null>(null);

export const CaosUndoProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [last, setLast] = useState<UndoEntry | null>(null);
  return (
    <CaosUndoContext.Provider value={{ last, setLast }}>
      {children}
    </CaosUndoContext.Provider>
  );
};

// 通った操作を覚える（前の操作は戻せなくなる）
const rememberWith =
  (setLast: (entry: UndoEntry) => void) => (label: string, run: UndoRun) =>
    setLast({ label, atMs: Date.now(), run });

/** 「1つ戻す」に覚える。閲覧だけの画面（CaosUndoProvider が無い）では undefined */
export const useRememberUndo = () => {
  const setLast = useContext(CaosUndoContext)?.setLast;
  return setLast && rememberWith(setLast);
};

// 「1つ戻す」。この画面が最後にした操作（盤面の操作と、見出しの「交代」ですぐ替えた担当者）を 1 つだけ、UNDO_SEC 秒のあいだ覚える（画面のメモリだけ。再読み込みで消える）。
// nowMs は実時間の今（1 秒ごとに変わるので、残りの秒が数え下がる）。戻したら（断られても）忘れる（結果がまだ届いていないときは覚えたまま）。
export const useCaosUndo = (nowMs: number) => {
  const store = useContext(CaosUndoContext);
  if (!store) throw new Error("useCaosUndo は CaosUndoProvider の中で使う");
  const { last, setLast } = store;
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
    remember: rememberWith(setLast),
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
