import {
  type CaosCupsWrite,
  buildCaosCards,
  jstDate,
  nextCaosDripper,
  putCaosCups,
} from "@cafeore/common";
import { useMemo, useRef } from "react";
import { toast } from "sonner";
import { usePosOrders } from "./usePosOrders";

// API の結果。断られたら理由を通知で出して false
const succeeded = ({ error }: { error?: string }) => {
  if (error) toast.error(error);
  return !error;
};

// cafeore-pos の注文で動かす盤面（本番）。盤面は注文のカップの列（ドリッパー・順番・カード・抽出の時刻）で持つので、
// 共有の WebSocket の注文から今日（日本時間）のカードを組み立てる（@cafeore/common の buildCaosCards）。
// 操作はカップに書く（PUT /api/caos/cups・「次へ」）。書いた注文は全部の画面に配られるので、複数の iPad で同じものを見て操作できる。
// 結果は書いた注文の配信で届く。断られたら（決まりに合わない・ほかの端末が先に書いた）理由を POS の通知（sonner）で出す。
// enabled が false（実データテスト中）のときは注文を読まない。
export const useLiveBoard = ({
  enabled,
  nowMs,
}: {
  enabled: boolean;
  nowMs: number;
}) => {
  const { orders, status } = usePosOrders(enabled);
  const today = jstDate(nowMs);
  const cards = useMemo(
    () => buildCaosCards(orders ?? [], today),
    [orders, today],
  );
  // 「次へ」を送っている途中の列（応答が届く前の二度押しを止める）
  const pendingNext = useRef(new Set<number>());

  return {
    status,
    cards,
    /** 書き込みを送る。API が書けたら true になる */
    runWrites: (writes: CaosCupsWrite[]) => putCaosCups(writes).then(succeeded),
    /** 「次へ」を送る。dripId は画面が抽出中と見ているカード。API が書けたら true になる（二度押しは送らずに false） */
    runNext: (dripper: number, dripId: string | null) => {
      if (pendingNext.current.has(dripper)) return false;
      pendingNext.current.add(dripper);
      return nextCaosDripper(dripper, dripId)
        .then(succeeded)
        .finally(() => pendingNext.current.delete(dripper));
    },
  };
};
