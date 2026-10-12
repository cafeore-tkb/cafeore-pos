import type { CaosCard, CaosOrderInput } from "@cafeore/common";
import { useEffect, useLayoutEffect, useRef } from "react";
import { orderNoLabel } from "../logic/cards";
import type { CommentsByOrder } from "../logic/comments";
import type { Lane } from "../logic/lanes";
import { findOrder, focusCard } from "../logic/search";

/** 入れられる番号の桁 */
const MAX_DIGITS = 4;

// 番号に数字を 1 つ足す（頭の 0 は入れない。MAX_DIGITS 桁まで）
const appendDigit = (value: string, digit: string) =>
  value.length < MAX_DIGITS ? `${value}${digit}`.replace(/^0+/, "") : value;

// 番号を押す前にフォーカスしていたボタン（指で押した「次へ」など）を、あとの Enter で押さないように外す
const blurFocus = () => {
  if (document.activeElement instanceof HTMLElement)
    document.activeElement.blur();
};

// 入力欄（緊急の番号・担当者の名前など）で打っているキーと、ダイアログ（交代など）を開いているあいだのキーは拾わない
const ignoreKey = (event: KeyboardEvent) =>
  event.metaKey ||
  event.ctrlKey ||
  event.altKey ||
  (event.target instanceof HTMLElement &&
    Boolean(
      event.target.closest("input, textarea, select, [contenteditable='true']"),
    )) ||
  Boolean(
    document.querySelector(
      "dialog[open], [role='dialog'], [role='alertdialog']",
    ),
  );

/**
 * 注文番号の検索（ヘッダーの「番号」と右のパネル）。入れている番号（digits。閉じていれば null）は開いているパネル（useBoardSelection）が持ち、
 * ここは押したキーで番号を変え、その注文を探す。見つかった注文は選んだ状態にし（selectOrder。盤面にカードがあるときだけ）、
 * そのカードを見せる（タイムラインのカードは showOnTimeline でスクロール、未割当のカードは未割当の帯の中でスクロール）。
 * 選ぶのは番号を変えたときだけ（毎秒の時計やほかの端末の書き込みでは選び直さない）。
 * キーボード（テンキー）の数字は、入力欄の外ならいつでも検索を開いて入れる（ダイアログを開いているあいだは拾わない）。
 * 開いているあいだは Backspace で 1 文字消し、Enter・Esc で閉じる（番号を押すとフォーカスを外し、そのあと Tab で選んだボタンの上の Enter はそのボタンを押す）
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
  comments: CommentsByOrder | null;
  nowMs: number;
}) => {
  const orderNo = digits ? Number(digits) : null;
  const found = orderNo === null ? null : findOrder({ ...board, orderNo });
  const target = found && focusCard(found);
  // 見せる注文とカード。変わったときだけ見せ直す
  const targetId =
    found && target ? `${found.orderNo}\u0000${target.key}` : null;

  /** テンキーを押す（数字の 1 文字か、1 文字消す "back"・全部消す "clear"） */
  const press = (key: string) => {
    blurFocus();
    if (key === "clear") setDigits(() => "");
    else if (key === "back") setDigits((value) => value.slice(0, -1));
    else setDigits((value) => appendDigit(value, key));
  };

  // 効果の中で読む今の値（効果は番号・キーで動かし、毎回は張り直さない）
  const current = {
    found,
    target,
    digits,
    press,
    open,
    close,
    selectOrder,
    showOnTimeline,
  };
  const latest = useRef(current);
  useLayoutEffect(() => {
    latest.current = current;
  });

  // 番号が変わって見つかったら、その注文を選んで見せる（見せるカードが替わったとき（抽出が終わって次のカードになった、など）も見せ直す）。
  // 開いたまま番号を変えて、盤面に見せるカードが無くなったら（消した・無い番号）選んだ注文を外す（閉じたときは選んだままにする）
  useEffect(() => {
    const { found, target, digits, selectOrder, showOnTimeline } =
      latest.current;
    if (targetId === null || !found || !target) {
      if (digits !== null) selectOrder(null);
      return;
    }
    selectOrder(`#${orderNoLabel(found.orderNo)}`);
    if (target.status !== "unassigned") showOnTimeline(target.key);
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
      if (ignoreKey(event)) return;
      const { digits, press, open, close } = latest.current;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        if (digits !== null) press(event.key);
        else {
          blurFocus();
          open(appendDigit("", event.key));
        }
        return;
      }
      if (digits === null) return;
      // ボタン・リンクの上の Enter は、そのボタンを押させる（番号を押すとフォーカスを外すので、そのあと Tab で選んだもの。通知の「表示」など）
      if (
        event.key === "Enter" &&
        event.target instanceof HTMLElement &&
        event.target.closest("button, a")
      )
        return;
      if (event.key === "Backspace") press("back");
      else if (event.key === "Escape" || event.key === "Enter") close();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return { found, press };
};
