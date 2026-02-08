import { orderRepository, useClientLoaderData } from "@cafeore/common";
import { Form, type MetaFunction } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
export { clientAction } from "./action";

export const meta: MetaFunction = () => {
  return [{ title: "オーダー" }];
};

export const clientLoader = async () => {
  console.log("findAllのテスト");
  const orders = await orderRepository.findAll();
  return { orders };
};

export default function Order() {
  // TODO(toririm): useSWRSubscription を使う。clientLoader は削除
  const { orders } = useClientLoaderData<typeof clientLoader>();

  return (
    <div className="p-4 font-sans">
      <h1 className="text-3xl">アイテム</h1>
      <ul>
        {orders.map((order) => (
          <li key={order.id}>
            <h2>{order.orderId}</h2>
            <p>{order.id}</p>
            <div>
              {order.items.map((item) => (
                <div key={item.id}>
                  <h3>{item.name}</h3>
                  <p>{item.price}</p>
                  <p>{item.item_type.display_name}</p>
                </div>
              ))}
            </div>
            <p>{order.createdAt.toISOString()}</p>
            <p>{`提供時間：${order.servedAt?.toISOString()}`}</p>
            <p>{order.total}</p>
          </li>
        ))}
      </ul>
      <Form method="post">
        <Input type="number" name="orderId" required placeholder="注文番号" />
        <Button type="submit">登録</Button>
      </Form>
      <Form method="delete">
        <Input type="text" name="id" required placeholder="id" />
        <Button type="submit">削除</Button>
      </Form>
      <Form method="put">
        <Input type="text" name="id" required placeholder="id" />
        <Button type="submit">更新</Button>
      </Form>
    </div>
  );
}
