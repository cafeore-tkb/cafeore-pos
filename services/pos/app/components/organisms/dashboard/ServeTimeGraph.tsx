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
              注文番号
            </span>
            <span className="font-bold">#{data.orderId}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[0.70rem] text-muted-foreground uppercase">
              注文時刻
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
          createdAt: createdAt.format("HH:mm"), // x軸に使用する注文時刻
          serveTime: serveTimeMinutes,
          serveTimeText: `${minutes}分${seconds}秒`, // ツールチップ用のテキスト
          orderId: order.orderId, // 注文番号を追加
        };
      })
      .reverse() ?? // 配列を逆順にする（最新の注文が左側に来るように）
    [];

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
            <CartesianGrid
              vertical={false}
              horizontal={true}
              stroke="hsl(var(--muted-foreground))"
              strokeOpacity={0.5}
            />
            <XAxis
              dataKey="createdAt"
              tickMargin={8}
              tickFormatter={(value) => value}
            />
            <YAxis
              tickMargin={8}
              ticks={[0, 10, 20, 30]}
              domain={[0, 30]}
              tickFormatter={(value) => `${value}分`}
            />
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
