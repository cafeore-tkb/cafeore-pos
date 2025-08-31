import {
  ITEM_MASTER,
  type OrderEntity,
  collectionSub,
  itemSource,
  orderConverter,
} from "@cafeore/common";
import type { MetaFunction } from "@remix-run/react";
import dayjs from "dayjs";
import { orderBy } from "firebase/firestore";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  XAxis,
  YAxis,
} from "recharts";
import useSWRSubscription from "swr/subscription";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import type { ChartConfig } from "~/components/ui/chart";
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
  const items = itemSource;
  const [focusedOrderId, setFocusedOrderId] = useState(1);
  const unseved = orders?.reduce((acc, cur) => {
    if (cur.servedAt == null) {
      return acc + 1;
    }
    return acc;
  }, 0);
  const itemNamesArray = items.map((items) => items.name);
  const init = new Map<string, number>();
  const numPerItem = orders?.reduce((acc, cur) => {
    if (itemNamesArray !== undefined) {
      for (let i = 0; i < cur.items.length; i++) {
        for (let j = 0; j < itemNamesArray?.length; j++) {
          if (cur.items[i].name === itemNamesArray[j]) {
            const num = acc.get(cur.items[i].name) ?? 0;
            acc.set(cur.items[i].name, num + 1);
          }
        }
      }
    }
    return acc;
  }, init);
  const itemValue = (name: string): number | undefined => {
    let valueNum = undefined;
    if (numPerItem !== undefined) {
      valueNum = numPerItem.get(name);
    }
    return valueNum;
  };

  const chartData = [
    {
      name: "べっぴん",
      num: itemValue(ITEM_MASTER["-"].name),
      fill: "var(--color-hot)",
    },
    {
      name: "俺ブレ",
      num: itemValue(ITEM_MASTER["^"].name),
      fill: "var(--color-hot)",
    },
    {
      name: "ピンク",
      num: itemValue(ITEM_MASTER[":"].name),
      fill: "var(--color-hot)",
    },
    {
      name: "コスタ",
      num: itemValue(ITEM_MASTER["]"].name),
      fill: "var(--color-hot)",
    },
    {
      name: "マンデ",
      num: itemValue(ITEM_MASTER[";"].name),
      fill: "var(--color-hot)",
    },
    {
      name: "限定",
      num: itemValue(ITEM_MASTER["/"].name),
      fill: "var(--color-hot)",
    },
    {
      name: "氷",
      num: itemValue(ITEM_MASTER["\\"].name),
      fill: "var(--color-ice)",
    },
    {
      name: "Iceオレ",
      num: itemValue(ITEM_MASTER["["].name),
      fill: "var(--color-aulait)",
    },
    {
      name: "Hotオレ",
      num: itemValue(ITEM_MASTER["@"].name),
      fill: "var(--color-aulait)",
    },
    {
      name: "ミルク",
      num: itemValue(ITEM_MASTER["."].name),
      fill: "var(--color-milk)",
    },
  ];
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
          <Card>
            <CardHeader>
              <CardTitle>商品ごとの杯数</CardTitle>
              <CardDescription>{}</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig}>
                <BarChart accessibilityLayer data={chartData}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    tickMargin={10}
                    axisLine={false}
                    tickFormatter={(value) => value.slice(0, 5)}
                  />
                  <YAxis />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent nameKey="name" />}
                  />
                  <Bar
                    dataKey="num"
                    radius={8}
                    activeBar={({ ...props }) => {
                      return (
                        <Rectangle
                          {...props}
                          fillOpacity={0.8}
                          stroke={props.payload.fill}
                          strokeDasharray={4}
                          strokeDashoffset={4}
                        />
                      );
                    }}
                  />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
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

const chartConfig = {
  name: {
    label: "杯数",
  },
  hot: {
    label: "ホット",
    color: "hsl(var(--chart-1))",
  },
  ice: {
    label: "アイス",
    color: "hsl(var(--chart-2))",
  },
  aulait: {
    label: "オレ",
    color: "hsl(var(--chart-3))",
  },
  milk: {
    label: "ミルク",
    color: "hsl(var(--chart-4))",
  },
  other: {
    label: "Other",
    color: "hsl(var(--chart-5))",
  },
} satisfies ChartConfig;
