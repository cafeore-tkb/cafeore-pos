("use client");

import type { OrderEntity, WithId } from "@cafeore/common";
import dayjs from "dayjs";
import { CartesianGrid, Line, LineChart, XAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";

type props = {
  orders: WithId<OrderEntity>[] | undefined;
};

/**
 * ダッシュボードで提供時間のグラフを表示するコンポーネント
 * @returns
 * @param props
 */

const ServeTimeGraph = ({ orders }: props) => {
  const chartData =
    orders
      ?.filter((order) => order.servedAt) // 未提供の注文を除外
      .map((order) => {
        const createdAt = dayjs(order.createdAt);
        const servedAt = dayjs(order.servedAt);
        const serveTime = servedAt.diff(createdAt, "minute");

        return {
          createdAt: createdAt.format("HH:mm"), // x軸に使用する時刻
          serveTime,
        };
      }) ?? [];

  const chartConfig = {
    serve: {
      label: "提供時間2025",
      color: "hsl(var(--chart-1))",
    },
  } satisfies ChartConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle>提供時間の推移</CardTitle>
        <CardDescription>
          注文の受付から提供までにかかった時間の推移を表示します
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          <LineChart
            accessibilityLayer
            data={chartData}
            margin={{
              left: 12,
              right: 12,
            }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="createdAt"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => value}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Line
              dataKey="serveTime"
              type="natural"
              stroke="var(--color-serve)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
};

export { ServeTimeGraph };
