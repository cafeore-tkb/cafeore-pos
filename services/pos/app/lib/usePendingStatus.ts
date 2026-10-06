import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type Pending<V> = {
  value: V;
  // 応答が返ったか。返るまでは同じキーを押せなくする
  settled: boolean;
  seq: number;
};

/**
 * 状態の切り替えは、API の応答と WebSocket の配信を待ってから画面に出るので、押してから表示が変わるまで間がある。
 * 押した時点で切り替え後の値を先に表示し、応答が返るまでは同じものを押せなくしてダブルタップを防ぐ。
 *
 * 応答が返ったら応答の値を表示し、次に注文が配信されたら（`source` が変わったら）配信の値に戻す。
 */
export const usePendingStatus = <V>(source: unknown) => {
  const [pending, setPending] = useState<Record<string, Pending<V>>>({});
  const seq = useRef(0);

  useEffect(() => {
    // 配信が届くたびに source が作り直されるので、応答済みのものは配信の値に任せる
    void source;
    setPending((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([, p]) => !p.settled),
      );
      return Object.keys(next).length === Object.keys(prev).length
        ? prev
        : next;
    });
  }, [source]);

  /** 表示する値。押した直後なら切り替え後の値を返す */
  const statusOf = (key: string, actual: V) => pending[key]?.value ?? actual;

  /** 応答待ちで押せないか */
  const isBusy = (key: string) => pending[key]?.settled === false;

  /**
   * `predicted` を先に表示して `request` を送る。
   * `request` は切り替え後の値（取れなければ undefined）を返す。
   */
  const run = useCallback(
    async (
      key: string,
      predicted: V,
      request: () => Promise<V | undefined>,
    ) => {
      seq.current += 1;
      const mySeq = seq.current;
      setPending((prev) => ({
        ...prev,
        [key]: { value: predicted, settled: false, seq: mySeq },
      }));
      // 後から同じキーを切り替えていたら、古い応答では上書きしない
      const settle = (next: (p: Pending<V>) => Pending<V> | null) =>
        setPending((prev) => {
          const p = prev[key];
          if (p?.seq !== mySeq) return prev;
          const { [key]: _, ...rest } = prev;
          const updated = next(p);
          return updated ? { ...rest, [key]: updated } : rest;
        });
      try {
        const actual = await request();
        settle((p) => ({ ...p, value: actual ?? p.value, settled: true }));
      } catch (e) {
        console.error(e);
        settle(() => null);
        toast.error("更新できませんでした。もう一度押してください");
      }
    },
    [],
  );

  return { statusOf, isBusy, run };
};
