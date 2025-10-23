"use client";

import type { OrderEntity } from "@cafeore/common";
import dayjs from "dayjs";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Button } from "~/components/ui/button";
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

// カスタムツールチップコンポーネント
const CustomTooltipContent = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="rounded-lg border bg-background p-2 shadow-md">
        <div className="grid gap-2">
          <div className="flex flex-col">
            <span className="text-[0.70rem] uppercase text-muted-foreground">
              時刻
            </span>
            <span className="font-bold">{label}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[0.70rem] uppercase text-muted-foreground">
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

type UploadedOrderData = {
  orders: OrderEntity[];
};

type props = {
  orders: OrderEntity[] | undefined;
};

/**
 * ファイルアップロード機能付きの提供時間グラフコンポーネント
 * @param props
 * @returns
 */
const FileUploadGraph = ({ orders }: props) => {
  const [uploadedOrders, setUploadedOrders] = useState<OrderEntity[] | undefined>(undefined);
  const [fileName, setFileName] = useState<string>("");

  // アップロードされたデータまたは既存のデータを使用
  const dataToUse = uploadedOrders || orders;

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const jsonData = JSON.parse(e.target?.result as string) as UploadedOrderData;
        
        // createdAtでソート
        const sortedOrders = jsonData.orders.sort((a, b) => 
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        
        setUploadedOrders(sortedOrders);
      } catch (error) {
        console.error("JSONファイルの解析に失敗しました:", error);
        alert("JSONファイルの解析に失敗しました。正しい形式のファイルをアップロードしてください。");
      }
    };
    reader.readAsText(file);
  };

  const chartData =
    dataToUse
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
      label: "提供時間",
      color: "hsl(var(--chart-1))",
    },
  } satisfies ChartConfig;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>提供時間の推移</CardTitle>
            <CardDescription>
              注文の受付から提供までにかかった時間の推移を表示します
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload"
              />
              <label htmlFor="file-upload">
                <Button asChild variant="outline">
                  <span>アップロード</span>
                </Button>
              </label>
              {uploadedOrders && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setUploadedOrders(undefined);
                    setFileName("");
                  }}
                >
                  リセット
                </Button>
              )}
            </div>
            {fileName && (
              <span className="text-sm text-muted-foreground">
                アップロード済み: {fileName}
              </span>
            )}
          </div>
        </div>
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
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <ChartTooltip
              cursor={false}
              content={<CustomTooltipContent />}
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

export { FileUploadGraph };
