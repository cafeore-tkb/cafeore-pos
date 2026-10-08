import { z } from "zod";
import { itemSchema } from "./item";

/**
 * 注文の1杯。注文明細（メニュー）の構成品を数量分に展開したもの（グッズは含まない）。
 * 注文を保存したときにサーバーが作る。
 */
export const cupSchema = z.object({
  id: z.string(),
  orderMenuId: z.string(),
  item: itemSchema.required(),
  readyAt: z.date().nullable(),
  servedAt: z.date().nullable(),
});

export type Cup = z.infer<typeof cupSchema>;

/**
 * カップの状態
 * preparing: 準備中 / ready: 準備完了 / served: 提供済み
 */
export type CupStatus = "preparing" | "ready" | "served";

export const getCupStatus = (
  cup: Pick<Cup, "readyAt" | "servedAt">,
): CupStatus => {
  if (cup.servedAt !== null) {
    return "served";
  }
  if (cup.readyAt !== null) {
    return "ready";
  }
  return "preparing";
};
