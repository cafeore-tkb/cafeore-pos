import {
  DRIPPER_NUMBERS,
  type MenuEntity,
  type OrderEntity,
  type SquarePaymentType,
  type WithId,
  getDiscountOrderStatus,
} from "@cafeore/common";
import { isSameKeySet, menuKeyChord } from "~/lib/menuKey";
import type { OrderSplit } from "./cashierOrderSplit";
import {
  type CashierSplit,
  emptySplit,
  hasTenders,
  unpaidLines,
} from "./cashierSplit";

/**
 * レジで入力中の注文の下書き（画面の状態）
 *
 * 送る注文（OrderEntity）は、ここから商品と受取金額を写して作る（cashierAtoms）。
 * 割引は過去の注文と照らし合わせるので、画面（CashierV2）が引換券番号から決める。
 */

/** 商品・割引・備考を入れる段階（entry）と、受取金額・決済手段を選ぶ段階（pay） */
export type CashierStep = "entry" | "pay";

/** 商品の行を選んでいないときに、↑↓ で動かす先 */
export type CashierZone = "coupon" | "memo";

/** 決済手段。現金か Square の決済手段 */
export type CashierPayment = "cash" | SquarePaymentType;

export type CashierLine = {
  /** 同じ商品を何度足しても見分けられる番号 */
  key: number;
  menu: WithId<MenuEntity>;
};

export type CashierDraft = {
  lines: CashierLine[];
  nextKey: number;
  /** 選んでいる商品の行（lines の添字）。選んでいなければ null */
  selected: number | null;
  zone: CashierZone;
  step: CashierStep;
  /** 引換券番号（0〜3 桁） */
  coupon: string;
  /** 特殊な割引（今年以外の引換券で 1 杯分） */
  special: boolean;
  /** 特記事項。送るときにレジのコメントとして付ける */
  memo: string;
  /** 受取金額（数字だけ）。入れていなければ空 */
  received: string;
  payment: CashierPayment;
  /**
   * 先払いのレシートに載せた注文番号（No.）。番号はこのまま確定まで変えない
   * （別のレジが送って次の番号が進んでも、レシートと登録する注文の番号をずらさない）
   */
  fixedOrderId: number | null;
  /** 小計と、受け取った支払い（先会計）・小計分割（cashierSplit） */
  split: CashierSplit;
  /** 分割して一括会計の分け方（cashierOrderSplit）。会計の段階だけ。分けずに会計するなら null */
  orderSplit: OrderSplit | null;
};

export const COUPON_DIGITS = 3;
/** 受取金額の桁数（¥999,999 まで） */
const RECEIVED_MAX_DIGITS = 6;
const RECEIVED_MAX = 999_999;

export const emptyCashierDraft = (): CashierDraft => ({
  lines: [],
  nextKey: 0,
  selected: null,
  zone: "coupon",
  step: "entry",
  coupon: "",
  special: false,
  memo: "",
  received: "",
  payment: "cash",
  fixedOrderId: null,
  split: emptySplit(),
  orderSplit: null,
});

/** 消すと失うものがあるか（商品・引換券番号・特殊な割引・特記事項・受取金額） */
export const hasDraftInput = (draft: CashierDraft): boolean =>
  draft.lines.length > 0 ||
  draft.coupon !== "" ||
  draft.special ||
  draft.memo !== "" ||
  draft.received !== "";

/** 送る注文に入れる商品（行の並び順） */
export const activeMenus = (draft: CashierDraft): WithId<MenuEntity>[] =>
  draft.lines.map((line) => line.menu);

/** 指名できる商品か。指名するのはドリッパーで淹れるもの（抽出が要るもの）だけ */
export const canAssignMenu = (menu: MenuEntity): boolean =>
  menu.items.some(({ item }) => item.item_type.needs_brew);

/**
 * 商品を変えられるか。会計の段階では小計を作っているので変えない（変えるときは会計取消で戻る）。
 * 先払いがある間も変えない（変えるときは先払いを取り消す）
 */
export const canEditLines = (draft: CashierDraft): boolean =>
  draft.step === "entry" && !hasTenders(draft);

/**
 * 割引を変えられないか。先払いがある間は、払った小計の額が変わらないよう、
 * 引換券番号・特殊な割引は変えない
 */
export const isDiscountLocked = (draft: CashierDraft): boolean =>
  hasTenders(draft);

