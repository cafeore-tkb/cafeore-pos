import { createContext, useContext, useState } from "react";

// 「直前の操作」をヘッダーに出す秒（間違えたら、出ている操作の逆の操作で直す）
const LAST_ACTION_SEC = 30;

type LastAction = { label: string; atMs: number };

// 覚えた操作。盤面（useCaosSession）と担当者（CaosLanesProvider）が同じものに覚えるよう、画面の外側の LastActionProvider が持つ
const LastActionContext = createContext<{
  last: LastAction | null;
  setLast: React.Dispatch<React.SetStateAction<LastAction | null>>;
} | null>(null);

export const LastActionProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [last, setLast] = useState<LastAction | null>(null);
  return (
    <LastActionContext.Provider value={{ last, setLast }}>
      {children}
    </LastActionContext.Provider>
  );
};

// 通った操作を覚える（前の操作は出さなくなる）
const rememberWith =
  (setLast: (action: LastAction) => void) => (label: string) =>
    setLast({ label, atMs: Date.now() });

/** 「直前の操作」に覚える。閲覧だけの画面（LastActionProvider が無い）では undefined */
export const useRememberAction = () => {
  const setLast = useContext(LastActionContext)?.setLast;
  return setLast && rememberWith(setLast);
};

// 「直前の操作」。この画面が最後にした操作（盤面の操作と、見出しの「交代」ですぐ替えた担当者）の名前を LAST_ACTION_SEC 秒のあいだ出す
// （画面のメモリだけ。ほかの端末の操作は出さない）。nowMs は実時間の今（1 秒ごとに変わる）
export const useLastAction = (nowMs: number) => {
  const store = useContext(LastActionContext);
  if (!store) throw new Error("useLastAction は LastActionProvider の中で使う");
  const { last, setLast } = store;
  const shown = last && nowMs - last.atMs < LAST_ACTION_SEC * 1000;
  return {
    /** 出す操作の名前（「割当 #038 → 2nd」）。無ければ null */
    label: shown ? last.label : null,
    remember: rememberWith(setLast),
    /** 忘れる。label を渡すと、覚えているのがその操作のときだけ（通らなかった操作は出さない） */
    forget: (label?: string) =>
      setLast((current) =>
        label === undefined || current?.label === label ? null : current,
      ),
  };
};
