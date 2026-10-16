import {
  type MenuEntity,
  OrderEntity,
  type SplitPayment,
  type SquarePaymentType,
} from "@cafeore/common";
import type { CashierDraft, CashierLine } from "./cashierDraft";

/**
 * 個別会計（1 つの注文を、商品を分けて何回かに分けて払う）
 *
 * 「個別会計」を押すと、左の列に注文の商品を上下 2 つの枠に分けて出す。上の枠はまだ払っていない商品、
 * 下の枠は今回の会計で払う商品（小計するもの）。商品を下の枠に入れて会計し、払い終えたら残りで続ける。
 * 注文（番号・シール）は 1 つのまま、払った分を支払い（payments）として覚え、最後の会計で注文を送る。
 *
 * 割引（引換券・特殊な割引）は 1 杯 ¥100 ずつコーヒーに割り振り、その杯を含む会計で引く。
 * 既定では商品の並び順に割り振り、「割引をここに」で付ける商品を選び直せる。
 */

/** 個別会計で払い終えた 1 回分（注文はまだ送っていない） */
export type CashierSplitPayment = {
  /** 払った行（CashierLine.key） */
  lineKeys: number[];
  method: "cash" | "square";
  /** 払った額（行の値段の合計 − 割引） */
  amount: number;
  /** お預かり。Square なら amount と同じ */
  received: number;
  /** この会計で割り引いた杯数と額 */
  discountCups: number;
  discount: number;
  /** Square の決済依頼の ID と決済画面の種類。Square で払ったときだけ */
  squareCheckoutId?: string;
  squarePaymentType?: SquarePaymentType;
};

export type CashierSplit = {
  /** 下の枠（今回の会計）に入れた行（CashierLine.key）。入れた順 */
  picked: number[];
  /** 払い終えた分（払った順） */
  payments: CashierSplitPayment[];
  /** 割引を先に付ける行（CashierLine.key）。前ほど先。ここに無い行は並び順でその後 */
  discountFirst: number[];
  /** ↑↓ で選んでいる行（CashierLine.key）。選んでいなければ null */
  cursor: number | null;
};

/** 個別会計の今回の会計（下の枠）の金額 */
export type SplitBill = {
  /** 下の枠の行（入れた順） */
  lines: CashierLine[];
  /** 下の枠の値段の合計 */
  total: number;
  /** 下の枠で割り引く杯数と額 */
  discountCups: number;
  discount: number;
  /** 今回払う額 */
  amount: number;
  /** 残りを全部下の枠に入れた（この会計で注文を送る） */
  last: boolean;
  /** 先に払った額の合計 */
  paidAmount: number;
  /** まだ払っていない行ごとの、割り振った割引の杯数（CashierLine.key → 杯数） */
  allocation: ReadonlyMap<number, number>;
};

const EMPTY_SPLIT: CashierSplit = {
  picked: [],
  payments: [],
  discountFirst: [],
  cursor: null,
};

const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);

/** 払い終えた行か */
const isPaid = (split: CashierSplit, key: number) =>
  split.payments.some((payment) => payment.lineKeys.includes(key));

/** まだ払っていない行（削除した行を除く。並び順） */
export const unpaidLines = (draft: CashierDraft): CashierLine[] => {
  const split = draft.split ?? EMPTY_SPLIT;
  return draft.lines.filter((line) => !line.voided && !isPaid(split, line.key));
};

/** 上の枠：まだ払っていない行のうち、下の枠に入れていない行（並び順） */
export const splitUpperLines = (draft: CashierDraft): CashierLine[] => {
  const picked = draft.split?.picked ?? [];
  return unpaidLines(draft).filter((line) => !picked.includes(line.key));
};

/** 下の枠：今回の会計で払う行（入れた順） */
export const splitLowerLines = (draft: CashierDraft): CashierLine[] =>
  (draft.split?.picked ?? []).flatMap((key) => {
    const line = draft.lines.find((candidate) => candidate.key === key);
    return line ? [line] : [];
  });

/** 払い終えた行（並び順） */
export const splitPaidLines = (draft: CashierDraft): CashierLine[] => {
  const split = draft.split;
  return split === null
    ? []
    : draft.lines.filter((line) => !line.voided && isPaid(split, line.key));
};

/** ↑↓ で動く順（上の枠、続けて下の枠） */
const cursorOrder = (draft: CashierDraft) => [
  ...splitUpperLines(draft).map((line) => line.key),
  ...(draft.split?.picked ?? []),
];

