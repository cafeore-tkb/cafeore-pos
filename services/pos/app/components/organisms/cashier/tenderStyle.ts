import type { SquarePaymentType } from "@cafeore/common";
import { squarePaymentTypeLabel } from "../SquarePaymentDialog";

/** 受け取った支払いの決済手段（現金か、Square の決済画面の種類） */
export type TenderMethod = {
  method: "cash" | "square";
  squarePaymentType?: SquarePaymentType | string;
};

/** 決済手段の表示（「現金」「カード」など） */
export const tenderLabel = ({ method, squarePaymentType }: TenderMethod) =>
  method === "cash"
    ? "現金"
    : ((squarePaymentType &&
        squarePaymentTypeLabel[squarePaymentType as SquarePaymentType]) ??
      "Square");

const SQUARE_DOT: Record<SquarePaymentType, string> = {
  CARD_PRESENT: "var(--color-theme-deep)",
  FELICA_ALL: "var(--color-emoney)",
  QR_CODE: "var(--color-theme-primary)",
};

/** 決済手段の印の色（内訳の行・帯） */
export const tenderDot = ({ method, squarePaymentType }: TenderMethod) =>
  method === "cash"
    ? "var(--color-cash)"
    : (SQUARE_DOT[squarePaymentType as SquarePaymentType] ??
      "var(--color-theme-primary)");
