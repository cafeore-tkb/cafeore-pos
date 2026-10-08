import {
  type CupStatus,
  type OrderEntity,
  type WithId,
  masterDefaultColor,
  orderRepository,
  resolveItemColor,
  useColorSettings,
} from "@cafeore/common";
import dayjs from "dayjs";
import { LuCheck, LuHourglass } from "react-icons/lu";
import { toast } from "sonner";
import { usePendingStatus } from "~/lib/usePendingStatus";
import { cn } from "~/lib/utils";
import { PendingSpinner } from "../atoms/PendingSpinner";
import { ReadyBell } from "../atoms/ReadyBell";
import { ServeCheck } from "../atoms/ServeCheck";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { EmergencyCupButton } from "./EmergencyCupButton";
import { InputComment } from "./InputComment";
import { RealtimeElapsedTime } from "./RealtimeElapsedTime";

type props = {
  order: WithId<OrderEntity>;
  user: "cashier" | "master" | "serve" | "dashboard";
  timing: "past" | "present" | "all"; // どの注文を表示するか
  comment: (servedOrder: OrderEntity, descComment: string) => void;
};

// マスター・提供画面ではカード1枚がカップ1杯（cupId）にあたる
type CupItem = ReturnType<OrderEntity["getItems"]>[number] & {
  cupId?: string;
  status?: CupStatus;
};

