import { MenuEntity, menuSchema } from "@cafeore/common";
import { z } from "zod";
import { type CashierDraft, emptyCashierDraft } from "./cashierDraft";
import { hasTenders } from "./cashierSplit";

/**
 * 先払い（個別小計・小計分割）の途中の状態。サーバー（/api/cashier-state/prepay）に置く
 *
 * 受け取った支払い（tenders）は、注文全体を払い終えて注文を送るまでレジの下書きにしか無いので、
 * 変わるたびにサーバーにも送って残す（受け取った額の記録）。レジを開き直したら、これで先払いの途中に戻せる。
 * 下書きのうち戻すのに要るもの（商品の行・割引・特記事項・レシートに載せた番号・小計と支払い）だけを持ち、
 * 選んでいる行・受取金額・決済手段など、今の操作だけのものは持たない。
 * サーバーの形の確かめ（api の cashierPrepaySpec）と揃える
 */

const subtotalSchema = z.object({
  id: z.number().int(),
  kind: z.enum(["items", "rest"]),
  lineKeys: z.array(z.number().int()).min(1),
  total: z.number().int(),
  discountCups: z.number().int(),
  discount: z.number().int(),
  amount: z.number().int(),
});

const tenderSchema = z.object({
  id: z.number().int(),
  subtotalId: z.number().int(),
  method: z.enum(["cash", "square"]),
  amount: z.number().int(),
  received: z.number().int(),
  squareCheckoutId: z.string().uuid().optional(),
  squarePaymentType: z
    .enum(["CARD_PRESENT", "FELICA_ALL", "QR_CODE"])
    .optional(),
});

export const cashierPrepaySchema = z.object({
  /** レシートに載せた注文番号（No.）。確定するときもこの番号にする */
  orderId: z.number().int().positive(),
  lines: z
    .array(
      z.object({
        key: z.number().int(),
        menu: menuSchema.required({ id: true }),
      }),
    )
    .min(1),
  nextKey: z.number().int(),
  coupon: z.string(),
  special: z.boolean(),
  memo: z.string(),
  split: z.object({
    subtotals: z.array(subtotalSchema).min(1),
    tenders: z.array(tenderSchema).min(1),
    current: z.number().int().nullable(),
    part: z.number().int().positive().nullable(),
    discountFirst: z.array(z.number().int()),
    nextId: z.number().int(),
  }),
});

export type CashierPrepay = z.infer<typeof cashierPrepaySchema>;

/**
 * 先払いがあれば、サーバーに送る途中の状態を作る。無ければ null（サーバーの記録を消す）。
 * orderId は今の注文番号。先払いのレシートで固定した番号（fixedOrderId）があればそちらを使う
 */
export const prepaySnapshot = (
  draft: CashierDraft,
  orderId: number,
): CashierPrepay | null =>
  hasTenders(draft)
    ? {
        orderId: draft.fixedOrderId ?? orderId,
        lines: draft.lines.map((line) => ({
          key: line.key,
          menu: line.menu.toMenu(),
        })),
        nextKey: draft.nextKey,
        coupon: draft.coupon,
        special: draft.special,
        memo: draft.memo,
        split: draft.split,
      }
    : null;

/** 受け取った額の合計（戻すか尋ねるときに出す） */
export const prepayPaid = (prepay: CashierPrepay): number =>
  prepay.split.tenders.reduce((acc, tender) => acc + tender.amount, 0);

/** サーバーに残っていた途中の状態を読む。読めなければ（形が違えば）null */
export const parsePrepay = (saved: unknown): CashierPrepay | null => {
  const parsed = cashierPrepaySchema.safeParse(saved);
  return parsed.success ? parsed.data : null;
};

/**
 * 途中の状態から、先払いの途中の下書きを作る。番号はレシートに載せた番号に固定する。
 * 会計中の小計があれば会計の段階（受取金額は空・現金）、無ければ入れる段階に戻る
 */
export const restorePrepay = (prepay: CashierPrepay): CashierDraft => ({
  ...emptyCashierDraft(),
  lines: prepay.lines.map((line) => ({
    key: line.key,
    menu: MenuEntity.fromMenu(line.menu),
  })),
  nextKey: prepay.nextKey,
  coupon: prepay.coupon,
  special: prepay.special,
  memo: prepay.memo,
  step: prepay.split.current === null ? "entry" : "pay",
  fixedOrderId: prepay.orderId,
  split: prepay.split,
});
