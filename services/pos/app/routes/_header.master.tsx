import {
  MasterStateEntity,
  OrderEntity,
  type OrderStatType,
  collectionSub,
  masterRepository,
  orderConverter,
  orderRepository,
  orderSchema,
  orderStatTypes,
  stringToJSONSchema,
} from "@cafeore/common";
import { parseWithZod } from "@conform-to/zod";
import { type ClientActionFunction, type MetaFunction, useSubmit } from "react-router";
import { orderBy } from "firebase/firestore";
import { useCallback } from "react";
import useSWRSubscription from "swr/subscription";
import { z } from "zod";
import { useOrderStat } from "~/components/functional/useOrderStat";
import { OrderInfoCard } from "~/components/molecules/OrderInfoCard";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export const meta: MetaFunction = () => {
  return [{ title: "マスター / 珈琲・俺POS" }];
};

export default function FielsOfMaster() {
  const submit = useSubmit();
  const mutateOrder = useCallback(
    (servedOrder: OrderEntity, descComment: string) => {
      const order = servedOrder.clone();
      order.addComment("master", descComment);
      submit(
        { servedOrder: JSON.stringify(order.toOrder()) },
        { method: "PUT" },
      );
    },
    [submit],
  );
  const isOperational = useOrderStat();

  const changeOrderStat = useCallback(
    (status: OrderStatType) => {
      submit({ status }, { method: "POST" });
    },
    [submit],
  );

  const { data: orders } = useSWRSubscription(
    "orders",
    collectionSub({ converter: orderConverter }, orderBy("orderId", "asc")),
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
        <h1 className="text-3xl">マスター</h1>
        <Button
          type="submit"
          className={cn(isOperational ? "bg-red-700" : "bg-sky-700")}
          onClick={() =>
            changeOrderStat(isOperational ? "stop" : "operational")
          }
        >
          {isOperational && "オーダーストップする"}
          {!isOperational && "オーダー再開する"}
        </Button>
        <p>提供待ちオーダー数：{unserved}</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {orders?.map((order) => {
          return (
            order.servedAt === null && (
              <OrderInfoCard
                key={order.id}
                order={order}
                user="master"
                comment={mutateOrder}
              />
            )
          );
        })}
      </div>
    </div>
  );
}

// TODO: ファイル分割してリファクタリングする
export const clientAction: ClientActionFunction = async (args) => {
  const method = args.request.method;
  switch (method) {
    case "PUT":
      return addComment(args);
    case "POST":
      return changeOrderStat(args);
    default:
      throw new Error(`Method ${method} is not allowed`);
  }
};

export const addComment: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();

  const schema = z.object({
    servedOrder: stringToJSONSchema.pipe(orderSchema),
  });
  const submission = parseWithZod(formData, {
    schema,
  });
  if (submission.status !== "success") {
    console.error(submission.error);
    return submission.reply();
  }

  const { servedOrder } = submission.value;
  const order = OrderEntity.fromOrder(servedOrder);

  const savedOrder = await orderRepository.save(order);

  console.log("savedOrder", savedOrder);

  return new Response("ok");
};

export const changeOrderStat: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();

  const schema = z.object({
    status: z.enum(orderStatTypes),
  });
  const submission = parseWithZod(formData, {
    schema,
  });
  if (submission.status !== "success") {
    console.error(submission.error);
    return submission.reply();
  }

  const { status } = submission.value;

  const masterStats: MasterStateEntity =
    (await masterRepository.get()) ?? MasterStateEntity.createNew();

  console.log(status);
  masterStats.addOrderStat(status);
  console.log(masterStats);

  await masterRepository.set(masterStats);

  return new Response("ok");
};