/** 選んでいる行が、今指名できるか（抽出が要る） */
export const canAssignSelected = (draft: CashierDraft): boolean => {
  const line = draft.selected === null ? null : draft.lines[draft.selected];
  return !!line && canAssignMenu(line.menu);
};

/** 引換券番号の欄を選んでいるか（入れる段階で、特殊な割引でなく、行も備考も選んでいない）。欄に枠を出す */
export const canEditCoupon = (draft: CashierDraft): boolean =>
  draft.step === "entry" &&
  !draft.special &&
  !isDiscountLocked(draft) &&
  draft.selected === null &&
  draft.zone === "coupon";

/**
 * 数字（テンキー・数字のキー）で引換券番号を打てるか（入れる段階で、特殊な割引でない）。
 * 商品の行や備考を選んでいても、打てば引換券番号の欄に移る
 */
export const canInputCoupon = (draft: CashierDraft): boolean =>
  draft.step === "entry" && !draft.special && !isDiscountLocked(draft);

/** 引換券番号の欄に移る（打った数字が入る欄を見せる） */
const toCouponZone = (draft: CashierDraft): CashierDraft =>
  draft.selected === null && draft.zone === "coupon"
    ? draft
    : { ...draft, selected: null, zone: "coupon" };

// --------------------------------------------------
// 商品
// --------------------------------------------------

/**
 * 商品を足し、足した行を選ぶ（続けて Space で指名、Backspace で削除できるように）。
 * 会計の段階と、先払いがある間は足さない
 */
export const addLine = (
  draft: CashierDraft,
  menu: WithId<MenuEntity>,
): CashierDraft => {
  if (!canEditLines(draft)) return draft;
  return {
    ...draft,
    lines: [...draft.lines, { key: draft.nextKey, menu }],
    nextKey: draft.nextKey + 1,
    selected: draft.lines.length,
  };
};

/**
 * 同時押しの商品を足す。同時押しの途中で先に押したキーで足した行（replaceLineKeys）は、
 * 同時押しの商品に置き換える（消してから足す）
 */
export const addChordLine = (
  draft: CashierDraft,
  menu: WithId<MenuEntity>,
  replaceLineKeys: readonly number[],
): CashierDraft => {
  if (!canEditLines(draft)) return draft;
  const lines = draft.lines.filter(
    (line) => !replaceLineKeys.includes(line.key),
  );
  return addLine({ ...draft, lines }, menu);
};

/** 行を削除する（一覧から消す。戻すときはもう一度足す）。選んでいた行は外す */
export const removeLine = (
  draft: CashierDraft,
  index: number,
): CashierDraft => {
  if (!canEditLines(draft) || !draft.lines[index]) return draft;
  return {
    ...draft,
    lines: draft.lines.filter((_, i) => i !== index),
    selected: null,
    zone: "coupon",
  };
};

/** 全部の行を削除する */
export const removeAllLines = (draft: CashierDraft): CashierDraft =>
  canEditLines(draft) && draft.lines.length > 0
    ? { ...draft, lines: [], selected: null, zone: "coupon" }
    : draft;

/** 行を選ぶ。選んでいる行をもう一度選ぶと外す */
export const selectLine = (
  draft: CashierDraft,
  index: number,
): CashierDraft => {
  if (!canEditLines(draft) || !draft.lines[index]) return draft;
  if (draft.selected === index) {
    return { ...draft, selected: null, zone: "coupon" };
  }
  return { ...draft, selected: index };
};

/**
 * 選んでいる行のドリッパーを決める（数字のキー）。自由記述はそのまま残し（番号を外したら消す）、行は選んだまま。
 * 自由記述は指名のダイアログで書く
 */
export const assignSelectedDripper = (
  draft: CashierDraft,
  dripper: number | null,
): CashierDraft => {
  if (!canEditLines(draft) || !canAssignSelected(draft)) return draft;
  const index = draft.selected;
  if (index === null) return draft;
  const line = draft.lines[index];
  const menu = line.menu.clone();
  menu.assign(dripper, line.menu.assignee);
  return {
    ...draft,
    lines: draft.lines.map((l, i) => (i === index ? { ...l, menu } : l)),
  };
};

/** 数字のキーの指名。1〜6 は 1st〜6th、0 は指名なし。ほかは undefined */
const dripperFromKey = (key: string): number | null | undefined => {
  if (key === "0") return null;
  return DRIPPER_NUMBERS.find((dripper) => String(dripper) === key);
};

