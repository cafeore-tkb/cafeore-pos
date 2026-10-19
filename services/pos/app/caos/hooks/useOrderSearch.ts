import type { CaosCard, CaosOrderInput } from "@cafeore/common";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { orderNoLabel } from "../logic/cards";
import type { CommentsByOrder } from "../logic/comments";
import type { Lane } from "../logic/lanes";
import { findOrder, focusCard } from "../logic/search";
import { caosLog } from "../utils/log";
import { scrollCardIntoView } from "../utils/scrollToCard";
import { useCaosStateLog } from "./useCaosStateLog";

/** 入れられる番号の桁 */
const MAX_DIGITS = 4;
/** 番号を押し終えてから探すまで（ms）。「12」を打つ途中の「1」で選んだりスクロールしたりしない */
const SEARCH_DELAY_MS = 500;

// 押し出したあとの0は保持する。全部0になった場合だけ未入力に戻す。
const appendDigit = (value: string, digit: string) => {
  if (!value && digit === "0") return "";
  const next = `${value}${digit}`.slice(-MAX_DIGITS);
  return /^0+$/.test(next) ? "" : next;
};

// 番号を押す前にフォーカスしていたボタン（指で押したヘッダーのボタンなど）を、あとの Enter で押さないように外す
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
 * ここは押したキーで番号を変え、押し終えて SEARCH_DELAY_MS たったら（Enter ならすぐ）その注文を探す。見つかった注文は選んだ状態にし（selectOrder。盤面にカードがあるときだけ）、
 * そのカードを見せる（A のタイムラインのカードは showOnTimeline でスクロール、ほかは並べた枠の中でスクロール。utils/scrollToCard）。
 * 選ぶのは探す番号か管制盤（view）が変わったときだけ（毎秒の時計やほかの端末の書き込みでは選び直さない。開いたまま管制盤を替えたら、替えた先で見せ直す）。
 * キーボード（テンキー）の数字は、入力欄の外ならいつでも検索を開いて入れる（ダイアログを開いているあいだは拾わない）。
 * 開いているあいだは Backspace で 1 文字消し、Enter で待たずに探して閉じる（finish。× とパネルの外も同じ。番号が空なら選んだ注文を外す）。
 * Esc は待っている番号を探さずに閉じる（前に探した注文を選んだまま）。
 * 番号を押すとフォーカスを外し、そのあと Tab で選んだボタンの上の Enter はそのボタンを押す
 */
