import { createContext, useContext, useState } from "react";

/** 覚えた操作。ids はその操作で端末に残した（後ろで送る）操作の id（useCaosOutbox。通らなかったら忘れるのに使う） */
type LastAction = { label: string; ids: readonly string[] };

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
  (setLast: (action: LastAction) => void) =>
  (label: string, ids: readonly string[]) =>
    setLast({ label, ids });

/** 「直前の操作」に覚える。閲覧だけの画面（LastActionProvider が無い）では undefined */
export const useRememberAction = () => {
  const setLast = useContext(LastActionContext)?.setLast;
  return setLast && rememberWith(setLast);
};

// 「直前の操作」。この画面が最後にした操作（盤面の操作と、見出しの「交代」ですぐ替えた担当者）の名前を、次の操作をするまで出す
// （間違えたら、出ている操作の逆の操作で直す。画面のメモリだけ。ほかの端末の操作は出さない）
export const useLastAction = () => {
  const store = useContext(LastActionContext);
  if (!store) throw new Error("useLastAction は LastActionProvider の中で使う");
  const { last, setLast } = store;
  return {
    /** 出す操作の名前（「割当 #038 → 2nd」）。無ければ null */
    label: last?.label ?? null,
    remember: rememberWith(setLast),
    /** 忘れる。端末に残した操作（entry）を渡すと、覚えているのがその操作のときだけ（通らなかった・消した操作は出さない） */
    forget: (entry?: { id: string }) =>
      setLast((current) =>
        entry === undefined || current?.ids.includes(entry.id) ? null : current,
      ),
  };
};
