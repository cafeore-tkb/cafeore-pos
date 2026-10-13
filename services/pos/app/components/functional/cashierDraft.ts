import {
  type MenuEntity,
  type OrderEntity,
  type SquarePaymentType,
  type WithId,
  getDiscountOrderStatus,
} from "@cafeore/common";

/**
 * レジで入力中の注文の下書き（画面の状態）
 *
 * 送る注文（OrderEntity）は、ここから削除していない商品と受取金額を写して作る（cashierAtoms）。
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
  /** 削除した。二重線で一覧に残し、「削除を戻す」で戻せる。送る注文には入れない */
  voided: boolean;
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
   * 一括会計・Square の決済のときに先に刷ったシール（まだ登録していない注文の）。
   * 番号はこのシールの番号のまま確定まで変えず、同じ中身なら刷り直さない
   */
  printedLabel: PrintedLabel | null;
};

export type PrintedLabel = {
  orderId: number;
  /** シールの中身（刷る印刷データ）。中身が変わったら刷り直す */
  key: string;
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
  printedLabel: null,
});

/** 消すと失うものがあるか（商品・引換券番号・特殊な割引・特記事項・受取金額） */
export const hasDraftInput = (draft: CashierDraft): boolean =>
  draft.lines.some((line) => !line.voided) ||
  draft.coupon !== "" ||
  draft.special ||
  draft.memo !== "" ||
  draft.received !== "";

/** 削除していない商品 */
export const activeMenus = (draft: CashierDraft): WithId<MenuEntity>[] =>
  draft.lines.filter((line) => !line.voided).map((line) => line.menu);

/** 指名できる商品か。指名するのはドリッパーで淹れるもの（抽出が要るもの）だけ */
export const canAssignMenu = (menu: MenuEntity): boolean =>
  menu.items.some(({ item }) => item.item_type.needs_brew);

/**
 * 商品を変えられるか。会計の段階ではシールを先に刷っているので変えない
 * （変えるときは会計取消で戻る。取り消しのシールを刷り、新しい番号で刷り直す）
 */
export const canEditLines = (draft: CashierDraft): boolean =>
  draft.step === "entry";

/** 選んでいる行が、今指名できるか（削除していない・抽出が要る） */
export const canAssignSelected = (draft: CashierDraft): boolean => {
  const line = draft.selected === null ? null : draft.lines[draft.selected];
  return !!line && !line.voided && canAssignMenu(line.menu);
};

/** 引換券番号を打てるか（入れる段階で、特殊な割引でなく、行も備考も選んでいない） */
export const canEditCoupon = (draft: CashierDraft): boolean =>
  draft.step === "entry" &&
  !draft.special &&
  draft.selected === null &&
  draft.zone === "coupon";

// --------------------------------------------------
// 商品
// --------------------------------------------------

/** 商品を足す。会計の段階では足さない */
export const addLine = (
  draft: CashierDraft,
  menu: WithId<MenuEntity>,
): CashierDraft => {
  if (draft.step !== "entry") return draft;
  return {
    ...draft,
    lines: [...draft.lines, { key: draft.nextKey, menu, voided: false }],
    nextKey: draft.nextKey + 1,
  };
};

/** 行を削除する（削除した行は戻す）。選んでいた行は外す */
export const toggleVoid = (
  draft: CashierDraft,
  index: number,
): CashierDraft => {
  if (!canEditLines(draft) || !draft.lines[index]) return draft;
  return {
    ...draft,
    lines: draft.lines.map((line, i) =>
      i === index ? { ...line, voided: !line.voided } : line,
    ),
    selected: null,
    zone: "coupon",
  };
};

/** 全部の行を削除する */
export const voidAll = (draft: CashierDraft): CashierDraft =>
  canEditLines(draft)
    ? {
        ...draft,
        lines: draft.lines.map((line) =>
          line.voided ? line : { ...line, voided: true },
        ),
        selected: null,
        zone: "coupon",
      }
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
  | { kind: "unserved" };

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
  return { kind: status === "already_used" ? "already_used" : "unserved" };
};

/** 引換券番号の欄を選ぶ */
export const focusCoupon = (draft: CashierDraft): CashierDraft =>
  draft.step === "entry" && !draft.special
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
 * 付けるときも外すときも、引換券番号は消す
 */
export const toggleSpecial = (
  draft: CashierDraft,
  couponApplied: boolean,
): CashierDraft => {
  if (!draft.special && couponApplied) return draft;
  return { ...draft, special: !draft.special, coupon: "" };
};

export const setMemo = (draft: CashierDraft, memo: string): CashierDraft => ({
  ...draft,
  memo,
});