export const useOrderSearch = ({
  digits,
  open,
  setDigits,
  close,
  selectOrder,
  showOnTimeline,
  view,
  ...board
}: {
  digits: string | null;
  /** 検索を開いて番号を入れる */
  open: (digits: string) => void;
  setDigits: (update: (digits: string) => string) => void;
  close: () => void;
  /** 注文を選ぶ（orderLabel。null で外す） */
  selectOrder: (label: string | null) => void;
  /** 管制盤 A のタイムラインをカード（key）までスクロールする（タイムラインの無い C では渡さない） */
  showOnTimeline?: (cardKey: string) => void;
  /** 今の管制盤（替わったら見せ直す） */
  view: string;
  orders: readonly CaosOrderInput[];
  cards: readonly CaosCard[];
  lanes: readonly Lane[];
  comments: CommentsByOrder | null;
  nowMs: number;
}) => {
  // 探した番号（digits を押し終えてから入れる。閉じたら null）
  const [searched, setSearched] = useState(digits);
  useEffect(() => {
    if (digits === null) {
      setSearched(null);
      return;
    }
    const timer = window.setTimeout(() => setSearched(digits), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [digits]);
  const orderNo = searched ? Number(searched) : null;
  const found = orderNo === null ? null : findOrder({ ...board, orderNo });
  const target = found && focusCard(found);
  // 見せる注文とカードと管制盤。変わったときだけ見せ直す
  const targetId =
    found && target ? `${found.orderNo}\u0000${target.key}\u0000${view}` : null;

  /** テンキーを押す（数字の 1 文字か、1 文字消す "back"・全部消す "clear"） */
  const press = (key: string) => {
    blurFocus();
    if (key === "clear") setDigits(() => "");
    else if (key === "back")
      setDigits((value) => {
        const next = value.slice(0, -1);
        return /^0+$/.test(next) ? "" : next;
      });
    else setDigits((value) => appendDigit(value, key));
  };
  /** 待たずに今の番号で探して閉じる（Enter・×・パネルの外。閉じても選んだまま、番号が空なら外す） */
  useCaosStateLog("search.result.changed", {
    searched,
    orderNo: found?.orderNo ?? null,
    cardKey: target?.key ?? null,
    orderId: found?.orderId ?? null,
    commentCount: found?.comments.length ?? 0,
    commentKeys:
      found?.comments.map((c) => ({
        orderId: c.orderId,
        createdAt: c.createdAt,
      })) ?? [],
  });
  const finish = () => {
    const result = digits
      ? findOrder({ ...board, orderNo: Number(digits) })
      : null;
    caosLog("search.submitted", {
      digits,
      orderId: result?.orderId ?? null,
      commentCount: result?.comments.length ?? 0,
    });
    setSearched(digits);
    close();
  };

  // 注文を選び、そのカードを見せる（A のタイムラインのカードはタイムラインで、ほかは並べた枠の中で）
  const reveal = (orderNo: number, card: CaosCard) => {
    selectOrder(`#${orderNoLabel(orderNo)}`);
    if (showOnTimeline && card.status !== "unassigned")
      showOnTimeline(card.key);
    else scrollCardIntoView(card.key);
  };

  // 効果の中で読む今の値（効果は番号・キーで動かし、毎回は張り直さない）
  const current = {
    reveal,
    found,
    target,
    digits,
    searched,
    press,
    finish,
    open,
    close,
    selectOrder,
  };
  const latest = useRef(current);
  useLayoutEffect(() => {
    latest.current = current;
  });

  useEffect(() => {
    if (!searched) return;
    const found = latest.current.found;
    caosLog("search.performed", {
      digits: searched,
      orderId: found?.orderId ?? null,
      commentCount: found?.comments.length ?? 0,
    });
  }, [searched]);

  // 探す番号が変わって見つかったら、その注文を選んで見せる（見せるカードが替わったとき（抽出が終わって次のカードになった、など）も見せ直す）。
  // 開いたまま番号を変えて、盤面に見せるカードが無くなったら（消した・無い番号）選んだ注文を外す（閉じたときは選んだままにする）
  useEffect(() => {
    const { found, target, searched, selectOrder } = latest.current;
    if (targetId === null || !found || !target) {
      if (searched !== null) selectOrder(null);
      return;
    }
    latest.current.reveal(found.orderNo, target);
  }, [targetId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (ignoreKey(event)) return;
      const { digits, press, finish, open, close } = latest.current;
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
      else if (event.key === "Enter") finish();
      else if (event.key === "Escape") close();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return {
    /** 探した注文（押している途中は前の番号のまま。pending を見る） */
    found,
    /** 押した番号をまだ探していない（押し終えるのを待っている） */
    pending: digits !== searched,
    press,
    finish,
    /** 番号で探したときと同じく、その注文を選んでカードを見せる（パネルは開かない。未提供の行）。盤面にカードが無ければ選ぶだけ */
    select: (orderNo: number) => {
      const found = findOrder({ ...board, orderNo });
      const card = found && focusCard(found);
      if (card) reveal(orderNo, card);
      else selectOrder(`#${orderNoLabel(orderNo)}`);
    },
    /** 番号の検索を開いてすぐ探す（コメントの通知の「表示」） */
    show: (orderNo: number) => {
      caosLog("search.opened-from-comment", { orderNo });
      const shown = String(orderNo);
      open(shown);
      setSearched(shown);
    },
  };
};
