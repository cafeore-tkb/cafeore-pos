import type { OrderEntity } from "@cafeore/common";
import dayjs from "dayjs";
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
  orders: OrderEntity[] | undefined;
  onOrderClick: (orderId: number) => void;
}

/**
 * ダッシュボードで注文リストを表示するコンポーネント
 * @returns
 */

export const OrderList: React.FC<OrderStatusListProps> = ({
  orders,
  onOrderClick,
}) => {
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

  return (
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
            className={cn(pass15Minutes(order) && "bg-red-300")}
            key={order.orderId}
            onClick={() => onOrderClick(order.orderId)}
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
  );
};
