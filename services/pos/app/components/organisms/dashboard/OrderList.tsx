import {
  type OrderEntity,
  type WithId,
  formatElapsedTime,
  orderElapsedTime,
} from "@cafeore/common";
import { useState } from "react";
import { OrderInfoCard } from "~/components/molecules/OrderInfoCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/utils";
interface OrderStatusListProps {
  orders: WithId<OrderEntity>[] | undefined;
}

/**
 * ダッシュボードで注文リストを表示するコンポーネント
 * @returns
 */

export function OrderList({ orders }: OrderStatusListProps) {
  const [focusedOrderId, setFocusedOrderId] = useState(1);
  const detailOrder = orders?.find((order) => order.orderId === focusedOrderId);

  console.log(detailOrder);

  const numOfCups = (order: OrderEntity): number => {
    return order.menus.length;
  };

  const diffTime = (order: OrderEntity) => {
    if (order.servedAt == null) return "未提供";
    return formatElapsedTime(orderElapsedTime(order), "m:ss");
  };

  return (
    <>
      <div className="h-162.5 w-1/2 overflow-auto">
        <Table>
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
                className={cn(orderElapsedTime(order).overdue && "bg-red-300")}
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
        </Table>
      </div>
      <div className="w-1/2">
        {detailOrder && (
          <OrderInfoCard
            order={detailOrder}
            user={"dashboard"}
            timing="all"
            comment={() => {}}
          />
        )}
      </div>
    </>
  );
}