/** 数字を指名に使うか（入れる段階で行を選んでいる）。打った数字は引換券番号に入れない */
export const isAssigningByDigits = (draft: CashierDraft): boolean =>
  draft.step === "entry" && draft.selected !== null;

/** 数字のキー（1 つ）で、選んでいる行を指名できるか。1〜6・0 で、指名できる行（抽出が要る）のときだけ */
export const canAssignByDigit = (draft: CashierDraft, key: string): boolean =>
  canEditLines(draft) &&
  canAssignSelected(draft) &&
  dripperFromKey(key) !== undefined;

/** 数字のキー（1 つ）で、選んでいる行を指名する。1〜6 は 1st〜6th、0 は指名なし。ほかの数字では何もしない */
export const assignByDigit = (
  draft: CashierDraft,
  key: string,
): CashierDraft => {
  const dripper = dripperFromKey(key);
  return dripper === undefined ? draft : assignSelectedDripper(draft, dripper);
};

/**
 * 行の指名を決めて、選んでいた行を外す。
 * 指名はドリッパーの番号が必須で、番号が無ければ自由記述も消す（MenuEntity.assign）
 */
export const assignLine = (
  draft: CashierDraft,
  index: number,
  dripper: number | null,
  assignee: string | null,
): CashierDraft => {
  const line = draft.lines[index];
  if (!canEditLines(draft) || !line) return draft;
  const menu = line.menu.clone();
  menu.assign(dripper, assignee);
  return {
    ...draft,
    lines: draft.lines.map((l, i) => (i === index ? { ...l, menu } : l)),
    selected: null,
    zone: "coupon",
  };
};

/**
 * 入れる段階で ↑↓ を押したとき。商品の行 → 割引（引換券番号） → 備考 の順に動く
 */
export const moveCursor = (draft: CashierDraft, step: 1 | -1): CashierDraft => {
  const count = draft.lines.length;
  if (draft.selected !== null) {
    if (step === 1) {
      return draft.selected < count - 1
        ? { ...draft, selected: draft.selected + 1 }
        : { ...draft, selected: null, zone: "coupon" };
    }
    return draft.selected > 0
      ? { ...draft, selected: draft.selected - 1 }
      : draft;
  }
  if (draft.zone === "memo") {
    return step === 1 ? draft : { ...draft, zone: "coupon" };
  }
  if (step === 1) return { ...draft, zone: "memo" };
  return count > 0 ? { ...draft, selected: count - 1 } : draft;
};

// --------------------------------------------------
// 割引・備考
// --------------------------------------------------

export type CouponStatus =
  | { kind: "empty" }
  | { kind: "partial"; remaining: number }
  /** 割引できる。order は引換券の注文 */
  | { kind: "available"; order: WithId<OrderEntity> }
  | { kind: "already_used" }
  | { kind: "unserved" }
  /** 返金した注文の番号 */
  | { kind: "refunded" };

/** 引換券番号を過去の注文と照らし合わせる */
export const couponStatus = (
  coupon: string,
  orders: readonly WithId<OrderEntity>[],
): CouponStatus => {
  if (coupon.length === 0) return { kind: "empty" };
  if (coupon.length < COUPON_DIGITS) {
    return { kind: "partial", remaining: COUPON_DIGITS - coupon.length };
  }
  const orderId = Number(coupon);
  const status = getDiscountOrderStatus(orderId, [...orders]);
  const order = orders.find((candidate) => candidate.orderId === orderId);
  if (status === "available" && order) return { kind: "available", order };
  return { kind: status === "available" ? "unserved" : status };
};

/** 3 桁を照らし合わせて、割引できなかったか（使用済み・まだ提供されていない・返金した番号） */
export const isCouponRejected = (status: CouponStatus): boolean =>
  status.kind === "already_used" ||
  status.kind === "unserved" ||
  status.kind === "refunded";

/** 引換券番号の欄を選ぶ */
export const focusCoupon = (draft: CashierDraft): CashierDraft =>
  draft.step === "entry" && !draft.special && !isDiscountLocked(draft)
    ? { ...draft, selected: null, zone: "coupon" }
    : draft;

/** 備考の欄を選ぶ */
export const focusMemo = (draft: CashierDraft): CashierDraft => ({
  ...draft,
  selected: null,
  zone: "memo",
});

/**
 * 特殊な割引を切り替える。引換券で割引できているときは付けない。
 * 付けるときも外すときも、引換券番号は消す。付けたら備考に移り、外したら引換券番号の欄に移る
 */
