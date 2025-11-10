import type { OrderEntity } from "@cafeore/common";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { TooltipProps } from "recharts";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

type props = {
  realtimeOrders: OrderEntity[] | undefined;
  pastOrders: OrderEntity[] | undefined;
};

/**
 * ダッシュボードでアイテムごとの杯数を表示するコンポーネント
 * @param props
 * @returns
 */
const TotalOrderWithPast = ({ realtimeOrders, pastOrders }: props) => {
  const [displayRange, setDisplayRange] = useState(10);
  const [displayIsSum, setDisplayIsSum] = useState(true);
  const chartData = useMemo(() => {
    // 時系列順にソート
    const sortedRealtime = [...(realtimeOrders ? realtimeOrders : [])].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const sortedPast = [...(pastOrders ? pastOrders : [])].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    const pastStart = sortedPast[0]?.createdAt ?? new Date();

    // 時刻をdisplayRange分ごとに丸める
    function roundToMin(date: Date): string {
      const d = dayjs(date);
      const minutes = Math.floor(d.minute() / displayRange) * displayRange; // 10分単位に切り捨て
      return d.minute(minutes).second(0).millisecond(0).toString();
    }

    //時間帯の合計を作る
    const realtimeMap = sortedRealtime.reduce((map, o) => {
      const key = roundToMin(new Date(o.createdAt));
      const prev = map.get(key) ?? 0;
      map.set(key, prev + o.getDrinkCups().length);
      return map;
    }, new Map<string, number>());

    const pastMap = sortedPast.reduce((map, o) => {
      const key = roundToMin(new Date(o.createdAt));
      const prev = map.get(key) ?? 0;
      map.set(key, prev + o.getDrinkCups().length);
      return map;
    }, new Map<string, number>());

    // 時刻の全リストを作って結合
    const allKeys = Array.from(
      new Set([...realtimeMap.keys(), ...pastMap.keys()]),
    ).sort();

    let realtimeSum = 0;
    let pastSum = 0;

    // 結合したchartDataを作成
    const chartData = allKeys.map((key) => {
      const start = dayjs(key, "HH:mm");
      const end = start.add(displayRange, "minute");
      const rangeLabel = `${start.format("HH:mm")}-${end.format("HH:mm")}`;
      realtimeSum += realtimeMap.get(key) ?? 0;
      pastSum += pastMap.get(key) ?? 0;

      return {
        createdAt: rangeLabel, // x軸に使用する注文時刻
        realtimeData:
          displayIsSum === true ? realtimeSum : realtimeMap.get(key),
        pastData: displayIsSum === true ? pastSum : pastMap.get(key),
        fill: "var(--color-aulait)",
      };
    });
    return chartData;
  }, [realtimeOrders, pastOrders, displayRange, displayIsSum]);

  return (
    <>
      <Card>
        <CardHeader className="flex justify-between">
          <CardTitle>総注文杯数（去年との比較）</CardTitle>
          <CardDescription>ドリンクのみ</CardDescription>
          <Select
            onValueChange={(value) => {
              const [range, type] = value.split("-");
              setDisplayRange(Number(range));
              setDisplayIsSum(type === "sum");
            }}
            defaultValue={"10-sum"} // 初期値
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="表示データ" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10-sum">10分毎、総杯数</SelectItem>
              <SelectItem value="10-per">10分毎、毎杯数</SelectItem>
              <SelectItem value="60-sum">1時間毎、総杯数</SelectItem>
              <SelectItem value="60-per">1時間毎、毎杯数</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig}>
            <AreaChart data={chartData}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="createdAt"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickMargin={8}
                dataKey={"realtimeData"}
                tickFormatter={(v) => v}
                allowDataOverflow={true}
              />
              <ChartTooltip cursor={false} content={<CustomTooltipContent />} />

              {/* グラデーション設定 */}
              <defs>
                {/* 緑系（現在データ） */}
                <linearGradient id="fillRealtime" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6EE7B7" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#6EE7B7" stopOpacity={0.1} />
                </linearGradient>

                {/* 紫系（過去データ） */}
                <linearGradient id="fillPast" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#A78BFA" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#A78BFA" stopOpacity={0.1} />
                </linearGradient>
              </defs>

              <Area
                dataKey="realtimeData"
                type="monotone"
                fill="url(#fillRealtime)"
                stroke="#6EE7B7"
                strokeWidth={2}
                fillOpacity={0.4}
              />

              <Area
                dataKey="pastData"
                type="monotone"
                fill="url(#fillPast)"
                stroke="#A78BFA"
                strokeWidth={2}
                fillOpacity={0.3}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </>
  );
};

// カスタムツールチップコンポーネント
const CustomTooltipContent = ({
  active,
  payload,
  label,
}: TooltipProps<number, string>) => {
  if (active && payload && payload.length) {
    // payload[0], payload[1] などに各系列データが入っている
    const current = payload.find((p) => p.dataKey === "realtimeData");
    const past = payload.find((p) => p.dataKey === "pastData");

    return (
      <div className="rounded-lg border bg-background p-2 shadow-md">
        <div className="grid gap-2">
          {/* 時間帯 */}
          <div className="flex flex-col">
            <span className="text-[0.70rem] text-muted-foreground uppercase">
              注文時刻
            </span>
            <span className="font-bold">{label}</span>
          </div>

          {/* 現在の注文 */}
          {current && (
            <div className="flex flex-col">
              <span className="text-[0.70rem] text-muted-foreground uppercase">
                現在のデータ
              </span>
              <span className="font-bold">{current.value}</span>
            </div>
          )}

          {/* 過去の注文 */}
          {past && (
            <div className="flex flex-col">
              <span className="text-[0.70rem] text-muted-foreground uppercase">
                過去のデータ
              </span>
              <span className="font-bold">{past.value}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
};

const chartConfig = {
  realtimeData: {
    label: "現在のデータ",
    color: "hsl(var(--chart-1))",
  },
  pastData: {
    label: "過去のデータ",
    color: "hsl(var(--chart-2))",
  },
} satisfies ChartConfig;

export { TotalOrderWithPast };