// --------------------------------------------------
// 数字（入れる段階は引換券番号、会計の段階は受取金額）
// --------------------------------------------------

/** 数字を打つ。入れる段階は引換券番号に、会計の段階は受取金額に足す（現金にする） */
export const inputDigits = (
  draft: CashierDraft,
  digits: string,
): CashierDraft => {
  if (draft.step === "entry") {
    if (!canEditCoupon(draft) || draft.coupon.length >= COUPON_DIGITS) {
      return draft;
    }
    return {
      ...draft,
      coupon: (draft.coupon + digits).slice(0, COUPON_DIGITS),
    };
  }
  const received = (draft.received + digits).replace(/^0+/, "");
  if (received.length > RECEIVED_MAX_DIGITS) {
    return { ...draft, payment: "cash" };
  }
  return { ...draft, received, payment: "cash" };
};

/** 1 桁消す */
export const deleteDigit = (draft: CashierDraft): CashierDraft => {
  if (draft.step === "entry") {
    return canEditCoupon(draft)
      ? { ...draft, coupon: draft.coupon.slice(0, -1) }
      : draft;
  }
  return { ...draft, received: draft.received.slice(0, -1) };
};

/** 全部消す */
export const clearDigits = (draft: CashierDraft): CashierDraft => {
  if (draft.step === "entry") {
    return canEditCoupon(draft) ? { ...draft, coupon: "" } : draft;
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

/** 会計の段階に進む（一括会計）。商品が無ければ進まない */
export const goPay = (draft: CashierDraft): CashierDraft => {
  if (draft.step === "pay" || activeMenus(draft).length === 0) return draft;
  return { ...draft, step: "pay", selected: null, payment: "cash" };
};

/** 入れる段階に戻る（会計取消）。受取金額は残す */
export const backToEntry = (draft: CashierDraft): CashierDraft =>
  draft.step === "entry" ? draft : { ...draft, step: "entry" };

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
  /** 一括会計（シールを刷って会計の段階に進む） */
  | { type: "goPay" }
  /** 受取金額を請求額ちょうどにする（受取金額が空のときの Enter） */
  | { type: "exactReceived" }
  | { type: "submitCash" }
  | { type: "startSquare"; paymentType: SquarePaymentType }
  | { type: "reset" };

type KeyContext = {
  /** 商品キーを引くメニュー */
  menus: readonly WithId<MenuEntity>[];
  /** 会計の段階で ↑↓ で選べる決済手段 */
  payments: readonly CashierPayment[];
};

const NONE: CashierKeyIntent = { type: "none" };
const update = (draft: CashierDraft): CashierKeyIntent => ({
  type: "update",
  draft,
});

/**
 * レジの画面で押したキーを、何をするかに直す
 *
 * - 商品キー: 商品を足す（入れる段階だけ）
 * - 数字: 入れる段階は引換券番号、会計の段階は受取金額
 * - Backspace: 行を選んでいれば削除（戻す）、でなければ数字を 1 桁消す
 * - ↑↓: 入れる段階は 商品 → 割引 → 備考、会計の段階は決済手段
 * - Space: 選んでいる行を指名する
 * - Enter: 備考を選んでいれば備考を開く・一括会計・確定（Square なら決済を始める）。
 *   現金で受取金額が空なら、まず受取金額をちょうどにする（もう一度 Enter で確定）
 * - Esc: 入力中の注文を消す
 */
export const cashierKeyIntent = (
  draft: CashierDraft,
  key: string,
  { menus, payments }: KeyContext,
): CashierKeyIntent => {
  const menu = menus.find((candidate) => candidate.key === key);
  if (menu) {
    return draft.step === "entry" ? update(addLine(draft, menu)) : NONE;
  }
  if (/^[0-9]$/.test(key)) {
    return update(inputDigits(draft, key));
  }
  switch (key) {
    case "Backspace":
      return update(
        draft.selected !== null
          ? toggleVoid(draft, draft.selected)
          : deleteDigit(draft),
      );
    case "ArrowLeft":
    case "ArrowRight":
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
      return canAssignSelected(draft) ? { type: "openAssign" } : NONE;
    case "Enter":
      if (draft.step === "pay") {
        if (draft.payment !== "cash") {
          return { type: "startSquare", paymentType: draft.payment };
        }
        return draft.received === ""
          ? { type: "exactReceived" }
          : { type: "submitCash" };
      }
      if (draft.selected === null && draft.zone === "memo") {
        return { type: "openMemo" };
      }
      return activeMenus(draft).length > 0 ? { type: "goPay" } : NONE;
    case "Escape":
      return { type: "reset" };
    default:
      return { type: "ignore" };
  }
};
