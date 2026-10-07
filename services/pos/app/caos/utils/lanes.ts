import { type CaosLane, STANDBY_LABEL, laneOrdinal } from "@cafeore/common";
import type { Barista, BeanCode } from "../types";

// 列（ドリッパー 1〜6）と、その担当者。担当者はサーバーの盤面（caos_lanes）にあり、WebSocket の drips で届く。
// 列は「1st」〜「6th」と呼び、担当者がいれば名前を添える（例「1st 山田」）。担当者のいない列は番号だけ。

export { laneOrdinal };

export const BAY_IDS = [1, 2, 3, 4, 5, 6] as const;

/** 列の呼び方（例「1st 山田」、担当者がいなければ「1st」） */
export const laneTitle = (barista: Pick<Barista, "bayNumber" | "name">) =>
  barista.name
    ? `${laneOrdinal(barista.bayNumber)} ${barista.name}`
    : laneOrdinal(barista.bayNumber);

/** サーバーの列の担当者から、カードの無い 6 列を作る（届く前は全部の列が担当者なし） */
export const makeLaneBaristas = (lanes: CaosLane[] | null): Barista[] =>
  BAY_IDS.map((id): Barista => {
    const lane = lanes?.find((item) => item.dripper === id);
    return {
      id,
      bayNumber: id,
      name: lane?.name ?? "",
      senior: Boolean(lane?.name && lane.senior),
      status: "standby",
      remainingStr: STANDBY_LABEL,
      queue: [],
      pastTickets: [],
    };
  });

/**
 * 限定のカードか。今の画面の判定（商品の種類が limited のカードは豆のコード SP）をそのまま使う。
 * あとで商品の種類の senior_only に置き換える（ここ 1 か所を直す）
 */
export const isLimitedCard = (card: { beanCode: BeanCode }) =>
  card.beanCode === "SP";

/** そのカードを割り当て・移動できる列（指名があればその列だけ、限定のカードは上級生の列だけ） */
export const allowedBayIdsFor = (
  card: { beanCode: BeanCode; preferredBaristaId?: number },
  baristas: Pick<Barista, "id" | "senior">[],
) =>
  BAY_IDS.filter(
    (id) =>
      (!card.preferredBaristaId || card.preferredBaristaId === id) &&
      (!isLimitedCard(card) ||
        Boolean(baristas.find((barista) => barista.id === id)?.senior)),
  );

/**
 * そのカードをその列へ割り当て・移動できるか。盤面のカード（本番・練習用とも）は allowedBayIds（指名と上級生）で、
 * allowedBayIds が無いカードは指名だけで決める
 */
export const canPlaceOn = (
  card: { preferredBaristaId?: number; allowedBayIds?: number[] },
  bayId: number,
) =>
  card.allowedBayIds
    ? card.allowedBayIds.includes(bayId)
    : !card.preferredBaristaId || card.preferredBaristaId === bayId;
