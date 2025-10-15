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
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWRSubscription from "swr/subscription";
import { z } from "zod";
import { ReadyBell } from "~/components/atoms/ReadyBell";
import { InputComment } from "~/components/molecules/InputComment";
import { RealtimeElapsedTime } from "~/components/molecules/RealtimeElapsedTime";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
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
      order.undoReady();
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

  const ITEMS_PER_PAGE = 20;
  const [page, setPage] = useState(0);

  const servedOrders = useMemo(
    () =>
      orders
        ? orders
            .filter((order) => order.servedAt !== null)
            .slice()
            .reverse()
        : [],
    [orders],
  );

  const totalPages = Math.ceil(servedOrders.length / ITEMS_PER_PAGE);

  const currentPageOrders = servedOrders?.slice(
    page * ITEMS_PER_PAGE,
    (page + 1) * ITEMS_PER_PAGE,
  );

  return (
    <div className="p-4 font-sans">
      <div className="flex justify-between pb-4">
        <h1 className="text-3xl">提供</h1>
        <p>提供待ちオーダー数：{unserved}</p>
        <Sheet>
          <SheetTrigger asChild>
            <Button
              className="h-10 bg-slate-200 text-slate-700 text-sm hover:bg-slate-100"
              variant="outline"
            >
              過去の注文
            </Button>
          </SheetTrigger>

          <SheetContent className="w-1/2 overflow-y-auto sm:max-w-none">
            <SheetHeader>
              <SheetTitle>提供済みの注文</SheetTitle>
            </SheetHeader>

            <div className="mt-4 grid grid-cols-2 gap-4">
              {currentPageOrders.map((order) => {
                const isReady = order.readyAt !== null;
                return (
                  <Card
                    key={order.id}
                    className={cn(
                      "transition-all duration-200",
                      "hover:scale-[1.02]",
                      isReady && "bg-gray-300 text-gray-500",
                    )}
                  >
                    <CardHeader>
                      <div className="flex items-end justify-between">
                        <CardTitle className="flex items-end font-normal">
                          <div className="font-black text-sm">No.</div>
                          <div className="font-black text-6xl">
                            {order.orderId}
                          </div>
                        </CardTitle>
                        <div
                          className={cn(
                            "rounded-md px-2",
                            pass15Minutes(order)
                              ? "bg-red-500 text-white"
                              : "bg-slate-100",
                          )}
                        >
                          <div>{diffTime(order)}</div>
                        </div>
                        <div className="grid">
                          <div className="px-2 text-right">
                            {dayjs(order.createdAt).format("H:mm")}
                          </div>
                          <a
                            // link for debug
                            className="items-end px-2"
                            href={`${BASE_CLIENT_URL}/welcome?id=${order.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <CardTitle className="flex h-10 items-end">
                              <p className="text-5xl">
                                {order.getDrinkCups().length}
                              </p>
                              <p className="text-sm">杯</p>
                            </CardTitle>
                          </a>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-2">
                      <div className="grid grid-cols-2 gap-1">
                        {order.getDrinkCups().map((item, idx) => (
                          <Card
                            key={`${idx}-${item.id}`}
                            className={cn(
                              "p-1 text-center font-bold text-xl",
                              item.type === "milk" && "bg-yellow-200",
                              item.type === "hotOre" && "bg-orange-300",
                              item.type === "iceOre" && "bg-sky-200",
                              isReady && "bg-gray-200 text-gray-500",
                            )}
                          >
                            {id2abbr(item.id)}
                          </Card>
                        ))}
                      </div>

                      {/* コメント */}
                      {order.comments.length > 0 && (
                        <div className="space-y-1">
                          {order.comments.map((comment, index) => (
                            <div
                              key={`${index}-${comment.author}`}
                              className={cn(
                                "flex gap-1 rounded-md bg-gray-200 px-2 py-1 text-xs",
                                isReady && "bg-gray-400",
                              )}
                            >
                              <div className="font-bold">
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

                      <div className="mt-2 flex items-center justify-between">
                        <Button
                          onClick={() => {
                            undoServe(order);
                          }}
                          className="h-10 bg-gray-700 text-sm hover:bg-gray-600"
                        >
                          提供取消
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* ページネーション */}
            <div className="mt-6 flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(p - 1, 0))}
              >
                ← 前へ
              </Button>
              <span className="text-gray-600 text-sm">
                {page + 1} / {totalPages} ページ
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(p + 1, totalPages - 1))}
              >
                次へ →
              </Button>
            </div>

            <SheetFooter className="mt-6">
              <SheetClose asChild>
                <Button variant="outline">Close</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {orders?.map((order) => {
          const isReady = order.readyAt !== null;
          return (
            order.servedAt === null && (
              <div key={order.id}>
                <Card className={cn(isReady && "bg-gray-300 text-gray-500")}>
                  <CardHeader>
                    <div className="flex items-end justify-between">
                      <CardTitle className="flex items-end font-normal">
                        <div className="font-black text-sm">No.</div>
                        <div className="font-black text-6xl">
                          {order.orderId}
                        </div>
                      </CardTitle>
                      <RealtimeElapsedTime order={order} />
                      <div className="grid">
                        <div className="px-2 text-right">
                          {dayjs(order.createdAt).format("H:mm")}
                        </div>
                        <a
                          // link for debug
                          className="items-end px-2"
                          href={`${BASE_CLIENT_URL}/welcome?id=${order.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <CardTitle className="flex h-10 items-end">
                            <p className="text-5xl">
                              {order.getDrinkCups().length}
                            </p>
                            <p className="text-sm">杯</p>
                          </CardTitle>
                        </a>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-4 grid grid-cols-2 gap-2">
                      {order.getDrinkCups().map((item, idx) => (
                        <div key={`${idx}-${item.id}`}>
                          <Card
                            className={cn(
                              "p-3",
                              item.type === "milk" && "bg-yellow-200",
                              item.type === "hotOre" && "bg-orange-300",
                              item.type === "iceOre" && "bg-sky-200",
                              isReady && "bg-gray-200 text-gray-500",
                            )}
                          >
                            <h3 className="text-center font-bold text-3xl">
                              {id2abbr(item.id)}
                            </h3>
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

const diffTime = (order: OrderEntity) => {
  if (order.servedAt == null) return "未提供";
  return dayjs(dayjs(order.servedAt).diff(dayjs(order.createdAt))).format(
    "m分ss秒",
  );
};

const pass15Minutes = (order: OrderEntity) => {
  if (order.servedAt === null)
    return dayjs(dayjs().diff(dayjs(order.createdAt))).minute() >= 15;
  if (order.servedAt !== null)
    return (
      dayjs(dayjs(order.servedAt).diff(dayjs(order.createdAt))).minute() >= 15
    );
};
