import {
  OrderEntity,
  collectionSub,
  id2abbr,
  orderConverter,
  orderRepository,
  orderSchema,
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
import { toast } from "sonner";
import useSWRSubscription from "swr/subscription";
import { z } from "zod";
import { ReadyBell } from "~/components/atoms/ReadyBell";
import { InputComment } from "~/components/molecules/InputComment";
import { RealtimeElapsedTime } from "~/components/molecules/RealtimeElapsedTime";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { cn } from "~/lib/utils";

export const BASE_CLIENT_URL = "https://cafeore-2024.pages.dev";

export const meta: MetaFunction = () => {
  return [{ title: "提供 / 珈琲・俺POS" }];
};

export default function Serve() {
  const submit = useSubmit();
  const addComment = useCallback(
    (servedOrder: OrderEntity, descComment: string) => {
      const order = servedOrder.clone();
      order.addComment("serve", descComment);
      submit(
        { servedOrder: JSON.stringify(order.toOrder()) },
        { method: "PUT" },
      );
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

  const beServed = useCallback(
    (servedOrder: OrderEntity) => {
      const order = servedOrder.clone();
      order.beServed();
      submit(
        { servedOrder: JSON.stringify(order.toOrder()) },
        { method: "PUT" },
      );
    },
    [submit],
  );

  const undoServe = useCallback(
    (servedOrder: OrderEntity) => {
      const order = servedOrder.clone();
      order.undoServed();
      submit(
        { servedOrder: JSON.stringify(order.toOrder()) },
        { method: "PUT" },
      );
    },
    [submit],
  );

  const changeReady = useCallback(
    (servedOrder: OrderEntity, ready: boolean) => {
      const order = servedOrder.clone();
      if (ready) {
        order.beReady();
      } else {
        order.undoReady();
      }
      submit(
        { servedOrder: JSON.stringify(order.toOrder()) },
        { method: "PUT" },
      );
    },
    [submit],
  );

  return (
    <div className="p-4 font-sans">
      <div className="flex justify-between pb-4">
        <h1 className="text-3xl">提供</h1>
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
                      <a
                        // link for debug
                        className="px-2"
                        href={`${BASE_CLIENT_URL}/welcome?id=${order.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <CardTitle className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-stone-500">
                          {order.getDrinkCups().length}
                        </CardTitle>
                      </a>
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
                      {order.getDrinkCups().map((item, idx) => (
                        <div key={`${idx}-${item.id}`}>
                          <Card
                            className={cn(
                              "pt-6",
                              item.type === "milk" && "bg-yellow-200",
                              item.type === "hotOre" && "bg-orange-300",
                              item.type === "iceOre" && "bg-sky-200",
                              isReady && "bg-gray-200 text-gray-500",
                            )}
                          >
                            <CardContent>
                              <h3 className="text-center font-bold">
                                {id2abbr(item.id)}
                              </h3>
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
                    <InputComment order={order} addComment={addComment} />
                    <div className="mt-4 flex items-center justify-between">
                      <ReadyBell
                        order={order}
                        changeReady={(ready) => changeReady(order, ready)}
                      />
                      {/* {isReady && (
                        <div className="flex-1 px-2">
                          <div>呼び出し時刻</div>
                          <div>{dayjs(order.readyAt).format("H時m分")}</div>
                        </div>
                      )} */}
                      <Button
                        onClick={() => {
                          const now = new Date();
                          beServed(order);
                          toast(`提供完了 No.${order.orderId}`, {
                            description: `${dayjs(now).format("H時m分")}`,
                            action: {
                              label: "取消",
                              onClick: () => undoServe(order),
                            },
                          });
                        }}
                        className="h-16 w-16 bg-green-700 text-lg hover:bg-green-600 "
                      >
                        提供
                      </Button>
                    </div>
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

export const clientAction: ClientActionFunction = async ({ request }) => {
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
