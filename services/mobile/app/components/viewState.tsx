import type { OrderEntity, WithId } from "@cafeore/common";
import { Card, CardContent, CardHeader } from "./ui/card";

export function ViewState({ order }: { order: WithId<OrderEntity> }) {
  return (
    <div className="w-full">
      <Card>
        <CardHeader>
          <h1 className="g text-2xl">No. {order.orderId}</h1>
        </CardHeader>
        <CardContent>
          {order.servedAt && (
            <div>
              <h2 className="mt-5 mb-5 text-center font-bold text-amber-900 text-xl">
                提供済みです
              </h2>
            </div>
          )}
          {order.readyAt && order.servedAt === null && (
            <div>
              <h2 className="mt-5 mb-5 text-center font-bold text-amber-900 text-xl">
                ドリップが完了しました！
              </h2>
            </div>
          )}
          {order.readyAt === null && (
            <div>
              <h2 className="mt-5 mb-5 text-center font-bold text-amber-900 text-xl">
                準備中です
              </h2>
            </div>
          )}
          <h2>ご注文内容</h2>
          <ul>
            {order.items.map((item, idx) => (
              <div key={`${idx}-${item.id}`}>
                <li className="font-bold">{item.name}</li>
              </div>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
