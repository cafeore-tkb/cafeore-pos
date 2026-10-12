import type { CaosCard, CaosOrderInput } from "@cafeore/common";
import { useEffect, useLayoutEffect, useRef } from "react";
import { orderNoLabel } from "../logic/cards";
import type { CommentsByOrder } from "../logic/comments";
import type { Lane } from "../logic/lanes";
import { findOrder, focusCard } from "../logic/search";

/** 入れられる番号の桁 */
const MAX_DIGITS = 4;

/** 番号の検索のキー（数字の 1 文字か、1 文字消す "back"・全部消す "clear"） */
export type SearchKey = string;

// 入力欄（緊急の番号・担当者の名前など）で打っているキーは拾わない
const typingIn = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(target.closest("input, textarea, select, [contenteditable='true']"));

/**
 * 注文番号の検索（ヘッダーの「番号」と右のパネル）。入れている番号（digits。閉じていれば null）は開いているパネル（useBoardSelection）が持ち、
 * ここは押したキーで番号を変え、その注文を探す。見つかった注文は選んだ状態にし（selectOrder。盤面にカードがあるときだけ）、
 * そのカードを見せる（タイムラインのカードは showOnTimeline でスクロール、未割当のカードは未割当の帯の中でスクロール）。
 * 選ぶのは番号を変えたときだけ（毎秒の時計やほかの端末の書き込みでは選び直さない）。
 * キーボード（テンキー）の数字は、入力欄の外ならいつでも検索を開いて入れる。開いているあいだは Backspace で 1 文字消し、Enter・Esc で閉じる
 */
export const useOrderSearch = ({
  digits,
  open,
  setDigits,
  close,
  selectOrder,
  showOnTimeline,
  ...board
}: {
  digits: string | null;
  /** 検索を開いて番号を入れる */
  open: (digits: string) => void;
  setDigits: (update: (digits: string) => string) => void;
  close: () => void;
  /** 注文を選ぶ（orderLabel。null で外す） */
  selectOrder: (label: string | null) => void;
  /** 管制盤 A のタイムラインをカード（key）までスクロールする */
  showOnTimeline: (cardKey: string) => void;
  orders: readonly CaosOrderInput[];
  cards: readonly CaosCard[];
  lanes: readonly Lane[];
  comments: CommentsByOrder;
  nowMs: number;
}) => {
  const orderNo = digits ? Number(digits) : null;
  const found = orderNo === null ? null : findOrder({ ...board, orderNo });
  const target = found && focusCard(found);
  // 見せる注文とカード。変わったときだけ見せ直す
  const targetId =
    found && target ? `${found.orderNo}\u0000${target.key}` : null;

  const press = (key: SearchKey) => {
    if (key === "clear") setDigits(() => "");
    else if (key === "back") setDigits((value) => value.slice(0, -1));
    else
      setDigits((value) =>
        value.length < MAX_DIGITS ? `${value}${key}`.replace(/^0+/, "") : value,
      );
  };

  const latest = useRef({ found, target, press, open, close, digits });
  const show = useRef({ selectOrder, showOnTimeline });
  useLayoutEffect(() => {
    latest.current = { found, target, press, open, close, digits };
    show.current = { selectOrder, showOnTimeline };
  });

  // 番号が変わって見つかったら、その注文を選んで見せる（見せるカードが替わったとき（抽出が終わって次のカードになった、など）も見せ直す）。
  // 開いたまま番号を変えて、盤面に見せるカードが無くなったら（消した・無い番号）選んだ注文を外す（閉じたときは選んだままにする）
  useEffect(() => {
    const { found, target, digits } = latest.current;
    if (targetId === null || !found || !target) {
      if (digits !== null) show.current.selectOrder(null);
      return;
    }
    show.current.selectOrder(`#${orderNoLabel(found.orderNo)}`);
    if (target.status !== "unassigned") show.current.showOnTimeline(target.key);
    else
      document
        .querySelector(`[data-unassigned-uid="${CSS.escape(target.key)}"]`)
        ?.scrollIntoView({
          block: "nearest",
          inline: "center",
          behavior: "smooth",
        });
  }, [targetId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (typingIn(event.target)) return;
      const { digits, press, open, close } = latest.current;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        if (digits === null) open(event.key);
        else press(event.key);
        return;
      }
      if (digits === null) return;
      if (event.key === "Backspace") press("back");
      else if (event.key === "Enter" || event.key === "Escape") close();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return { found, press };
};
