import {
  type OrderEntity,
  type WithId,
  orderRepository,
  squareRepository,
} from "@cafeore/common";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { usePendingStatus } from "~/lib/usePendingStatus";
import { Button } from "../ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import { InputComment } from "./InputComment";
import { OrderInfoCard, WaitingLabel } from "./OrderInfoCard";
import { SquareRefundButton } from "./SquareRefundButton";

type CardOptions = {
  author: "cashier" | "master" | "serve"; // コメントの書き手
  withGoods?: boolean; // カップを作らない商品（グッズなど）も出す
  gray?: boolean; // カップを灰色にする。灰色でなければ過去の注文のカードの色の設定（cashier_order）で色を付ける
  cancellable?: boolean; // 提供取消のボタンを出す
  squareRefundable?: boolean; // Square で払った注文に返金のボタン（注文を消す・残す）と返金の状態を出す
  onPrintFormalReceipt?: (order: OrderEntity) => Promise<boolean>; // 渡せば領収書のボタンを出す。プリンターに送れたら true
};

type props = CardOptions & {
  orders: WithId<OrderEntity>[] | undefined; // 出す注文。新しい順に並べる
};

const ITEMS_PER_PAGE = 20;

export function PastOrderSideSheet({ orders, ...options }: props) {
  const [page, setPage] = useState(0);
  const sortedOrders = useMemo(
    () => (orders ?? []).slice().sort((a, b) => b.orderId - a.orderId),
    [orders],
  );
  const totalPages = Math.ceil(sortedOrders.length / ITEMS_PER_PAGE);
  const currentPageOrders = sortedOrders.slice(
    page * ITEMS_PER_PAGE,
    (page + 1) * ITEMS_PER_PAGE,
  );

  return (
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
          <SheetTitle>過去の注文</SheetTitle>
        </SheetHeader>

        <div className="mt-4 grid grid-cols-2 gap-4">
          {currentPageOrders.map((order) => (
            <PastOrderCard key={order.id} order={order} {...options} />
          ))}
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
  );
}

// 過去の注文のカード。押して状態を変えるカップは無い
const PastOrderCard = ({
  order,
  author,
  withGoods,
  gray,
  cancellable,
  squareRefundable,
  onPrintFormalReceipt,
}: CardOptions & { order: WithId<OrderEntity> }) => {
  // 提供取消も、応答待ちの間は押せなくし、失敗したらトーストを出す
  const pending = usePendingStatus<boolean>(order);
  const cancelServed = () => {
    if (pending.isBusy("served")) return;
    pending.run("served", false, () =>
      orderRepository.serve(order.id).then(() => undefined),
    );
  };
  const printFormalReceipt = async () => {
    if (!onPrintFormalReceipt) return;
    if (await onPrintFormalReceipt(order)) {
      toast(`No.${order.orderId} の領収書を印刷しました`);
    } else {
      toast.error(
        "レシート用のプリンターにつながっていないため、領収書を印刷できません",
      );
    }
  };
  return (
    <OrderInfoCard
      order={order}
      timing="past"
      cups={(withGoods ? order.getItems() : order.getCups()).map((cup) => ({
        ...cup,
        gray,
      }))}
      colorScreen={gray ? undefined : "cashier_order"}
    >
      <InputComment
        order={order}
        addComment={(order, text) =>
          orderRepository.addComment(order.id, author, text)
        }
      />
      <WaitingLabel order={order} />
      {cancellable && (
        <div className="mt-2 flex items-center justify-between">
          <Button
            onClick={cancelServed}
            disabled={pending.isBusy("served")}
            className="h-10 bg-gray-700 text-sm hover:bg-gray-600"
          >
            提供取消
          </Button>
        </div>
      )}
      {onPrintFormalReceipt && (
        <div className="mt-2 flex justify-end">
          <Button
            variant="outline"
            onClick={printFormalReceipt}
            className="h-10 text-sm"
          >
            領収書
          </Button>
        </div>
      )}
      {squareRefundable && order.paymentMethod === "square" && (
        <SquareRefundActions order={order} />
      )}
    </OrderInfoCard>
  );
};

// Square で払った注文の返金。注文を消す返金と、返金だけして注文を残す返金を選べる。
// 返金を受け付けたら（結果待ち・返金済み）ボタンは出さず、状態だけを出す。
const SquareRefundActions = ({ order }: { order: WithId<OrderEntity> }) => {
  const status = order.squareRefundStatus;
  const label = `No.${order.orderId}（¥${order.billingAmount}）`;
  return (
    <div className="mt-2 flex flex-col items-end gap-1">
      {status === "pending" && (
        <p className="text-stone-600 text-xs">
          返金を受け付けました（Square で処理されると返金済みになります）
        </p>
      )}
      {status === "refunded" && (
        <p className="font-bold text-sm text-stone-600">返金済み</p>
      )}
      {status === "failed" && (
        <p className="text-red-700 text-xs">
          返金できませんでした。もう一度返金してください
        </p>
      )}
      {status === "unknown" && (
        <p className="text-red-700 text-xs">
          返金できたか確かめられていません。もう一度返金を押すと確かめます（二重には返金されません）
        </p>
      )}
      {status !== "pending" && status !== "refunded" && (
        <div className="flex flex-wrap justify-end gap-2">
          <SquareRefundButton
            label={label}
            orderOnRefund="keep"
            refund={() => squareRepository.refundOrderKeepingOrder(order.id)}
          >
            返金（キャンセルしない）
          </SquareRefundButton>
          <SquareRefundButton
            label={label}
            orderOnRefund="delete"
            refund={() => squareRepository.refundOrder(order.id)}
          />
        </div>
      )}
    </div>
  );
};
