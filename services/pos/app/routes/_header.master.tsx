import {
  type OrderEntity,
  type OrderStatType,
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
import { useOrderStat } from "~/components/functional/useOrderStat";
import { OrderInfoCard } from "~/components/molecules/OrderInfoCard";
import { PastOrderSideSheet } from "~/components/molecules/PastOrderSideSheet";
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

  const mutateOrder = async (servedOrder: OrderEntity, descComment: string) => {
    if (!servedOrder.id) return;

    submit(
      {
        intent: "addComment",
        servedOrderId: servedOrder.id,
        descComment,
      },
      { method: "POST" },
    );
  };

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
          <p>提供待ちオーダー数：{unserved}</p>
          <PastOrderSideSheet
            orders={orders}
            cardUser={"master"}
            cardTiming={"past"}
            comment={mutateOrder}
          />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {orders?.map((order) => {
          return (
            order.servedAt === null && (
              <OrderInfoCard
                key={order.id}
                order={order}
                timing={"present"}
                user={"master"}
                comment={mutateOrder}
              />
            )
          );
        })}
      </div>
    </div>
  );
}

export const clientAction: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "addComment") {
    const schema = z.object({
      intent: z.literal("addComment"),
      servedOrderId: z.string().min(1),
      descComment: z.string(),
    });

    const submission = parseWithZod(formData, { schema });

    if (submission.status !== "success") {
      console.error(submission.error);
      return submission.reply();
    }

    const { servedOrderId, descComment } = submission.value;

    await orderRepository.addComment(servedOrderId, "master", descComment);

    return new Response("ok");
  }

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

    // 書くのは API だけ。各画面の表示は WebSocket の master_state で切り替わる
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
