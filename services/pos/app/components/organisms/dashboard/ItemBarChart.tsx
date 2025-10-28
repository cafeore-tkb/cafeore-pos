import { ITEM_MASTER, type OrderEntity, itemSource } from "@cafeore/common";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";

type props = {
  orders: OrderEntity[] | undefined;
  pastOrders: OrderEntity[] | undefined;
};

/**
 * ダッシュボードでアイテムごとの杯数を表示するコンポーネント
 * @param props
 * @returns
 */
const ItemBarChart = ({ orders, pastOrders }: props) => {
  console.log(pastOrders);
  const items = itemSource;
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

  // リアルタイムと過去の最初の時刻を取得
  const realtimeStart = new Date(orders?.at(-1)?.createdAt ?? Date.now());
  const pastStart = new Date(pastOrders?.at(0)?.createdAt ?? Date.now());

  // リアルタイムの経過時間を算出
  const elapsedMs = Date.now() - realtimeStart.getTime();

  // 過去データを「同じ経過時間分」だけ切り出し
  const pastCutoff = new Date(pastStart.getTime() + elapsedMs);
  const pastRange = pastOrders?.filter(
    (o) => new Date(o.createdAt) <= pastCutoff,
  );

  const TYPE_COLOR_MAP = {
    hot: "var(--color-hot)",
    ice: "var(--color-ice)",
    iceOre: "var(--color-aulait)",
    milk: "var(--color-milk)",
    others: "var(--color-others)",
  } as const;

  const sumByItem = (orders: OrderEntity[] | undefined) => {
    if (orders === undefined) return;
    const result: Record<string, number> = {};
    for (const o of orders) {
      for (const item of o.items) {
        result[item.name] = (result[item.name] ?? 0) + 1;
      }
    }
    return result;
  };

  const realtimeSum = sumByItem(orders);
  const pastSum = sumByItem(pastRange);

  const chartData = Object.entries(ITEM_MASTER).map(([, item]) => ({
    name: item.abbr,
    realtimeData: realtimeSum ? realtimeSum[item.name] : 0,
    pastData: pastSum ? pastSum[item.name] : 0,
    fill: TYPE_COLOR_MAP[item.type] ?? "var(--color-hot)",
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>商品ごとの杯数</CardTitle>
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
            <Bar dataKey="realtimeData" radius={8} />
            <Bar dataKey="pastData" radius={8} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
};

const chartConfig = {
  realtimeData: {
    label: "現在のデータ",
    color: "var(--chart-1)",
  },
  pastData: {
    label: "過去のデータ",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

export { ItemBarChart };
