import {
  OrderEntity,
  collectionSub,
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
import { orderBy } from "firebase/firestore";
import { useCallback, useMemo, useState } from "react";
import useSWRSubscription from "swr/subscription";
import { z } from "zod";
import { OrderInfoCard } from "~/components/molecules/OrderInfoCard";
import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";

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
                return (
                  <OrderInfoCard
                    key={order.id}
                    order={order}
                    timing={"past"}
                    user={"serve"}
                    comment={addComment}
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
      </div>

      <div className="grid grid-cols-4 gap-4">
        {orders?.map((order) => {
          return (
            order.servedAt === null && (
              <OrderInfoCard
                key={order.id}
                order={order}
                timing={"present"}
                user={"serve"}
                comment={addComment}
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
