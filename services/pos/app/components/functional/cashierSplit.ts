import {
  type MenuEntity,
  OrderEntity,
  type SplitPayment,
  type SquarePaymentType,
} from "@cafeore/common";
import type { CashierDraft, CashierLine } from "./cashierDraft";

/**
 * 小計分割（一部金額先払い）
 *
 * 一括会計で、まだ払っていない商品を全部入れた「小計」を作って会計する。小計は金額で分けて
 * 何回かで払える（小計分割・一部金額先払い）。受け取った分（先会計）はレジの中に覚え、
 * 注文全体を払い終えたら、支払いを全部付けて注文を 1 つ送る。
 *
 * 割引（引換券・特殊な割引）は小計を作ったときに決め、小計を払い終えた支払いに付ける。
 * 先払いがある間は、商品・割引を変えない（払った小計の額が変わらないように）。
 */

/** 小計（先に会計する単位） */
export type CashierSubtotal = {
  id: number;
  /** 小計に入れた行（CashierLine.key。並び順） */
  lineKeys: number[];
  /** 行の値段の合計 */
  total: number;
  /** 割引の杯数と額（小計を作ったときに決める） */
  discountCups: number;
  discount: number;
  /** 払う額（total − discount） */
  amount: number;
};

/** 受け取った支払い（先会計）1 回分 */
export type CashierTender = {
  id: number;
  /** どの小計の支払いか（CashierSubtotal.id） */
  subtotalId: number;
  method: "cash" | "square";
  amount: number;
  /** お預かり。Square なら amount と同じ */
  received: number;
  /** Square の決済依頼の ID と決済画面の種類。Square で払ったときだけ */
  squareCheckoutId?: string;
  squarePaymentType?: SquarePaymentType;
};

export type CashierSplit = {
  /** 小計（作った順）。払い終えたものと、会計中のもの（current） */
  subtotals: CashierSubtotal[];
  /** 受け取った支払い（受け取った順） */
  tenders: CashierTender[];
  /** 会計中の小計（CashierSubtotal.id）。会計の段階でなければ null */
  current: number | null;
  /** 小計分割で、今回先に払う額。分けていなければ null */
  part: number | null;
  nextId: number;
};

export const emptySplit = (): CashierSplit => ({
  subtotals: [],
  tenders: [],
  current: null,
  part: null,
  nextId: 0,
});

const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);

/** 小計で受け取った額 */
export const subtotalPaid = (split: CashierSplit, subtotalId: number): number =>
  sum(
    split.tenders
      .filter((tender) => tender.subtotalId === subtotalId)
      .map((tender) => tender.amount),
  );

/** 小計の残り */
export const subtotalRemaining = (
  split: CashierSplit,
  subtotal: CashierSubtotal,
): number => subtotal.amount - subtotalPaid(split, subtotal.id);

const isDone = (split: CashierSplit, subtotal: CashierSubtotal) =>
  subtotalRemaining(split, subtotal) <= 0;

/** 先会計（受け取った額の合計） */
export const prepaidAmount = (split: CashierSplit): number =>
  sum(split.tenders.map((tender) => tender.amount));

/** 先払いがあるか。あれば商品・割引を変えない */
export const hasTenders = (draft: CashierDraft): boolean =>
  draft.split.tenders.length > 0;

/** 会計中の小計。会計の段階でなければ null */
export const currentSubtotal = (draft: CashierDraft): CashierSubtotal | null =>
  draft.split.current === null
    ? null
    : (draft.split.subtotals.find(
        (subtotal) => subtotal.id === draft.split.current,
      ) ?? null);

/** 払い終えた小計の行 */
const paidLineKeys = (draft: CashierDraft): Set<number> => {
  const { split } = draft;
  return new Set(
    split.subtotals
      .filter((subtotal) => isDone(split, subtotal))
      .flatMap((subtotal) => subtotal.lineKeys),
  );
};

/** まだ払っていない行（並び順） */
export const unpaidLines = (draft: CashierDraft): CashierLine[] => {
  const paid = paidLineKeys(draft);
  return draft.lines.filter((line) => !paid.has(line.key));
};

/** 行の、割引の対象のコーヒーの杯数（OrderEntity.getCoffeeCups と同じ数え方） */
const coffeeCupsOf = (menu: MenuEntity): number =>
  sum(
    menu.items.map(({ item, quantity }) =>
      item.item_type.needs_brew ? quantity : 0,
    ),
  );

/**
 * まだ払っていない商品を全部 1 つの小計にして会計の段階に進む（一括会計）。
 * totalCups は注文全体で割り引く杯数（小計のコーヒーの杯数まで引く）、perCup は 1 杯の割引額
 */