/** 個別会計を始められるか（入れる段階で、削除していない商品が 2 点以上） */
export const canStartSplit = (draft: CashierDraft): boolean =>
  draft.step === "entry" &&
  draft.split === null &&
  draft.lines.filter((line) => !line.voided).length >= 2;

/** 個別会計を始める。商品は全部上の枠に出し、先頭の行を選ぶ */
export const startSplit = (draft: CashierDraft): CashierDraft => {
  if (!canStartSplit(draft)) return draft;
  const started: CashierDraft = {
    ...draft,
    split: EMPTY_SPLIT,
    selected: null,
    zone: "coupon",
  };
  return withFirstCursor(started, EMPTY_SPLIT);
};

/** 上の枠の先頭（無ければ下の枠の先頭）の行を選ぶ */
const withFirstCursor = (
  draft: CashierDraft,
  split: CashierSplit,
): CashierDraft => {
  const withSplit = { ...draft, split };
  return {
    ...withSplit,
    split: { ...split, cursor: cursorOrder(withSplit)[0] ?? null },
  };
};

/** 個別会計をやめられるか（まだ 1 回も払っていない） */
export const canCancelSplit = (draft: CashierDraft): boolean =>
  draft.step === "entry" &&
  draft.split !== null &&
  draft.split.payments.length === 0;

/** 個別会計をやめて、ふつうの入れる段階に戻る */
export const cancelSplit = (draft: CashierDraft): CashierDraft =>
  canCancelSplit(draft) ? { ...draft, split: null } : draft;

/** 上下の枠の行を動かせるか（個別会計の、商品を選ぶ段階） */
const canPick = (
  draft: CashierDraft,
): draft is CashierDraft & {
  split: CashierSplit;
} => draft.step === "entry" && draft.split !== null;

/** 行を上の枠から下の枠へ（下の枠なら上の枠へ）動かす。動かした行を選ぶ */
export const toggleSplitLine = (
  draft: CashierDraft,
  key: number,
): CashierDraft => {
  if (!canPick(draft)) return draft;
  if (!unpaidLines(draft).some((line) => line.key === key)) return draft;
  const { picked } = draft.split;
  return {
    ...draft,
    split: {
      ...draft.split,
      picked: picked.includes(key)
        ? picked.filter((k) => k !== key)
        : [...picked, key],
      cursor: key,
    },
  };
};

/** 上の枠の行を全部下の枠に入れる（残りを全部払う） */
export const pickAllSplitLines = (draft: CashierDraft): CashierDraft => {
  if (!canPick(draft)) return draft;
  const upper = splitUpperLines(draft).map((line) => line.key);
  if (upper.length === 0) return draft;
  return {
    ...draft,
    split: { ...draft.split, picked: [...draft.split.picked, ...upper] },
  };
};

/** ↑↓ で選ぶ行を動かす（上の枠、続けて下の枠の順。端で止まる） */
export const moveSplitCursor = (
  draft: CashierDraft,
  step: 1 | -1,
): CashierDraft => {
  if (!canPick(draft)) return draft;
  const order = cursorOrder(draft);
  if (order.length === 0) return draft;
  const index =
    draft.split.cursor === null ? -1 : order.indexOf(draft.split.cursor);
  const next =
    index === -1
      ? step === 1
        ? 0
        : order.length - 1
      : Math.min(Math.max(index + step, 0), order.length - 1);
  return { ...draft, split: { ...draft.split, cursor: order[next] } };
};

/** 選んでいる行を上下の枠の間で動かす（Space） */
export const toggleSplitCursorLine = (draft: CashierDraft): CashierDraft =>
  draft.split?.cursor === null || draft.split === null
    ? draft
    : toggleSplitLine(draft, draft.split.cursor);

/** その行に割引を先に付ける（「割引をここに」） */
export const preferDiscount = (
  draft: CashierDraft,
  key: number,
): CashierDraft => {
  if (!canPick(draft)) return draft;
  return {
    ...draft,
    split: {
      ...draft.split,
      discountFirst: [
        key,
        ...draft.split.discountFirst.filter((k) => k !== key),
      ],
    },
  };
};

/** 行の、割引の対象のコーヒーの杯数（OrderEntity.getCoffeeCups と同じ数え方） */
export const coffeeCupsOf = (menu: MenuEntity): number =>
  sum(
    menu.items.map(({ item, quantity }) =>
      item.item_type.needs_brew ? quantity : 0,
    ),
  );

/**
 * 割引する杯を、まだ払っていない行に割り振る。
 *
 * totalCups は注文全体で割り引く杯数。払い終えた会計で割り引いた杯数を除いた残りを、
 * 「割引をここに」で選んだ行、続けて並び順の行に、行のコーヒーの杯数まで割り振る。
 */
