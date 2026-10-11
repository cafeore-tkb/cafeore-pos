import {
  type OrderEntity,
  type OrderStatType,
  type WithId,
  cupNeedsBrew,
  orderRepository,
  orderStatTypes,
  updateMasterStatus,
} from "@cafeore/common";
import { parseWithZod } from "@conform-to/zod";
import { useCallback } from "react";
import {
  type ClientActionFunction,
  type MetaFunction,
  useSubmit,
} from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import {
  type EmergencyCup,
  useCupEmergency,
} from "~/components/functional/useCupEmergency";
import { useOrderStat } from "~/components/functional/useOrderStat";
import { InputComment } from "~/components/molecules/InputComment";
import {
  OrderInfoCard,
  WaitingLabel,
} from "~/components/molecules/OrderInfoCard";
import { PastOrderSideSheet } from "~/components/molecules/PastOrderSideSheet";
import { PendingPrints } from "~/components/molecules/PendingPrints";
import { TwoStepButton } from "~/components/molecules/TwoStepButton";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export const meta: MetaFunction = () => {
  return [{ title: "マスター / 珈琲・俺POS" }];
};

export default function FielsOfMaster() {
  const { orders } = useOrdersWSContext();
  const submit = useSubmit();
  const isOperational = useOrderStat();
  const { printer, addEmergency, cancelEmergency } = useCupEmergency();

  const submitOrderStatChange = useCallback(
    (status: OrderStatType) => {
      submit(
        {
          intent: "changeOrderStat",
          status,
        },
        { method: "POST" },
      );
    },
    [submit],
  );

  const unserved = orders?.reduce((acc, cur) => {
    if (cur.servedAt == null) {
      return acc + 1;
    }
    return acc;
  }, 0);

  return (
    <div className="p-4 font-sans">
      <div className="flex justify-between pb-4">
        <h1 className="w-1/3 text-3xl">マスター</h1>
        <div className="flex w-1/3 justify-center">
          <Button
            type="button"
            className={cn(isOperational ? "bg-red-700" : "bg-sky-700")}
            onClick={() =>
              submitOrderStatChange(isOperational ? "stop" : "operational")
            }
          >
            {isOperational ? "オーダーストップする" : "オーダー再開する"}
          </Button>
        </div>
        <div className="flex w-1/3 items-center justify-end gap-3">
          <PendingPrints count={printer.pendingCount} onRetry={printer.retry} />
          <p>提供待ちオーダー数：{unserved}</p>
          <PastOrderSideSheet
            orders={orders?.filter((order) => order.servedAt !== null)}
            author="master"
            gray
          />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {orders?.map((order) => {
          return (
            order.servedAt === null && (
              <MasterOrderCard
                key={order.id}
                order={order}
                onEmergency={addEmergency}
                onCancelEmergency={(id) => cancelEmergency([id])}
              />
            )
          );
        })}
      </div>
    </div>
  );
}

// マスター画面の注文カード。カップを1杯ずつ出す（押して状態を変えることはしない。準備完了は CaOS と提供画面で付ける）。
// 抽出が要るカップには緊急（入れ直し）のボタンと、まだ抽出を始めていない入れ直しがあればその取り消し（最後に足したもの）を付ける
const MasterOrderCard = ({
  order,
  onEmergency,
  onCancelEmergency,
}: {
  order: WithId<OrderEntity>;
  onEmergency: (cups: EmergencyCup[]) => void;
  onCancelEmergency: (emergencyId: string) => void;
}) => {
  const calling = order.status === "calling";
  const brewCups = new Map(
    order.cups.filter(cupNeedsBrew).map((cup) => [cup.id, cup]),
  );
  return (
    <OrderInfoCard
      order={order}
      timing="present"
      colorScreen="master"
      grayed={calling}
      cups={order.getCups().map(({ cupId, ...cup }) => ({
        ...cup,
        cupId,
        // 呼び出し中の注文のカップと、準備完了・提供済みのカップは灰色にする
        gray: calling || cup.status !== "preparing",
        action: cupId && brewCups.has(cupId) && (
          <EmergencyActions
            cancelableId={
              brewCups
                .get(cupId)
                ?.emergencies.findLast(
                  (emergency) => emergency.brewStartedAt === null,
                )?.id
            }
            onEmergency={() => onEmergency([{ order, cupId }])}
            onCancel={onCancelEmergency}
          />
        ),
      }))}
    >
      <InputComment
        order={order}
        addComment={(order, text) =>
          orderRepository.addComment(order.id, "master", text)
        }
      />
      <WaitingLabel order={order} />
    </OrderInfoCard>
  );
};

// カップの下の緊急と、その取り消し（どちらも 2 回押しで決める）
const EmergencyActions = ({
  cancelableId,
  onEmergency,
  onCancel,
}: {
  cancelableId: string | undefined;
  onEmergency: () => void;
  onCancel: (emergencyId: string) => void;
}) => (
  <div className="mt-1 grid gap-1">
    <TwoStepButton
      label="緊急"
      confirmLabel="入れ直す"
      onConfirm={onEmergency}
    />
    {cancelableId && (
      <TwoStepButton
        label="緊急を取り消す"
        confirmLabel="取り消す"
        onConfirm={() => onCancel(cancelableId)}
      />
    )}
  </div>
);

export const clientAction: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "changeOrderStat") {
    const schema = z.object({
      intent: z.literal("changeOrderStat"),
      status: z.enum(orderStatTypes),
    });

    const submission = parseWithZod(formData, { schema });

    if (submission.status !== "success") {
      console.error(submission.error);
      return submission.reply();
    }

    const { status } = submission.value;

    try {
      await updateMasterStatus(status);
    } catch (e) {
      console.error(e);
      toast.error(
        status === "stop"
          ? "オーダーストップできませんでした"
          : "オーダーを再開できませんでした",
      );
      // エラーの Response を返すとエラー画面に切り替わってしまうので、通知だけにする
      return null;
    }

    return new Response("ok");
  }

  return new Response("Bad Request", { status: 400 });
};
