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
  pastRange: OrderEntity[] | undefined;
};

/**
 * ダッシュボードでアイテムごとの杯数を表示するコンポーネント
 * @param props
 * @returns
 */
const ItemBarChart = ({ orders, pastRange }: props) => {
  // 集計関数
  const sumByItem = (orders: OrderEntity[] | undefined) => {
    if (!orders) return;

    // 読み替えをハードコード
    const renameMap: Record<string, string | string[]> = {
      "01_beppin_brend": "01_yukari_brend",
      "04_mandheling": "06_toraja",
      "06_costa_rica_red_honey": "04_kilimanjaro",
      "03_special": ["03_Lychee", "07_blumoun"],
    };

    const result: Record<string, number> = {};

    for (const order of orders) {
      for (const item of order.items) {
        const mapped = renameMap[item.id];
        if (mapped === undefined) {
          result[item.id] = (result[item.id] ?? 0) + 1;
        } else if (typeof mapped === "string") {
          result[mapped] = (result[mapped] ?? 0) + 1;
        } else {
          for (const newName of mapped) {
            result[newName] = (result[newName] ?? 0) + 1;
          }
        }
      }
    }

    return result;
  };

  const TYPE_COLOR_MAP = {
    hot: "var(--color-hot)",
    ice: "var(--color-ice)",
    iceOre: "var(--color-aulait)",
    milk: "var(--color-milk)",
    others: "var(--color-others)",
  } as const;

  const realtimeSum = sumByItem(orders);
  const pastSum = sumByItem(pastRange);

  const chartData = Object.entries(ITEM_MASTER).map(([, item]) => ({
    name: item.abbr,
    realtimeData: realtimeSum ? realtimeSum[item.id] : 0,
    pastData: pastSum ? pastSum[item.id] : 0,
    fill: TYPE_COLOR_MAP[item.type] ?? "var(--color-hot)",
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>商品ごとの杯数（過去との比較）</CardTitle>
        <CardDescription>
          商品ごとの総杯数(濃)と過去データの現時点での総杯数(薄)を表示します{" "}
          <br />
          読み替え：べっぴん→縁、マンデ→トラジャ、コスタリカ→キリマン、限定→ライチ、ブルマン
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
