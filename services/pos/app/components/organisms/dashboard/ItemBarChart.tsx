import { ITEM_MASTER, type OrderEntity } from "@cafeore/common";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
  orders: OrderEntity[] | undefined;
  pastOrders: OrderEntity[] | undefined;
};

/**
 * ダッシュボードでアイテムごとの杯数を表示するコンポーネント
 * @param props
 * @returns
 */
const ItemBarChart = ({ orders, pastOrders }: props) => {
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
    if (!orders) return;

    // 名前読み替えハードコード
    const renameMap: Record<string, string | string[]> = {
      べっぴんブレンド: "縁ブレンド",
      マンデリン: "トラジャ",
      "コスタリカ レッドハニー": "キリマンジャロ",
      限定: ["ライチ", "ブルマン"],
    };

    const result: Record<string, number> = {};

    for (const o of orders) {
      for (const item of o.items) {
        const mapped = renameMap[item.name];

        if (mapped === undefined) {
          // 読み替え対象外はそのままカウント
          result[item.name] = (result[item.name] ?? 0) + 1;
        } else if (typeof mapped === "string") {
          // 単一置き換え
          result[mapped] = (result[mapped] ?? 0) + 1;
        } else {
          // 複数展開（例：「限定」→「ライチ」「ブルマン」）
          for (const newName of mapped) {
            result[newName] = (result[newName] ?? 0) + 1;
          }
        }
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
        <CardTitle>商品ごとの杯数（過去との比較）</CardTitle>
        <CardDescription>
          <p>
            商品ごとの総杯数(濃)と過去データの現時点での総杯数(薄)を表示します
          </p>
          <p>
            読み替え：べっぴん→縁、マンデ→トラジャ、コスタリカ→キリマン、限定→ライチ、ブルマン
          </p>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          <BarChart accessibilityLayer data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => value.slice(0, 5)}
            />
            <YAxis />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="realtimeData" radius={1} />
            <Bar dataKey="pastData" radius={1} style={{ opacity: 0.4 }} />
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

export { ItemBarChart };
