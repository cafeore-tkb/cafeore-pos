import {
  type ItemEntity,
  type OrderEntity,
  type WithId,
  id2abbr,
} from "@cafeore/common";
import { useSubmit } from "@remix-run/react";
import dayjs from "dayjs";
import { useCallback } from "react";
import { LuHourglass } from "react-icons/lu";
import { toast } from "sonner";
import { cn } from "~/lib/utils";
import { ReadyBell } from "../atoms/ReadyBell";
import { ServeCheck } from "../atoms/ServeCheck";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { EmergencyButton } from "./EmergencyButton";
import { InputComment } from "./InputComment";
import { RealtimeElapsedTime } from "./RealtimeElapsedTime";

type props = {
  order: WithId<OrderEntity>;
  user: "cashier" | "master" | "serve" | "dashboard";
  timing: "past" | "present" | "all"; // どの注文を表示するか
  comment: (servedOrder: OrderEntity, descComment: string) => void;
};

export function OrderInfoCard({ order, user, timing, comment }: props) {
  const submit = useSubmit();

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

  const handleEmergency = useCallback(
    (item: WithId<ItemEntity>, orderId: number) => {
      const orderClone = order.clone();
      // 該当アイテムに緊急フラグを立てる
      const itemIndex = orderClone.items.findIndex((i) => i.id === item.id);
      if (itemIndex !== -1) {
        orderClone.items[itemIndex].emergency = true;
      }
      // 緊急対応のコメントを追加
      orderClone.addComment("master", `緊急対応: ${id2abbr(item.id)}`);
      submit(
        { servedOrder: JSON.stringify(orderClone.toOrder()) },
        { method: "PUT" },
      );
      toast.success(`${id2abbr(item.id)}を緊急対応にしました`);
    },
    [order, submit],
  );
  
  const displayOrders =
    user === "cashier" || user === "dashboard"
      ? order.items
      : order.getDrinkCups();

  return (
    <div key={order.id}>
      <Card
        className={cn(
          (user === "master" || user === "serve") &&
            order.status === "calling" &&
            "bg-gray-300 text-gray-500",
          order.status === "served" && "transition-all duration-200",
        )}
      >
        <CardHeader>
          <div className="flex items-end justify-between">
            <CardTitle className="flex items-end font-normal">
              <div className="font-black text-sm">No.</div>
              <div className="font-black text-6xl">{order.orderId}</div>
            </CardTitle>
            {timing === "present" && <RealtimeElapsedTime order={order} />}
            {(timing === "past" || timing === "all") && (
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
            )}
            <div className="grid">
              <div className="px-2 text-right">
                {dayjs(order.createdAt).format("H:mm")}
              </div>
              <CardTitle className="flex h-10 items-end justify-center">
                <p className="text-5xl">{order.getDrinkCups().length}</p>
                <p className="text-sm">杯</p>
              </CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              timing === "past" && "mb-4",
              "grid grid-cols-2 gap-2",
            )}
          >
            {displayOrders.map((item, idx) => (
              <div key={`${idx}-${item.id}`}>
                <Card
                  className={cn(
                    "p-3",
                    user === "master" &&
                      ((item.type === "ice" && "bg-blue-200") ||
                        ((item.name === "ブルマン" || item.name === "ライチ") &&
                          "bg-green-300")),
                    user === "serve"
                      ? item.type === "milk" && "bg-yellow-200"
                      : item.type === "milk" && "bg-gray-300",
                    // (user === "master" ||
                    //   user === "serve") &&
                    //   item.type === "hotOre" &&
                    //   "bg-orange-300",
                    (user === "master" || user === "serve") &&
                      ((order.status === "calling" &&
                        "bg-gray-200 text-gray-500") ||
                        (item.type === "iceOre" && "bg-sky-200")),
                    user === "cashier" &&
                      item.type === "others" &&
                      "bg-green-300",
                  )}
                >
                  <h3 className="text-center font-bold text-3xl">
                    {id2abbr(item.id)}
                  </h3>
                  <div>
                    {(user === "master" || user === "dashboard") &&
                      item.assignee && (
                        <p className="text-sm">指名:{item.assignee}</p>
                      )}
                    {user === "master" && item.assignee && (
                      <p className="text-sm">指名:{item.assignee}</p>
                    )}
                    <EmergencyButton
                      orderId={order.orderId}
                      item={item}
                      onEmergencyClick={handleEmergency}
                    />
                  </div>
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
                    order.status === "calling" && "bg-gray-400",
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
          {user !== "dashboard" && (
            <InputComment order={order} addComment={comment} />
          )}
          {(user === "cashier" || user === "master" || user === "dashboard") &&
            order.status === "calling" &&
            !order.servedAt && (
              <div className="mt-5 flex items-center">
                <LuHourglass className="mr-1 h-5 w-5 stroke-yellow-600" />
                <p className="text-yellow-700">提供待ち</p>
              </div>
            )}
          {user === "serve" && timing === "present" && (
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
          )}
          {user === "serve" && timing === "past" && (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}

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
