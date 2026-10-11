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
  // CaOS（ドリップ管制）が決めたこと（API の同じ名前の列）。CaOS 以外の画面は読まない。
  // 読み方は lib/caos-board.ts（状態は時刻で決まる）。前に保存したデータには無いので、無ければ未割当
  /** ドリッパーの番号（1〜6）。未割当なら null */
  dripper: z.number().int().nullable().default(null),
  /** ドリッパーの中の順番（整数。小さいほど先。サーバーが決める） */
  dripperPosition: z.number().int().nullable().default(null),
  /** 同じカードで淹れるカップの印 */
  dripId: z.string().nullable().default(null),
  /** 抽出を始めた時刻 */
  brewStartedAt: z.date().nullable().default(null),
  /** 抽出を終えた時刻 */
  brewFinishedAt: z.date().nullable().default(null),
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
