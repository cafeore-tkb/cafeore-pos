import { apiClient } from "../api/client";
import type { components } from "../types/api";

export type SquareStatus = components["schemas"]["SquareStatusResponse"];
export type SquareDevice = components["schemas"]["SquareDeviceResponse"];
export type SquareCheckout = components["schemas"]["SquareCheckoutResponse"];
export type SquarePaymentType = components["schemas"]["SquarePaymentType"];
export type SquareCheckoutOutcome =
  components["schemas"]["SquareCheckoutOutcome"];
export type SquareRefundStatus = components["schemas"]["SquareRefundStatus"];

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

const refundResult = (
  data: SquareCheckout | undefined,
  error: unknown,
  response: Response,
): SquareCheckout => {
  if (data) {
    return data;
  }
  if (response.status === 409 && isConflict(error)) {
    throw new SquareCheckoutConflictError(error.error, error.checkout);
  }
  // 502 は Square が断った・応答が無かったとき。本文は決済依頼そのもの（refund_error 付き）。
  if (
    response.status === 502 &&
    typeof error === "object" &&
    error !== null &&
    "id" in error
  ) {
    return error as SquareCheckout;
  }
  throw new Error(errorMessage(error, "返金できませんでした"));
};

export const squareRepository = {
  /** Square 連携が使えるか（未設定ならレジは Square のボタンを出さない） */
  async getStatus(): Promise<SquareStatus> {
    const { data, error } = await apiClient.GET("/api/square/status");
    if (!data) {
      throw new Error(errorMessage(error, "Square の状態を取得できません"));
    }
    return data;
  },

  /**
   * 端末に決済画面を出す
   *
   * idempotencyKey は決済ごとに1つ作り、再送では同じ値を使う（二重に画面が出ない）。
   * 同じ端末で別の決済が進行中なら SquareCheckoutConflictError を投げる。
   * Square が受け付けなかったときは outcome が failed の決済依頼を返す。
   */
  async createCheckout(params: {
    idempotencyKey: string;
    /** 決済画面を出す端末（ペアリング済みの端末の device_id） */
    deviceId: string;
    amount: number;
    paymentType: SquarePaymentType;
    orderNumber: number | null;
  }): Promise<SquareCheckout> {
    const { data, error, response } = await apiClient.POST(
      "/api/square/checkouts",
      {
        body: {
          idempotency_key: params.idempotencyKey,
          device_id: params.deviceId,
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
    const { data, error } = await apiClient.GET("/api/square/checkouts/{id}", {
      params: { path: { id } },
    });
    if (!data) {
      throw new Error(errorMessage(error, "決済の状態を取得できません"));
    }
    return data;
  },

  /** 決済依頼を取り消す（既に完了しているなどで取り消せなければ SquareCheckoutConflictError） */
  async cancelCheckout(id: string): Promise<SquareCheckout> {
    const { data, error, response } = await apiClient.POST(
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

  /**
   * 支払い済みの決済を全額返金する。注文と結び付いていれば、その注文は消える
   *
   * Square が受け付ければ refund_status が pending か refunded の決済依頼を返す。
   * Square が断った（交通系 IC など）ときは refund_status が failed、応答が無く返金できたか
   * 分からないときは unknown の決済依頼を返す（unknown はもう一度呼ぶと確かめられる）。
   * 支払いを確かめられていない・返金を頼んでいる途中なら SquareCheckoutConflictError を投げる。
   */
  async refundCheckout(id: string): Promise<SquareCheckout> {
    const { data, error, response } = await apiClient.POST(
      "/api/square/checkouts/{id}/refund",
      { params: { path: { id } } },
    );
    return refundResult(data, error, response);
  },

  /** 注文に使った Square の決済を全額返金し、注文を消す（戻り値と例外は refundCheckout と同じ） */
  async refundOrder(orderId: string): Promise<SquareCheckout> {
    const { data, error, response } = await apiClient.POST(
      "/api/orders/{id}/square-refund",
      { params: { path: { id: orderId } } },
    );
    return refundResult(data, error, response);
  },

  /** 支払い済みなのに注文と結び付いていない決済依頼（照合用） */
  async findUnlinked(): Promise<SquareCheckout[]> {
    const { data, error } = await apiClient.GET(
      "/api/square/checkouts/unlinked",
    );
    if (!data) {
      throw new Error(errorMessage(error, "未登録の決済を取得できません"));
    }
    return data;
  },

  /** 登録した端末とペアリング待ちのコード（ペアリング待ちはサーバーが Square に問い合わせる） */
  async listDevices(): Promise<SquareDevice[]> {
    const { data, error } = await apiClient.GET("/api/square/devices");
    if (!data) {
      throw new Error(errorMessage(error, "Square 端末の一覧を取得できません"));
    }
    return data;
  },

  /** 端末をペアリングするコードを発行する。返ってきた code を端末に入力する */
  async pairDevice(name: string): Promise<SquareDevice> {
    const { data, error } = await apiClient.POST("/api/square/devices/pair", {
      body: { name },
    });
    if (!data) {
      throw new Error(errorMessage(error, "コードを発行できませんでした"));
    }
    return data;
  },

  /** ペアリングせずに device_id を登録する（Sandbox のテスト用 device_id など） */
  async registerDevice(params: {
    name: string;
    deviceId: string;
  }): Promise<SquareDevice> {
    const { data, error } = await apiClient.POST("/api/square/devices", {
      body: { name: params.name, device_id: params.deviceId },
    });
    if (!data) {
      throw new Error(errorMessage(error, "端末を登録できませんでした"));
    }
    return data;
  },

  /** Square でペアリング済みの端末のうち、まだ登録していないものを取り込む。取り込んだ端末を返す */
  async importDevices(): Promise<SquareDevice[]> {
    const { data, error } = await apiClient.POST("/api/square/devices/import");
    if (!data) {
      throw new Error(errorMessage(error, "端末を取り込めませんでした"));
    }
    return data;
  },

  /** 端末を一覧から外す（端末は Square にサインインしたまま） */
  async deleteDevice(id: string): Promise<void> {
    const { error, response } = await apiClient.DELETE(
      "/api/square/devices/{id}",
      { params: { path: { id } } },
    );
    if (!response.ok) {
      throw new Error(errorMessage(error, "端末を外せませんでした"));
    }
  },
};
