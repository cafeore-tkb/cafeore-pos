import { z } from "zod";
import { OrderEntity, commentSchema, orderSchema } from "./order";

export const globalCashierStateSchema = z.object({
  id: z.literal("cashier-state"),
  edittingOrder: orderSchema,
  submittedOrderId: z.string().nullable(),
});

export type GlobalCashierState = z.infer<typeof globalCashierStateSchema>;

// API から返ってきた JSON では Date が ISO 文字列になっているので Date に戻す。
// Firestore 時代は Timestamp → Date の変換を converter がやっていた分に相当する。
const dateFromWire = z
  .union([z.date(), z.string().datetime({ offset: true })])
  .transform((v) => (v instanceof Date ? v : new Date(v)));

export const cashierStateWireSchema = globalCashierStateSchema.extend({
  edittingOrder: orderSchema.extend({
    createdAt: dateFromWire,
    readyAt: dateFromWire.nullable(),
    servedAt: dateFromWire.nullable(),
    comments: z.array(commentSchema.extend({ createdAt: dateFromWire })),
  }),
});

export class CashierStateEntity implements GlobalCashierState {
  constructor(
    public id: "cashier-state",
    public edittingOrder: OrderEntity,
    public submittedOrderId: string | null,
  ) {}

  static fromCashierState(state: GlobalCashierState): CashierStateEntity {
    return new CashierStateEntity(
      state.id,
      OrderEntity.fromOrder(state.edittingOrder),
      state.submittedOrderId,
    );
  }
}

// オーダーストップの状態。本体は API の /api/master-status にあり、
// 最新の 1 件が WebSocket の master_state で配られる。
export const orderStatTypes = ["stop", "operational"] as const;

export type OrderStatType = (typeof orderStatTypes)[number];
