import {
  type CupStatus,
  type OrderEntity,
  type WithId,
  orderRepository,
} from "@cafeore/common";
import { usePendingStatus } from "~/lib/usePendingStatus";

/**
 * マスター・提供画面で、注文のカップを1杯ずつ出して、押して状態を切り替える。
 * 押してから配信が届くまでの間も、押した後の状態（shown）を出す。
 * `enabled` が false（過去の注文）なら押せない。
 */
export const useCupActions = (order: WithId<OrderEntity>, enabled: boolean) => {
  const pending = usePendingStatus<CupStatus>(order);

  const send =
    (request: typeof orderRepository.readyCup) =>
    (cupId: string, next: CupStatus) =>
      pending.run(cupId, next, async () =>
        cupStatusOf(await request(order.id, cupId), cupId),
      );

  const cups = order.getCups().map((cup) => ({
    ...cup,
    shown: cup.cupId ? pending.statusOf(cup.cupId, cup.status) : cup.status,
    busy: cup.cupId !== undefined && pending.isBusy(cup.cupId),
    // 一部だけ提供済みの注文で、提供済みのカップを見分けられるようにする
    partlyServed: order.status !== "served" && cup.status === "served",
  }));

  // 押せるカップ（サーバーが作ったカップ）だけ、押したときの動きを返す。
  // 応答待ちの間は押せなくして、ダブルタップで2回進むのを防ぐ
  const press = (
    cupId: string | undefined,
    action: (cupId: string) => void,
  ) => {
    if (!enabled || !cupId) return undefined;
    return () => {
      if (!pending.isBusy(cupId)) action(cupId);
    };
  };

  return {
    cups,
    press,
    readyCup: send(orderRepository.readyCup),
    serveCup: send(orderRepository.serveCup),
  };
};

const cupStatusOf = (order: OrderEntity, cupId: string) =>
  order.getCups().find((cup) => cup.cupId === cupId)?.status;
