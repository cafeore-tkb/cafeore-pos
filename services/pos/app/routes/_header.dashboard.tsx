import {
  type OrderEntity,
  collectionSub,
  orderConverter,
} from "@cafeore/common";
import type { MetaFunction } from "react-router";
import dayjs from "dayjs";
import { orderBy } from "firebase/firestore";
import { useState } from "react";
import useSWRSubscription from "swr/subscription";
import { ItemBarChart } from "~/components/organisms/ItemBarChart";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/utils";

export const meta: MetaFunction = () => {
  return [{ title: "注文状況 / 珈琲・俺POS" }];
};

export default function Dashboard() {
  const { data: orders } = useSWRSubscription(
    "orders",
    collectionSub({ converter: orderConverter }, orderBy("orderId", "desc")),
  );
  const [focusedOrderId, setFocusedOrderId] = useState(1);
  const unseved = orders?.reduce((acc, cur) => {
    if (cur.servedAt == null) {
      return acc + 1;
    }
    return acc;
  }, 0);

  const detailOrder = orders?.find((order) => order.orderId === focusedOrderId);
  return (
    <div className="flex justify-start p-4 pb-2 font-sans">
      <div className="h-[700px] w-1/2 overflow-auto">
        <div className="sticky top-0 flex justify-between pb-4">
          <h1 className="text-3xl">注文状況</h1>
          <p>提供待ちオーダー数：{unseved}</p>
        </div>
        <div>
          <Table>
            <TableCaption />
            <TableHeader
              className={cn("sticky top-0 z-10 bg-background [&_tr]:border-b")}
            >
              <TableRow>
                <TableHead>No.</TableHead>
                <TableHead>杯数</TableHead>
                <TableHead>合計額</TableHead>
                <TableHead>受付時刻</TableHead>
                <TableHead>提供時刻</TableHead>
                <TableHead>時間</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders?.map((order) => (
                <TableRow
                  className={cn(pass15Minutes(order) === true && "bg-red-300")}
                  key={order.orderId}
                  onClick={() => setFocusedOrderId(order.orderId)}
                >
                  <TableCell className="font-medium">{order.orderId}</TableCell>
                  <TableCell>{numOfCups(order)}</TableCell>
                  <TableCell>￥{order.total}</TableCell>
                  <TableCell>{order.createdAt.toLocaleTimeString()}</TableCell>
                  <TableCell>
                    {order.servedAt == null
                      ? "未提供"
                      : order.servedAt?.toLocaleTimeString()}
                  </TableCell>
                  <TableCell>{diffTime(order)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter />
          </Table>
        </div>
      </div>
      <div className="w-1/2">
        <div className="sticky top-0">
          <ItemBarChart orders={orders} />
          {detailOrder && (
            <div key={detailOrder.id}>
              <Card className="mt-3">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>{`No. ${detailOrder.orderId}`}</CardTitle>
                    <CardTitle>合計金額: {detailOrder.total}円</CardTitle>
                    <CardTitle className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-stone-500">
                      {detailOrder.items.length}
                    </CardTitle>
                    <div className="grid">
                      <div className="px-2 text-right">
                        受付時刻:{" "}
                        {dayjs(detailOrder.createdAt).format("H:mm:ss")}
                      </div>
                      <p className="px-2 text-right">
                        時間: {diffTime(detailOrder)}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-1">
                    {detailOrder.items.map((item, idx) => (
                      <div key={`${idx}-${item.id}`}>
                        <Card
                          className={cn(
                            "flex h-10 flex-col items-center justify-center",
                          )}
                        >
                          <h3 className="font-bold">{item.name}</h3>
                        </Card>
                      </div>
                    ))}
                  </div>
                  {detailOrder?.comments.length === 0 && (
                    <div>
                      {detailOrder.comments.map((comment, index) => (
                        <div
                          key={`${comment.author}-${comment.text}`}
                          className="my-2 flex rounded-md bg-gray-200 p-1"
                        >
                          <div className="flex-none">{comment.author}：</div>
                          <div>{comment.text}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const numOfCups = (order: OrderEntity): number => {
  return order.items.length;
};

const diffTime = (order: OrderEntity) => {
  if (order.servedAt == null) return "未提供";
  return dayjs(dayjs(order.servedAt).diff(dayjs(order.createdAt))).format(
    "m:ss",
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
