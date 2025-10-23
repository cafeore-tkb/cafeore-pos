("use client");

import type { OrderEntity, WithId } from "@cafeore/common";
import dayjs from "dayjs";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
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
} from "~/components/ui/chart";

type props = {
  orders: WithId<OrderEntity>[] | undefined;
};

/**
 * ダッシュボードで提供時間のグラフを表示するコンポーネント
 * @returns
 * @param props
 */

// カスタムツールチップコンポーネント
import type { TooltipProps } from "recharts";

const CustomTooltipContent = ({
  active,
  payload,
  label,
}: TooltipProps<number, string>) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="rounded-lg border bg-background p-2 shadow-md">
        <div className="grid gap-2">
          <div className="flex flex-col">
            <span className="text-[0.70rem] text-muted-foreground uppercase">
              時刻
            </span>
            <span className="font-bold">{label}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[0.70rem] text-muted-foreground uppercase">
              提供時間
            </span>
            <span className="font-bold">{data.serveTimeText}</span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

const ServeTimeGraph = ({ orders }: props) => {
  const chartData =
    orders
      ?.filter((order) => order.servedAt) // 未提供の注文を除外
      .map((order) => {
        const createdAt = dayjs(order.createdAt);
        const servedAt = dayjs(order.servedAt);
        const totalSeconds = servedAt.diff(createdAt, "second");
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const serveTimeMinutes = minutes + seconds / 60; // グラフ用の分単位の値

        return {
          createdAt: createdAt.format("HH:mm"), // x軸に使用する時刻
          serveTime: serveTimeMinutes,
          serveTimeText: `${minutes}分${seconds}秒`, // ツールチップ用のテキスト
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
            <YAxis tickLine={false} axisLine={false} tickMargin={8} />
            <ChartTooltip cursor={false} content={<CustomTooltipContent />} />
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
