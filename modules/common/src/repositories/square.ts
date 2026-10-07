import createClient from "openapi-fetch";
import type { components, paths } from "../types/api";
import { API_BASE_URL } from "./item";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

export type SquareStatus = components["schemas"]["SquareStatusResponse"];
export type SquareCheckout = components["schemas"]["SquareCheckoutResponse"];
export type SquarePaymentType = components["schemas"]["SquarePaymentType"];
export type SquareCheckoutOutcome =
  components["schemas"]["SquareCheckoutOutcome"];

/**
 * 決済依頼が進行中・取り消せないなど、API が 409 を返したときのエラー
 *
 * checkout にはサーバーが見た最新の決済依頼が入っている。
 */
export class SquareCheckoutConflictError extends Error {
  constructor(
    message: string,
    public readonly checkout: SquareCheckout,
  ) {
    super(message);
    this.name = "SquareCheckoutConflictError";
  }
}

const errorMessage = (error: unknown, fallback: string): string => {
  if (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    typeof error.error === "string"
  ) {
    return error.error;
  }
  return fallback;
};

const isConflict = (
  error: unknown,
): error is components["schemas"]["SquareCheckoutConflictResponse"] =>
  typeof error === "object" &&
  error !== null &&
  "checkout" in error &&
  typeof error.checkout === "object";

export const squareRepository = {
  /** Square 連携が使えるか（未設定ならレジは Square のボタンを出さない） */
  async getStatus(): Promise<SquareStatus> {
    const { data, error } = await client.GET("/api/square/status");
    if (!data) {
      throw new Error(errorMessage(error, "Square の状態を取得できません"));
    }
    return data;
  },

  /**
   * 端末に決済画面を出す
   *
   * idempotencyKey は決済ごとに1つ作り、再送では同じ値を使う（二重に画面が出ない）。
   * 別の決済が進行中なら SquareCheckoutConflictError を投げる。
   * Square が受け付けなかったときは outcome が failed の決済依頼を返す。
   */
  async createCheckout(params: {
    idempotencyKey: string;
    amount: number;
    paymentType: SquarePaymentType;
    orderNumber: number | null;
  }): Promise<SquareCheckout> {
    const { data, error, response } = await client.POST(
      "/api/square/checkouts",
      {
        body: {
          idempotency_key: params.idempotencyKey,
          amount: params.amount,
          payment_type: params.paymentType,
          order_number: params.orderNumber,
        },
      },
    );
    if (data) {
      return data;
    }
    if (response.status === 409 && isConflict(error)) {
      throw new SquareCheckoutConflictError(error.error, error.checkout);
    }
    // 502 は Square が断ったとき。本文は決済依頼そのもの（error_message 付き）。
    if (response.status === 502 && error && "id" in error) {
      return error as SquareCheckout;
    }
    throw new Error(errorMessage(error, "決済を開始できませんでした"));
  },

  /** 決済依頼の最新の状態（未確定ならサーバーが Square に問い合わせる） */
  async getCheckout(id: string): Promise<SquareCheckout> {
    const { data, error } = await client.GET("/api/square/checkouts/{id}", {
      params: { path: { id } },
    });
    if (!data) {
      throw new Error(errorMessage(error, "決済の状態を取得できません"));
    }
    return data;
  },

  /** 決済依頼を取り消す（既に完了しているなどで取り消せなければ SquareCheckoutConflictError） */
  async cancelCheckout(id: string): Promise<SquareCheckout> {
    const { data, error, response } = await client.POST(
      "/api/square/checkouts/{id}/cancel",
      { params: { path: { id } } },
    );
    if (data) {
      return data;
    }
    if (response.status === 409 && isConflict(error)) {
      throw new SquareCheckoutConflictError(error.error, error.checkout);
    }
    throw new Error(errorMessage(error, "決済を取り消せませんでした"));
  },

  /** 支払い済みなのに注文と結び付いていない決済依頼（照合用） */
  async findUnlinked(): Promise<SquareCheckout[]> {
    const { data, error } = await client.GET("/api/square/checkouts/unlinked");
    if (!data) {
      throw new Error(errorMessage(error, "未登録の決済を取得できません"));
    }
    return data;
  },
};