export const allocateDiscount = (
  draft: CashierDraft,
  totalCups: number,
): Map<number, number> => {
  const split = draft.split ?? EMPTY_SPLIT;
  let left = Math.max(
    totalCups - sum(split.payments.map((payment) => payment.discountCups)),
    0,
  );
  const unpaid = unpaidLines(draft);
  const first = split.discountFirst.flatMap((key) => {
    const line = unpaid.find((candidate) => candidate.key === key);
    return line ? [line] : [];
  });
  const rest = unpaid.filter((line) => !split.discountFirst.includes(line.key));
  const allocation = new Map<number, number>();
  for (const line of [...first, ...rest]) {
    if (left === 0) break;
    const cups = Math.min(coffeeCupsOf(line.menu), left);
    if (cups > 0) {
      allocation.set(line.key, cups);
      left -= cups;
    }
  }
  return allocation;
};

/**
 * 今回の会計（下の枠）の金額。totalCups は注文全体で割り引く杯数、perCup は 1 杯の割引額
 */
export const splitBill = (
  draft: CashierDraft,
  totalCups: number,
  perCup: number,
): SplitBill => {
  const allocation = allocateDiscount(draft, totalCups);
  const lines = splitLowerLines(draft);
  const total = sum(lines.map((line) => line.menu.price));
  const discountCups = sum(lines.map((line) => allocation.get(line.key) ?? 0));
  const discount = discountCups * perCup;
  return {
    lines,
    total,
    discountCups,
    discount,
    amount: total - discount,
    last: lines.length > 0 && splitUpperLines(draft).length === 0,
    paidAmount: sum(
      (draft.split?.payments ?? []).map((payment) => payment.amount),
    ),
    allocation,
  };
};

/**
 * 今回の会計を払い終えたことを覚える。下の枠の行を払い終えた行にし、受取金額を空にして、
 * 商品を選ぶ段階に戻る（残りの先頭の行を選ぶ）
 */
export const recordSplitPayment = (
  draft: CashierDraft,
  payment: Omit<CashierSplitPayment, "lineKeys">,
): CashierDraft => {
  const split = draft.split;
  if (split === null || split.picked.length === 0) return draft;
  return withFirstCursor(
    { ...draft, step: "entry", received: "", payment: "cash" },
    {
      ...split,
      picked: [],
      payments: [...split.payments, { ...payment, lineKeys: split.picked }],
    },
  );
};

/**
 * 払い終えた分を、注文に付けて送る支払い（payments）にする。
 * 行は、送る注文の明細（削除していない行の並び順）の位置で指す
 */
export const splitPaymentsForOrder = (draft: CashierDraft): SplitPayment[] => {
  const positions = new Map(
    draft.lines
      .filter((line) => !line.voided)
      .map((line, index) => [line.key, index]),
  );
  return (draft.split?.payments ?? []).map((payment) => ({
    method: payment.method,
    amount: payment.amount,
    received: payment.received,
    discount: payment.discount,
    menuIndexes: payment.lineKeys.flatMap((key) => {
      const index = positions.get(key);
      return index === undefined ? [] : [index];
    }),
    ...(payment.squareCheckoutId !== undefined && {
      squareCheckoutId: payment.squareCheckoutId,
    }),
  }));
};

/**
 * 今回の会計（下の枠）だけの注文を作る。番号・時刻・割引の番号は order のまま、商品は下の枠の行、
 * 割引は下の枠に割り振った杯数、お預かりは受取金額。レシート・Square の決済・お客さん向けの表示に使う
 */
export const splitPaymentOrder = (
  order: OrderEntity,
  draft: CashierDraft,
): OrderEntity => {
  const perCup = order.DISCOUNT_PER_CUP;
  const bill = splitBill(draft, order.discount / perCup, perCup);
  return OrderEntity.fromOrder({
    ...order.toOrder(),
    id: undefined,
    menus: bill.lines.map((line) => line.menu.toMenu()),
    discountOrderCups: bill.discountCups,
    received: draft.received === "" ? 0 : Number(draft.received),
    payments: [],
  });
};

/**
 * 最後の会計を払い終えたあとに送る、注文全体を作る。払った分を payments に、お預かりをその合計にする。
 * 割引は払った分で引いた額にそろえる（払い始めてから引換券の照合が変わっても、払った額の合計と
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
      (draft.split?.payments ?? []).map((payment) => payment.discountCups),
    ),
  });
};
