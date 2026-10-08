import {
  type CupStatus,
  type OrderEntity,
  type WithId,
  orderRepository,
} from "@cafeore/common";
import dayjs from "dayjs";
import type { MetaFunction } from "react-router";
import { toast } from "sonner";
import { ReadyBell } from "~/components/atoms/ReadyBell";
import { ServeCheck } from "~/components/atoms/ServeCheck";
import { InputComment } from "~/components/molecules/InputComment";
import { OrderInfoCard } from "~/components/molecules/OrderInfoCard";
import { PastOrderSideSheet } from "~/components/molecules/PastOrderSideSheet";
import { usePendingStatus } from "~/lib/usePendingStatus";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export const BASE_CLIENT_URL = "https://cafeore-2024.pages.dev";

export const meta: MetaFunction = () => {
  return [{ title: "提供 / 珈琲・俺POS" }];
};

export default function Serve() {
  const { orders } = useOrdersWSContext();

  const unserved = orders?.reduce((acc, cur) => {
    if (cur.servedAt == null) {
      return acc + 1;
    }
    return acc;
  }, 0);

  return (
    <div className="p-4 font-sans">
      <div className="flex justify-between pb-4">
        <h1 className="text-3xl">提供</h1>
        <p>提供待ちオーダー数：{unserved}</p>
        <PastOrderSideSheet
          orders={orders?.filter((order) => order.servedAt !== null)}
          author="serve"
          gray
          cancellable
        />
      </div>

      <div className="grid grid-cols-4 gap-4">
        {orders
          ?.sort((a, b) => a.orderId - b.orderId)
          .map((order) => {
            return (
              order.servedAt === null && (
                <ServeOrderCard key={order.id} order={order} />
              )
            );
          })}
      </div>
    </div>
  );
}

// 提供画面の注文カード。カップを1杯ずつ出し、押すと 準備中 → 提供可能 → 提供済み → 準備中 と回す
const ServeOrderCard = ({ order }: { order: WithId<OrderEntity> }) => {
  // カップの状態も、押してから配信が届くまでの間は押した後の状態を表示する
  const cupPending = usePendingStatus<CupStatus>(order);
  const send =
    (request: typeof orderRepository.readyCup) =>
    (cupId: string, next: CupStatus) =>
      cupPending.run(cupId, next, async () =>
        cupStatusOf(await request(order.id, cupId), cupId),
      );
  const readyCup = send(orderRepository.readyCup);
  const serveCup = send(orderRepository.serveCup);

  // 注文単位の呼び出し・提供も、押してから配信が届くまでの間は押した後の状態を表示する
  const orderPending = usePendingStatus<boolean>(order);
  const isReady = orderPending.statusOf("ready", order.readyAt !== null);
  const changeReady = () => {
    if (orderPending.isBusy("ready")) return;
    orderPending.run("ready", !isReady, () =>
      orderRepository.ready(order.id).then(() => undefined),
    );
  };
  const changeServed = () =>
    orderPending.run("served", order.servedAt === null, () =>
      orderRepository.serve(order.id).then(() => undefined),
    );

  const changeCup = (cupId: string, abbr: string, shown: CupStatus) => {
    if (shown === "preparing") {
      readyCup(cupId, "ready");
      return;
    }
    const description = dayjs().format("H時m分");
    if (shown === "ready") {
      serveCup(cupId, "served");
      toast(`提供完了 No.${order.orderId} ${abbr}`, {
        description,
        action: { label: "取消", onClick: () => serveCup(cupId, "ready") },
      });
      return;
    }
    // 提供済みのカップの準備完了を外すと、提供済みも外れて準備中に戻る。
    // 誤タップで提供を取り消しても気づけるよう、トーストを出す
    readyCup(cupId, "preparing");
    toast(`提供取消 No.${order.orderId} ${abbr}`, {
      description,
      action: { label: "元に戻す", onClick: () => serveCup(cupId, "served") },
    });
  };

  return (
    <OrderInfoCard
      order={order}
      timing="present"
      colorScreen="serve"
      grayed={order.status === "calling"}
      cups={order.getCups().map((cup) => {
        const { cupId } = cup;
        const shown = cupId
          ? cupPending.statusOf(cupId, cup.status)
          : cup.status;
        return {
          ...cup,
          // 提供済みのカップは灰色にし、提供可能になったカップは目立たせる
          gray: shown === "served",
          servable: shown === "ready",
          served: shown === "served",
          busy: cupId !== undefined && cupPending.isBusy(cupId),
          // 押せるのはサーバーが作ったカップだけ。応答待ちの間は押せなくして、ダブルタップで2回進むのを防ぐ
          onClick: cupId
            ? () => {
                if (!cupPending.isBusy(cupId))
                  changeCup(cupId, cup.abbr, shown);
              }
            : undefined,
        };
      })}
    >
      <InputComment
        order={order}
        addComment={(order, descComment) =>
          orderRepository.addComment(order.id, "serve", descComment)
        }
      />
      <div className="mt-4 flex items-center justify-between">
        <ReadyBell
          isReady={isReady}
          busy={orderPending.isBusy("ready")}
          changeReady={changeReady}
        />
        <ServeCheck
          order={order}
          busy={orderPending.isBusy("served")}
          onServe={(order) => {
            // 応答待ちの間にもう一度押すと提供が取り消されてしまうので無視する
            if (orderPending.isBusy("served")) return;
            changeServed();
            toast(`提供完了 No.${order.orderId}`, {
              description: dayjs().format("H時m分"),
              action: { label: "取消", onClick: changeServed },
            });
          }}
        />
      </div>
    </OrderInfoCard>
  );
};

const cupStatusOf = (order: OrderEntity, cupId: string) =>
  order.getCups().find((cup) => cup.cupId === cupId)?.status;
