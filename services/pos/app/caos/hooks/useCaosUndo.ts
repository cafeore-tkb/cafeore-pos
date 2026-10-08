import {
  type CaosOrderInput,
  type CaosUndoEntry,
  caosObservedCups,
  resolveUndo,
  undoCaosCups,
} from "@cafeore/common";
import { useCallback, useRef, useState } from "react";

// 「1つ戻す」。この画面（この iPad の /master-sheet）が最後にした CaOS の操作を 1 つだけ覚える（画面のメモリだけ。再読み込みで消える）。
// 戻すときは、その操作で自分が書いた値のときだけ書き戻す（サーバーが確かめる）。ほかの画面（ほかの iPad・マスター・提供）が
// あとで同じカップを変えていたら断られ、その理由を出す。ほかの画面の操作は戻さない。

/** 戻す処理。操作の種類ごとに作る（カップを書いた操作は rememberCups、それ以外は remember にそのまま渡す） */
export interface CaosUndoAction {
  /** 画面に出す名前（「次へ（3番）」など） */
  label: string;
  /** 戻す。断られたら理由（error）を返す。retry なら、もう一度押せる（つながらない、など） */
  run: () => Promise<{ error?: string; retry?: boolean }>;
}

export const useCaosUndo = (orders: readonly CaosOrderInput[] | null) => {
  // 戻すときは、押したときに届いている注文（カップの今の値）を使う
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const [last, setLast] = useState<CaosUndoAction | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  /** 最後の操作を覚える（null なら、最後の操作は戻せないので、前の操作も戻さない） */
  const remember = useCallback(
    (action: CaosUndoAction | null) => setLast(action),
    [],
  );

  /** カップを書いた操作（割当・移動・先頭へ・未割当に戻す・統合・次へ）を覚える */
  const rememberCups = useCallback(
    (entry: CaosUndoEntry | null) =>
      setLast(
        entry && {
          label: entry.label,
          run: async () => {
            const resolved = resolveUndo(
              entry,
              caosObservedCups(ordersRef.current ?? []),
            );
            if ("error" in resolved)
              return { error: resolved.error, retry: false };
            return undoCaosCups(resolved.cups);
          },
        },
      ),
    [],
  );

  /** 最後の操作を戻す。断られたら理由を返す */
  const undo = async (): Promise<string | null> => {
    const action = last;
    if (!action || pendingRef.current) return null;
    pendingRef.current = true;
    setPending(true);
    try {
      const { error, retry } = await action.run();
      // 戻せた・もう戻せない（ほかの画面が変えた）なら忘れる。そのあいだに次の操作をしていたら、そちらを残す
      if (!error || !retry)
        setLast((current) => (current === action ? null : current));
      return error ?? null;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return { label: last?.label ?? null, pending, remember, rememberCups, undo };
};
