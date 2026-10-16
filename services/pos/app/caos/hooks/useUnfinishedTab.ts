import type { CaosCard, CaosOrderInput } from "@cafeore/common";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { labelHasOrder } from "../logic/cards";
import { type CommentsByOrder, commentKey } from "../logic/comments";
import type { Lane } from "../logic/lanes";
import {
  type UnfinishedSeen,
  markSeen,
  unfinishedOrders,
  unseenAlerts,
} from "../logic/unfinished";
import { useDeviceSetting } from "./useDeviceSetting";

/** 未割当の欄のタブ（未割当のカード・未完了の注文） */
export type UnassignedTab = "unassigned" | "unfinished";

const NOTHING_SEEN: UnfinishedSeen = { late: [], comments: [] };

// 端末に覚えた見た印（形が違えば何も見ていないことにする）
const validSeen = (seen: UnfinishedSeen): UnfinishedSeen =>
  Array.isArray(seen.late) && Array.isArray(seen.comments)
    ? seen
    : NOTHING_SEEN;

/**
 * 未割当の欄のタブと、未完了の注文（logic/unfinished）と、「未完了」のタブの件数の印（まだ見ていない 15 分超の注文と新しいコメント）。
 * 「未完了」を開いているあいだは、出ているものをみな見たことにする。右下などでその注文のコメントを見ている（viewedLabel）ときは、そのコメントも見たことにする。
 * 見た印はこの端末にだけ覚える（localStorage。開き直しても残る）
 */
export const useUnfinishedTab = ({
  orders,
  cards,
  lanes,
  comments,
  nowMs,
  practice,
  viewedLabel,
}: {
  /** 本番は POS の注文、実データテスト中は届いた練習の注文 */
  orders: readonly CaosOrderInput[];
  cards: readonly CaosCard[];
  lanes: readonly Lane[];
  comments: CommentsByOrder | null;
  nowMs: number;
  /** 実データテスト中 */
  practice: boolean;
  /** 右下などでコメントを見ている注文（orderLabel） */
  viewedLabel: string | null;
}) => {
  const rows = useMemo(
    () => unfinishedOrders({ orders, cards, lanes, comments, nowMs, practice }),
    [orders, cards, lanes, comments, nowMs, practice],
  );
  const [tab, setTab] = useState<UnassignedTab>("unassigned");
  const [stored, setSeen] = useDeviceSetting<UnfinishedSeen>(
    "caos-unfinished-seen",
    NOTHING_SEEN,
  );
  const seen = validSeen(stored);
  const unseen = unseenAlerts(rows, seen);
  const open = tab === "unfinished";
  const viewedKeys = new Set(
    rows
      .filter((row) => labelHasOrder(viewedLabel, row.orderNo))
      .flatMap((row) => row.comments.map(commentKey)),
  );
  const toMark: UnfinishedSeen = open
    ? unseen
    : {
        late: [],
        comments: unseen.comments.filter((key) => viewedKeys.has(key)),
      };
  // 見たことにするものが変わったときだけ書く（書いたら空になる）。書くときは今の値で
  const marking = [...toMark.late, ...toMark.comments].join("\n");
  const write = () => setSeen(markSeen(rows, seen, toMark));
  const latestWrite = useRef(write);
  useLayoutEffect(() => {
    latestWrite.current = write;
  });
  useEffect(() => {
    if (marking) latestWrite.current();
  }, [marking]);
  return {
    tab,
    onSelectTab: setTab,
    /** 未完了の注文（注文番号の順） */
    rows,
    /** 「未完了」のタブの印の件数（開いているあいだは 0） */
    badge: open ? 0 : unseen.late.length + unseen.comments.length,
  };
};