export const toggleSpecial = (
  draft: CashierDraft,
  couponApplied: boolean,
): CashierDraft => {
  if ((!draft.special && couponApplied) || isDiscountLocked(draft)) {
    return draft;
  }
  return {
    ...draft,
    special: !draft.special,
    coupon: "",
    selected: null,
    zone: draft.special ? "coupon" : "memo",
  };
};

export const setMemo = (draft: CashierDraft, memo: string): CashierDraft => ({
  ...draft,
  memo,
});

// --------------------------------------------------
// 数字（入れる段階は引換券番号、会計の段階は受取金額）
// --------------------------------------------------

/**
 * 数字を打つ。入れる段階は引換券番号に（行・備考を選んでいれば引換券番号の欄に移る）、
 * 3 桁そろって割引できれば備考に移る。割引できない 3 桁なら引換券番号の欄に残り、
 * 次に打った数字で消して 1 桁目から打ち直す。会計の段階は受取金額に足す（現金にする）
 *
 * checkCoupon は引換券番号を過去の注文と照らし合わせる（couponStatus）。渡さなければ照らし合わせない
 */
export const inputDigits = (
  draft: CashierDraft,
  digits: string,
  checkCoupon?: (coupon: string) => CouponStatus,
): CashierDraft => {
  if (draft.step === "entry") {
    if (!canInputCoupon(draft)) return draft;
    const rejected = (coupon: string) =>
      checkCoupon !== undefined && isCouponRejected(checkCoupon(coupon));
    const current = toCouponZone(draft);
    const typed = rejected(current.coupon) ? "" : current.coupon;
    const coupon = (typed + digits).slice(0, COUPON_DIGITS);
    const completed =
      typed.length < COUPON_DIGITS && coupon.length === COUPON_DIGITS;
    return {
      ...current,
      coupon,
      zone: completed && !rejected(coupon) ? "memo" : current.zone,
    };
  }
  const received = (draft.received + digits).replace(/^0+/, "");
  if (received.length > RECEIVED_MAX_DIGITS) {
    return { ...draft, payment: "cash" };
  }
  return { ...draft, received, payment: "cash" };
};

/**
 * テンキー（画面）の数字。キーボードの数字と同じく、入れる段階で行を選んでいれば指名
 * （assignByDigit）、でなければ引換券番号・受取金額に打つ（inputDigits）
 */
export const inputPadDigits = (
  draft: CashierDraft,
  digits: string,
  checkCoupon?: (coupon: string) => CouponStatus,
): CashierDraft =>
  isAssigningByDigits(draft)
    ? assignByDigit(draft, digits)
    : inputDigits(draft, digits, checkCoupon);

/** 1 桁消す（入れる段階は引換券番号の欄に移る） */
export const deleteDigit = (draft: CashierDraft): CashierDraft => {
  if (draft.step === "entry") {
    return canInputCoupon(draft)
      ? { ...toCouponZone(draft), coupon: draft.coupon.slice(0, -1) }
      : draft;
  }
  return { ...draft, received: draft.received.slice(0, -1) };
};

/** 全部消す（入れる段階は引換券番号の欄に移る） */
export const clearDigits = (draft: CashierDraft): CashierDraft => {
  if (draft.step === "entry") {
    return canInputCoupon(draft)
      ? { ...toCouponZone(draft), coupon: "" }
      : draft;
  }
  return { ...draft, received: "" };
};

/** 受取金額に足す（+1千 など）。会計の段階だけ */
export const addReceived = (
  draft: CashierDraft,
  amount: number,
): CashierDraft => {
  if (draft.step !== "pay") return draft;
  const next = Math.min(Number(draft.received || 0) + amount, RECEIVED_MAX);
  return { ...draft, received: String(next), payment: "cash" };
};

/** 受取金額を請求額ちょうどにする。会計の段階だけ */
export const setExactReceived = (
  draft: CashierDraft,
  billing: number,
): CashierDraft => {
  if (draft.step !== "pay") return draft;
  return {
    ...draft,
    received: String(Math.max(billing, 0)),
    payment: "cash",
  };
};

// --------------------------------------------------
// 段階・決済手段
// --------------------------------------------------

/**
 * 会計の段階に進めるか（一括会計）。まだ払っていない商品があるとき。
 * 進むときは、まだ払っていない商品を全部 1 つの小計にする（cashierSplit の beginRest）
 */
