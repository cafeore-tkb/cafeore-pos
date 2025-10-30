import type { OrderEntity, WithId } from "@cafeore/common";
import { useMemo, useState } from "react";
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
import { OrderInfoCard } from "./OrderInfoCard";

type props = {
  orders: WithId<OrderEntity>[] | undefined;
  cardUser: "cashier" | "master" | "serve";
  cardTiming: "present" | "past" | "all";
  comment: (servedOrder: OrderEntity, descComment: string) => void;
};

export function PastOrderSideSheet({
  orders,
  cardUser,
  cardTiming,
  comment,
}: props) {
  const ITEMS_PER_PAGE = 20;
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil((orders ? orders.length : 0) / ITEMS_PER_PAGE);

  const servedOrders = useMemo(
    () =>
      orders
        ? orders
            .filter((order) => order.servedAt !== null)
            .slice()
            .sort((a, b) => b.orderId - a.orderId)
        : [],
    [orders],
  );

  const currentPageOrders =
    cardTiming === "past"
      ? servedOrders?.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE)
      : orders?.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

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
          {currentPageOrders?.map((order) => {
            return (
              <OrderInfoCard
                key={order.id}
                order={order}
                timing={cardTiming}
                user={cardUser}
                comment={comment}
              />
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
  );
}