export const beginRest = (
  draft: CashierDraft,
  totalCups: number,
  perCup: number,
): CashierDraft => {
  const lines = unpaidLines(draft);
  if (draft.step !== "entry" || lines.length === 0) return draft;
  const { split } = draft;
  const total = sum(lines.map((line) => line.menu.price));
  const discountCups = Math.min(
    totalCups,
    sum(lines.map((line) => coffeeCupsOf(line.menu))),
  );
  const discount = discountCups * perCup;
  const subtotal: CashierSubtotal = {
    id: split.nextId,
    lineKeys: lines.map((line) => line.key),
    total,
    discountCups,
    discount,
    amount: total - discount,
  };
  return {
    ...draft,
    step: "pay",
    selected: null,
    payment: "cash",
    received: "",
    split: {
      ...split,
      subtotals: [...split.subtotals, subtotal],
      current: subtotal.id,
      part: null,
      nextId: split.nextId + 1,
    },
  };
};

/**
 * 会計の段階をやめて入れる段階に戻れるか（会計取消・Esc）。
 * 小計の途中まで払ったら、払い終えるか取り消すまで戻らない
 */
export const canLeavePayment = (draft: CashierDraft): boolean => {
  const subtotal = currentSubtotal(draft);
  return (
    draft.step === "pay" &&
    (subtotal === null || subtotalPaid(draft.split, subtotal.id) === 0)
  );
};

/** 会計中の小計をやめて入れる段階に戻る。受取金額は消す */
export const leavePayment = (draft: CashierDraft): CashierDraft => {
  if (!canLeavePayment(draft)) return draft;
  const { split } = draft;
  return {
    ...draft,
    step: "entry",
    received: "",
    payment: "cash",
    split: {
      ...split,
      subtotals: split.subtotals.filter((s) => s.id !== split.current),
      current: null,
      part: null,
    },
  };
};

/** 今払う額。小計分割ならその額、でなければ会計中の小計の残り */
export const dueAmount = (draft: CashierDraft): number => {
  const subtotal = currentSubtotal(draft);
  if (subtotal === null) return 0;
  return draft.split.part ?? subtotalRemaining(draft.split, subtotal);
};

/** 小計分割の金額を確かめた結果 */
export type PartCheck = {
  ok: boolean;
  /** 違うときに出す理由。金額が空なら空 */
  message: string;
};

/**
 * 小計分割で先に払う額を確かめる。limit は分ける小計（の残り）。
 * afterPayment は受け取った直後（続けて分割する）で、同じ額のときの案内を変える
 */
export const checkPart = (
  amount: number,
  limit: number,
  afterPayment: boolean,
): PartCheck => {
  if (amount <= 0) return { ok: false, message: "" };
  if (amount > limit) {
    return { ok: false, message: "小計より多い額は先払いにできません" };
  }
  if (amount === limit) {
    return {
      ok: false,
      message: afterPayment
        ? "残りと同じ額なら「残りを全て会計」を使ってください"
        : "小計と同じ額ならそのまま会計してください",
    };
  }
  return { ok: true, message: "" };
};

/** 会計中の小計を金額で分け、amount を先に払う（小計分割・一部金額先払い） */
export const setPart = (draft: CashierDraft, amount: number): CashierDraft => {
  const subtotal = currentSubtotal(draft);
  if (draft.step !== "pay" || subtotal === null) return draft;
  if (!checkPart(amount, subtotalRemaining(draft.split, subtotal), false).ok) {
    return draft;
  }
  return {
    ...draft,
    received: "",
    payment: "cash",
    split: { ...draft.split, part: amount },
  };
};

/** 小計分割をやめる（小計の残りをそのまま払う） */
export const cancelPart = (draft: CashierDraft): CashierDraft =>
  draft.split.part === null
    ? draft
    : {
        ...draft,
        received: "",
        split: { ...draft.split, part: null },
      };

/**
 * 小計分割・一部金額先払いに進めるか（会計欄の「小計分割・一部金額先払い」）。
 * 先に払う額を 1 円以上残せれば（checkPart）進める。Square で決済中は進めない
 */
export const canSplitPart = (
  draft: CashierDraft,
  squarePaymentActive: boolean,
): boolean => {
  const subtotal = currentSubtotal(draft);
  return (
    draft.step === "pay" &&
    subtotal !== null &&
    !squarePaymentActive &&
    subtotalRemaining(draft.split, subtotal) > 1
  );
};

/**
 * 受け取った分を覚える。小計分割をやめ、受取金額を空にする。小計を払い終えたら入れる段階に戻る
 * （注文全体を払い終えたので、呼ぶ側が注文を送る）
 */