export const canGoPay = (draft: CashierDraft): boolean =>
  draft.step === "entry" && unpaidLines(draft).length > 0;

export const setPayment = (
  draft: CashierDraft,
  payment: CashierPayment,
): CashierDraft => ({ ...draft, payment });

/** 会計の段階で ↑↓ を押したとき、使える決済手段を順に選ぶ（端で一周する） */
export const cyclePayment = (
  draft: CashierDraft,
  payments: readonly CashierPayment[],
  step: 1 | -1,
): CashierDraft => {
  if (payments.length === 0) return draft;
  const index = Math.max(payments.indexOf(draft.payment), 0);
  const next = (index + step + payments.length) % payments.length;
  return { ...draft, payment: payments[next], selected: null };
};

// --------------------------------------------------
// キー操作
// --------------------------------------------------

export type CashierKeyIntent =
  /** このキーは扱わない（ブラウザの既定の動きのまま） */
  | { type: "ignore" }
  /** 何もしない（既定の動きは止める） */
  | { type: "none" }
  | { type: "update"; draft: CashierDraft }
  | { type: "openAssign" }
  | { type: "openMemo" }
  /**
   * 一括会計（会計の段階に進む。シールは会計を終えたときに刷る）。
   * payment があれば、進んだらその決済手段を選ぶ（決済手段のキー。Square の決済手段なら決済を始める）
   */
  | { type: "goPay"; payment?: CashierPayment }
  /** 受取金額を請求額ちょうどにする（受取金額が空のときの Enter） */
  | { type: "exactReceived" }
  | { type: "submitCash" }
  | { type: "startSquare"; paymentType: SquarePaymentType }
  /** 決済手段のキーで選んだ Square の決済手段が今使えない（知らせる） */
  | { type: "paymentUnavailable"; paymentType: SquarePaymentType }
  /** 会計の段階の Esc。小計分割をやめる、でなければ会計をやめて入れる段階に戻る */
  | { type: "leavePay" }
  | { type: "reset" };

type KeyContext = {
  /** 商品キーを引くメニュー */
  menus: readonly WithId<MenuEntity>[];
  /** 会計の段階で ↑↓ で選べる決済手段 */
  payments: readonly CashierPayment[];
  /** 押しているキー（このキーも含む）。2 つ以上で同時押しの商品と照らし合わせる */
  held?: readonly string[];
  /** 押しているキーで足した行。同時押しがそろったら同時押しの商品に置き換える */
  heldLineKeys?: readonly number[];
  /** キーを押したままの繰り返し（keydown の repeat）。同時押しの商品は足し直さない */
  repeat?: boolean;
  /** 引換券番号を過去の注文と照らし合わせる（inputDigits） */
  checkCoupon?: (coupon: string) => CouponStatus;
};

const NONE: CashierKeyIntent = { type: "none" };
const update = (draft: CashierDraft): CashierKeyIntent => ({
  type: "update",
  draft,
});

/**
 * レジの画面で押したキーを、何をするかに直す
 *
 * - 商品キー: 商品を足す（入れる段階だけ）。同時押し（「a+s」）は、押しているキーがそろったときに足し、
 *   先に押したキーで足した行を置き換える
 * - 数字: 行を選んでいれば指名（1〜6 は 1st〜6th、0 は指名なし）。
 *   選んでいなければ、入れる段階は引換券番号（3 桁で割引できれば備考に移る）、会計の段階は受取金額
 * - Backspace: 行を選んでいれば削除（一覧から消す）、でなければ数字を 1 桁消す
 * - ↑↓: 入れる段階は 商品 → 割引 → 備考、会計の段階は決済手段
 * - →: 入れる段階は一括会計（右の会計の列に移る）。会計の段階では何もしない
 * - Space: 選んでいる行の指名・備考を開く
 * - Enter: 一括会計・確定（Square なら決済を始める）。
 *   現金で受取金額が空なら、まず受取金額をちょうどにする（もう一度 Enter で確定）
 * - Esc: 入れる段階は入力中の注文を消す。会計の段階は小計分割をやめる・会計をやめる（leavePay）
 */
