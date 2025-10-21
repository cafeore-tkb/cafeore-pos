import { type OrderEntity, type WithId, id2abbr } from "@cafeore/common";
import { useSubmit } from "@remix-run/react";
import dayjs from "dayjs";
import { useCallback } from "react";
import { toast } from "sonner";
import { cn } from "~/lib/utils";
import { BASE_CLIENT_URL } from "~/routes/_header.serve";
import { ReadyBell } from "../atoms/ReadyBell";
import { ServeCheck } from "../atoms/ServeCheck";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { InputComment } from "./InputComment";
import { RealtimeElapsedTime } from "./RealtimeElapsedTime";

type props = {
  order: WithId<OrderEntity>;
  user: "master" | "serve-unserved" | "serve-served";
  comment: (servedOrder: OrderEntity, descComment: string) => void;
};

export function OrderInfoCard({ order, user, comment }: props) {
  const submit = useSubmit();
  const isReady = order.readyAt !== null;
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

  return (
    order.servedAt === null && (
      <div key={order.id}>
        <Card className={cn(isReady && "bg-gray-300 text-gray-500")}>
          <CardHeader>
            <div className="flex items-end justify-between">
              <CardTitle className="flex items-end font-normal">
                <div className="font-black text-sm">No.</div>
                <div className="font-black text-6xl">{order.orderId}</div>
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
                    <p className="text-5xl">{order.getDrinkCups().length}</p>
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
            <InputComment order={order} addComment={comment} />
            <div className="mt-4 flex items-center justify-between">
              <ReadyBell
                order={order}
                changeReady={(ready) => changeReady(order, ready)}
              />
              <ServeCheck
                order={order}
                onServe={(order) => {
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
              />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  );
}
