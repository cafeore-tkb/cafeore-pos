import type { OrderEntity } from "@cafeore/common";
import dayjs from "dayjs";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { cn } from "~/lib/utils";

/**
 * ダッシュボードで注文内容一覧を表示するコンポーネント
 * @returns
 */

interface OrderDetailProps {
  order: OrderEntity;
}

export const OrderDetail: React.FC<OrderDetailProps> = ({ order }) => {
  return (
    <div key={order.id}>
      <Card className="mt-3">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{`No. ${order.orderId}`}</CardTitle>
            <CardTitle>合計金額: {order.total}円</CardTitle>
            <CardTitle className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-stone-500">
              {order.items.length}
            </CardTitle>
            <div className="grid">
              <div className="px-2 text-right">
                受付時刻: {dayjs(order.createdAt).format("H:mm:ss")}
              </div>
              <p className="px-2 text-right">時間: {diffTime(order)}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-1">
            {order.items.map((item, idx) => (
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
          {order?.comments.length === 0 && (
            <div>
              {order.comments.map((comment, index) => (
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
  );
};

const diffTime = (order: OrderEntity) => {
  if (order.servedAt == null) return "未提供";
  return dayjs(dayjs(order.servedAt).diff(dayjs(order.createdAt))).format(
    "m:ss",
  );
};
