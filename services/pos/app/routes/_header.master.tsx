import {
  MasterStateEntity,
  OrderEntity,
  type OrderStatType,
  collectionSub,
  id2abbr,
  masterRepository,
  orderConverter,
  orderRepository,
  orderSchema,
  orderStatTypes,
  stringToJSONSchema,
} from "@cafeore/common";
import { parseWithZod } from "@conform-to/zod";
import {
  type ClientActionFunction,
  type MetaFunction,
  useSubmit,
} from "@remix-run/react";
import dayjs from "dayjs";
import { orderBy } from "firebase/firestore";
import { useCallback } from "react";
import { LuHourglass } from "react-icons/lu";
import useSWRSubscription from "swr/subscription";
import { z } from "zod";
import { useOrderStat } from "~/components/functional/useOrderStat";
import { InputComment } from "~/components/molecules/InputComment";
import { RealtimeElapsedTime } from "~/components/molecules/RealtimeElapsedTime";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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
          const isReady = order.readyAt !== null;
          return (
            order.servedAt === null && (
              <div key={order.id}>
                <Card className={cn(isReady && "bg-gray-300 text-gray-500")}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>{`No. ${order.orderId}`}</CardTitle>
                      <CardTitle className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-stone-500">
                        {order.getDrinkCups().length}
                      </CardTitle>
                      <div className="grid">
                        <div className="px-2 text-right">
                          {dayjs(order.createdAt).format("H時m分")}
                        </div>
                        <RealtimeElapsedTime order={order} />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-4 grid grid-cols-2 gap-2">
                      {order.getDrinkCups().map((item, index) => (
                        <div key={`${order.id}-${index}-${item.id}`}>
                          <Card
                            className={cn(
                              "pt-6",
                              item.type === "iceOre" && "bg-sky-200",
                              item.type === "hotOre" && "bg-orange-300",
                              item.type === "ice" && "bg-blue-200",
                              item.type === "milk" && "bg-gray-300",
                              item.name === "限定" && "bg-red-300",
                              isReady && "bg-gray-200 text-gray-500",
                            )}
                          >
                            <CardContent>
                              <h3 className="text-center font-bold">
                                {id2abbr(item.id)}
                              </h3>
                              {item.assignee && (
                                <p className="text-sm">指名:{item.assignee}</p>
                              )}
                            </CardContent>
                          </Card>
                        </div>
                      ))}
                    </div>

                    {order?.comments.length !== 0 && (
                      <div>
                        {order.comments.map((comment, index) => (
                          <div
                            key={`${index}-${comment.author}`}
                            className={cn(
                              isReady && "bg-gray-400",
                              "my-2",
                              "flex",
                              "gap-2",
                              "rounded-md",
                              "bg-gray-200",
                              "px-2",
                              "py-1",
                            )}
                          >
                            <div className="flex-none font-bold">
                              {(comment.author === "cashier" && "レ") ||
                                (comment.author === "master" && "マ") ||
                                (comment.author === "serve" && "提") ||
                                (comment.author === "others" && "他")}
                            </div>
                            <div>{comment.text}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <InputComment order={order} addComment={mutateOrder} />
                    {isReady && (
                      <div className="mt-5 flex items-center">
                        <LuHourglass className="mr-1 h-5 w-5 stroke-yellow-600" />
                        <p className="text-yellow-700">提供待ち</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
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