export const recordTender = (
  draft: CashierDraft,
  tender: Omit<CashierTender, "id" | "subtotalId">,
): CashierDraft => {
  const subtotal = currentSubtotal(draft);
  if (subtotal === null) return draft;
  const { split } = draft;
  const tenders = [
    ...split.tenders,
    { ...tender, id: split.nextId, subtotalId: subtotal.id },
  ];
  const done =
    subtotal.amount - subtotalPaid({ ...split, tenders }, subtotal.id) <= 0;
  return {
    ...draft,
    step: done ? "entry" : "pay",
    received: "",
    payment: "cash",
    split: {
      ...split,
      tenders,
      current: done ? null : subtotal.id,
      part: null,
      nextId: split.nextId + 1,
    },
  };
};

/**
 * 返金した支払いを外す。subtotalIds の小計も外す（その商品はまた払っていないことになる）。
 * 会計中の小計を外したとき・支払いが無くなったときは、入れる段階に戻る
 */
export const removeTenders = (
  draft: CashierDraft,
  tenderIds: readonly number[],
  subtotalIds: readonly number[],
): CashierDraft => {
  const { split } = draft;
  const tenders = split.tenders.filter((t) => !tenderIds.includes(t.id));
  const subtotals = split.subtotals.filter((s) => !subtotalIds.includes(s.id));
  const back =
    tenders.length === 0 ||
    (split.current !== null && subtotalIds.includes(split.current));
  if (!back) {
    return { ...draft, split: { ...split, tenders, subtotals } };
  }
  const remaining = { ...split, tenders, subtotals };
  return {
    ...draft,
    step: "entry",
    received: "",
    payment: "cash",
    split: {
      ...remaining,
      subtotals: subtotals.filter((subtotal) => isDone(remaining, subtotal)),
      current: null,
      part: null,
    },
  };
};

/**
 * 受け取った支払いを、注文に付けて送る支払い（payments）にする。
 * 行は、送る注文の明細（削除していない行の並び順）の位置で指す。同じ小計の支払いは同じ行を指す。
 * 小計で引いた割引は、その小計を払い終えた支払いに付ける
 */
export const splitPaymentsForOrder = (draft: CashierDraft): SplitPayment[] => {
  const { split } = draft;
  const positions = new Map(
    draft.lines.map((line, index) => [line.key, index]),
  );
  return split.tenders.map((tender) => {
    const subtotal = split.subtotals.find((s) => s.id === tender.subtotalId);
    const lastOfSubtotal = split.tenders
      .filter((t) => t.subtotalId === tender.subtotalId)
      .at(-1);
    return {
      method: tender.method,
      amount: tender.amount,
      received: tender.received,
      discount:
        lastOfSubtotal?.id === tender.id ? (subtotal?.discount ?? 0) : 0,
      menuIndexes: (subtotal?.lineKeys ?? []).flatMap((key) => {
        const index = positions.get(key);
        return index === undefined ? [] : [index];
      }),
      ...(tender.squareCheckoutId !== undefined && {
        squareCheckoutId: tender.squareCheckoutId,
      }),
    };
  });
};

/**
 * 注文全体を払い終えたあとに送る注文を作る。受け取った分を payments に、お預かりをその合計にする。
 * 割引は小計で引いた額にそろえる（払い始めてから引換券の照合が変わっても、払った額の合計と
 * 請求額がずれないように）
 */
export const splitOrderForSubmit = (
  order: OrderEntity,
  draft: CashierDraft,
): OrderEntity => {
  const payments = splitPaymentsForOrder(draft);
  const base = {
    ...order.toOrder(),
    payments,
    received: sum(payments.map((payment) => payment.received)),
  };
  const submitted = OrderEntity.fromOrder(base);
  const discount = sum(payments.map((payment) => payment.discount));
  if (submitted.discount === discount) return submitted;
  return OrderEntity.fromOrder({
    ...base,
    discountOrderCups: sum(
      draft.split.subtotals.map((subtotal) => subtotal.discountCups),
    ),
  });
};

/**
 * 小計だけの注文を作る。番号・時刻・割引の番号は order のまま、商品は小計の行、割引は小計で
 * 引いた杯数、お預かりは received。レシート・Square の決済に使う
 */
export const subtotalOrder = (
  order: OrderEntity,
  draft: CashierDraft,
  subtotal: CashierSubtotal,
  received: number,
): OrderEntity =>
  OrderEntity.fromOrder({
    ...order.toOrder(),
    id: undefined,
    menus: draft.lines
      .filter((line) => subtotal.lineKeys.includes(line.key))
      .map((line) => line.menu.toMenu()),
    discountOrderCups: subtotal.discountCups,
    received,
    payments: [],
  });

/**
 * お客さん向けの表示（cashier-mini）に出す注文。先払いがあるときは、注文全体を受取金額なしで出す
 * （お釣りを間違えて見せないように）
 */
export const displayOrder = (
  order: OrderEntity,
  draft: CashierDraft,
): OrderEntity =>
  hasTenders(draft)
    ? OrderEntity.fromOrder({ ...order.toOrder(), received: 0 })
    : order;