export function OrderInfoCard({ order, user, timing, comment }: props) {
  // 押してから配信が届くまでの間も、押した後の状態を表示する
  const cupPending = usePendingStatus<CupStatus>(order);
  const orderPending = usePendingStatus<boolean>(order);

  const isReady = orderPending.statusOf("ready", order.readyAt !== null);
  const changeReady = () => {
    if (orderPending.isBusy("ready")) return;
    orderPending.run("ready", !isReady, async () => {
      await orderRepository.ready(order.id);
      return undefined;
    });
  };

  const changeServed = () =>
    orderPending.run("served", order.servedAt === null, async () => {
      await orderRepository.serve(order.id);
      return undefined;
    });

  const displayOrders: CupItem[] =
    user === "cashier" || user === "dashboard"
      ? order.getItems()
      : order.getCups();

  // 提供画面ではカップを押すと 準備中 → 提供可能 → 提供済み → 準備中 と回り、マスター画面では準備完了を切り替える
  const cupAction =
    timing === "present" && (user === "serve" || user === "master")
      ? user
      : null;

  const cupStatus = (item: CupItem) =>
    item.cupId && item.status
      ? cupPending.statusOf(item.cupId, item.status)
      : item.status;

  const readyCup = (cupId: string, next: CupStatus) =>
    cupPending.run(cupId, next, async () =>
      cupStatusOf(await orderRepository.readyCup(order.id, cupId), cupId),
    );

  const serveCup = (cupId: string, next: CupStatus) =>
    cupPending.run(cupId, next, async () =>
      cupStatusOf(await orderRepository.serveCup(order.id, cupId), cupId),
    );

  const changeCup = (item: CupItem) => {
    const { cupId } = item;
    // 応答待ちの間は押せなくして、ダブルタップで2回進むのを防ぐ
    if (!cupId || cupPending.isBusy(cupId)) return;
    const status = cupStatus(item);
    if (cupAction === "master") {
      readyCup(cupId, status === "preparing" ? "ready" : "preparing");
      return;
    }
    // 提供画面では 準備中 → 提供可能 → 提供済み → 準備中 と回す
    if (status === "preparing") {
      readyCup(cupId, "ready");
      return;
    }
    const description = dayjs().format("H時m分");
    if (status === "ready") {
      serveCup(cupId, "served");
      toast(`提供完了 No.${order.orderId} ${item.abbr}`, {
        description,
        action: { label: "取消", onClick: () => serveCup(cupId, "ready") },
      });
      return;
    }
    // 提供済みのカップの準備完了を外すと、提供済みも外れて準備中に戻る。
    // 誤タップで提供を取り消しても気づけるよう、トーストを出す
    readyCup(cupId, "preparing");
    toast(`提供取消 No.${order.orderId} ${item.abbr}`, {
      description,
      action: { label: "元に戻す", onClick: () => serveCup(cupId, "served") },
    });
  };

  // 注文カードの背景色設定はマスター・提供画面だけで使う（レジの設定はメニューのボタン用）
  const colorScreen = user === "master" || user === "serve" ? user : null;
  const { colorSettings } = useColorSettings(colorScreen !== null);

  // 設定があれば下の className の既定色より優先する。
  // マスター画面では、設定が無ければマスターの既定の色（CaOS のカードと共通。@cafeore/common）。
  // マスター画面では準備完了・呼び出し中、提供画面では提供済みのカップをグレーのままにする。
  const itemBackgroundColor = (item: (typeof displayOrders)[number]) => {
    if (colorScreen === null) return undefined;
    const status = cupStatus(item);
    if (
      colorScreen === "master"
        ? order.status === "calling" || status !== "preparing"
        : status === "served"
    )
      return undefined;
    const color = resolveItemColor(colorSettings, item, colorScreen);
    return colorScreen === "master"
      ? (color ?? masterDefaultColor(item))
      : color;
  };

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
                <p className="text-5xl">{order.getCups().length}</p>
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
            {displayOrders.map((item, idx) => {
              const status = cupStatus(item);
              // 提供画面で、提供可能になったカップを目立たせる
              const servable = user === "serve" && status === "ready";
              const served =
                status === "served" &&
                (isPartlyServed(order, item) ||
                  (user === "serve" && timing === "present"));
              const cupCard = (
                <CupButton
                  key={item.cupId ?? `${idx}-${item.id}`}
                  busy={
                    item.cupId !== undefined && cupPending.isBusy(item.cupId)
                  }
                  onClick={
                    // マスター画面で提供済みのカップを押すと準備中まで戻ってしまうので押せなくする
                    cupAction &&
                    item.cupId &&
                    !(cupAction === "master" && status === "served")
                      ? () => changeCup(item)
                      : undefined
                  }
                >
                  <Card
                    className={cn(
                      "h-full p-3 transition-all duration-200",
                      // マスター画面の既定の色は itemBackgroundColor で付ける
                      user === "serve"
                        ? item.item_type.name === "milk" && "bg-yellow-200"
                        : user !== "master" &&
                            item.item_type.name === "milk" &&
                            "bg-gray-300",
                      // (user === "master" ||
                      //   user === "serve") &&
                      //   item.item_type.name === "hotOre" &&
                      //   "bg-orange-300",
                      user === "master" &&
                        (order.status === "calling" ||
                          status !== "preparing") &&
                        "bg-gray-200 text-gray-500",
                      user === "serve" &&
                        ((status === "served" && "bg-gray-200 text-gray-500") ||
                          (item.item_type.name === "iceOre" && "bg-sky-200")),
                      servable &&
                        "shadow-md ring-4 ring-green-500 ring-offset-2",
                      served && "opacity-50",
                      user === "cashier" &&
                        item.item_type.name === "others" &&
                        "bg-green-300",
                    )}
                    style={{ backgroundColor: itemBackgroundColor(item) }}
                  >
                    <h3 className="text-center font-bold text-3xl">
                      {item.abbr}
                    </h3>
                    {servable && (
                      <p
                        key="servable"
                        className="fade-in zoom-in-50 flex animate-in items-center justify-center gap-0.5 whitespace-nowrap font-bold text-green-700 text-xs duration-200"
                      >
                        <LuCheck
                          className="h-3.5 w-3.5 shrink-0"
                          strokeWidth={3}
                        />
                        提供可能
                      </p>
                    )}
                    {served && (
                      <p
                        key="served"
                        className="fade-in animate-in text-center font-bold text-xs duration-200"
                      >
                        提供済
                      </p>
                    )}
                    {item.assignee && (
                      <p
                        className={cn(
                          order.status === "preparing" && "text-red-500",
                          "font-bold text-sm",
                        )}
                      >
                        指名:{item.assignee}
                      </p>
                    )}
                  </Card>
                </CupButton>
              );
              // マスター画面では、カップの下に緊急ボタン（入れ直し）を出す
              return user === "master" && item.cupId ? (
                <div key={item.cupId} className="flex flex-col gap-1">
                  {cupCard}
                  <EmergencyCupButton order={order} cupId={item.cupId} />
                </div>
              ) : (
                cupCard
              );
            })}
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
                  const now = new Date();
                  changeServed();
                  toast(`提供完了 No.${order.orderId}`, {
                    description: `${dayjs(now).format("H時m分")}`,
                    action: {
                      label: "取消",
                      onClick: () => changeServed(),
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
                  changeServed();
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

// 押して状態を切り替えられるカップだけボタンにする。
// 押せることが分かるよう、ホバーで浮かせて押した瞬間に沈ませる。
// 応答待ちの間は角に回転アイコンを出す。
const CupButton = ({
  onClick,
  busy,
  children,
}: {
  onClick: (() => void) | undefined;
  busy: boolean;
  children: React.ReactNode;
}) =>
  onClick ? (
    <div className="relative h-full">
      <button
        type="button"
        onClick={onClick}
        aria-busy={busy}
        className={cn(
          "block h-full w-full cursor-pointer select-none rounded-lg text-left transition-transform duration-150 ease-out",
          "hover:-translate-y-0.5 active:translate-y-0 active:scale-95 hover:[&>*]:shadow-lg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary focus-visible:ring-offset-2",
          busy && "cursor-wait",
        )}
      >
        {children}
      </button>
      {busy && <PendingSpinner />}
    </div>
  ) : (
    <div>{children}</div>
  );

const cupStatusOf = (order: OrderEntity, cupId: string) =>
  order.getCups().find((cup) => cup.cupId === cupId)?.status;

// 一部だけ提供済みの注文で、提供済みのカップを見分けられるようにする
const isPartlyServed = (order: OrderEntity, item: CupItem) =>
  order.status !== "served" && item.status === "served";

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