export const cashierKeyIntent = (
  draft: CashierDraft,
  key: string,
  {
    menus,
    payments,
    held = [key],
    heldLineKeys = [],
    repeat = false,
    checkCoupon,
  }: KeyContext,
): CashierKeyIntent => {
  // 同時押しは、そのキーのどれかを押したときだけ（Shift などを押し足したときは足さない）
  if (held.length >= 2 && held.includes(key)) {
    const chordMenu = menus.find((candidate) => {
      const chord = menuKeyChord(candidate.key);
      return chord !== null && isSameKeySet(chord, held);
    });
    if (chordMenu) {
      return draft.step === "entry" && !repeat
        ? update(addChordLine(draft, chordMenu, heldLineKeys))
        : NONE;
    }
  }
  const menu = menus.find((candidate) => candidate.key === key);
  if (menu) {
    return draft.step === "entry" ? update(addLine(draft, menu)) : NONE;
  }
  if (/^[0-9]$/.test(key)) {
    if (isAssigningByDigits(draft)) {
      // 行を選んでいる間の数字は指名。指名できない行（グッズなど）では何もしない
      return canAssignByDigit(draft, key)
        ? update(assignByDigit(draft, key))
        : NONE;
    }
    return update(inputDigits(draft, key, checkCoupon));
  }
  switch (key) {
    case "Backspace":
      return update(
        draft.selected !== null
          ? removeLine(draft, draft.selected)
          : deleteDigit(draft),
      );
    case "ArrowRight":
      return canGoPay(draft) ? { type: "goPay" } : NONE;
    case "ArrowLeft":
      return NONE;
    case "ArrowUp":
    case "ArrowDown": {
      const step = key === "ArrowDown" ? 1 : -1;
      return update(
        draft.step === "pay"
          ? cyclePayment(draft, payments, step)
          : moveCursor(draft, step),
      );
    }
    case " ":
      if (canAssignSelected(draft)) {
        return { type: "openAssign" };
      }
      if (
        draft.step === "entry" &&
        draft.selected === null &&
        draft.zone === "memo"
      ) {
        return { type: "openMemo" };
      }
      return NONE;
    case "Enter":
      if (draft.step === "pay") {
        if (draft.payment !== "cash") {
          return { type: "startSquare", paymentType: draft.payment };
        }
        return draft.received === ""
          ? { type: "exactReceived" }
          : { type: "submitCash" };
      }
      return canGoPay(draft) ? { type: "goPay" } : NONE;
    case "Escape":
      return draft.step === "pay" ? { type: "leavePay" } : { type: "reset" };
    default:
      // 同時押しに使うキーは、1 つだけでも既定の動き（Firefox の / の検索など）を止める
      return menus.some((candidate) =>
        menuKeyChord(candidate.key)?.includes(key),
      )
        ? NONE
        : { type: "ignore" };
  }
};

/**
 * 決済手段のキー（Alt と一緒に押す。キーパッドの決済のボタン）。左から順にヒントに出す。
 * 配列や Option で出る文字が変わらないよう、KeyboardEvent.code（キーの位置）で引く
 */
export const PAYMENT_KEYS: readonly {
  code: string;
  payment: CashierPayment;
}[] = [
  { code: "KeyC", payment: "cash" },
  { code: "KeyT", payment: "CARD_PRESENT" },
  { code: "KeyQ", payment: "QR_CODE" },
];

/**
 * Alt と一緒に押したキー（code）を、何をするかに直す。決済手段のキーは押したらすぐ決済を始める
 *
 * - 入れる段階: 一括会計に進み、その決済手段を選ぶ。Square の決済手段なら、進んだらその手段で決済を始める
 * - 会計の段階: 現金は選ぶだけ（受取金額を入れて Enter で確定）、Square の決済手段は決済を始める
 * - 今使えない Square の決済手段（端末が決まっていない・つながっていないなど）は知らせる
 * - 押しっぱなしの繰り返し（keydown の repeat）は何もしない（決済を二重に始めない）
 */
export const cashierPaymentKeyIntent = (
  draft: CashierDraft,
  code: string,
  { payments, repeat = false }: Pick<KeyContext, "payments" | "repeat">,
): CashierKeyIntent => {
  const payment = PAYMENT_KEYS.find((key) => key.code === code)?.payment;
  if (payment === undefined) {
    return { type: "ignore" };
  }
  if (repeat) {
    return NONE;
  }
  if (draft.step === "entry") {
    if (!canGoPay(draft)) return NONE;
    return { type: "goPay", payment };
  }
  if (payment === "cash") {
    return update(setPayment(draft, "cash"));
  }
  return payments.includes(payment)
    ? { type: "startSquare", paymentType: payment }
    : { type: "paymentUnavailable", paymentType: payment };
};
