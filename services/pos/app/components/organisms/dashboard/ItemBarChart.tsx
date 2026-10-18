import { type OrderEntity, useMenuMaster } from "@cafeore/common";
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
  const itemMaster = useMenuMaster().items;

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
      for (const item of order.menus) {
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
  };

  type ColorKey = keyof typeof TYPE_COLOR_MAP;

  const getTypeColor = (name: string): string => {
    if (name in TYPE_COLOR_MAP) {
      return TYPE_COLOR_MAP[name as ColorKey];
    }
    return "var(--color-default)"; // 存在しないキーの場合のフォールバック
  };

  const realtimeSum = sumByItem(orders);
  const pastSum = sumByItem(pastOrders);

  const chartData = Object.entries(itemMaster).map(([, item]) => ({
    name: item.abbr,
    realtimeData: realtimeSum ? realtimeSum[item.id] : 0,
    pastData: pastSum ? pastSum[item.id] : 0,
    fill: getTypeColor(item.item_type.name) ?? "var(--color-hot)",
  }));

  return (
    <Card className="overflow-hidden rounded-2xl border-stone-200 shadow-sm">
      <CardHeader className="border-stone-100 border-b bg-gradient-to-r from-stone-50 to-teal-50/50">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="tracking-tight">商品ごとの杯数</CardTitle>
            <CardDescription className="mt-2 max-w-3xl leading-relaxed">
              選択期間の商品ごとの総杯数と、読み込んだ過去データの総杯数を比較します。
              <br />
              読み替え：べっぴん→縁、マンデ→トラジャ、コスタリカ→キリマン、限定→ライチ、ブルマン
            </CardDescription>
          </div>
          <div
            className="flex shrink-0 flex-wrap gap-3 rounded-xl bg-white/80 px-3 py-2 text-xs shadow-sm ring-1 ring-stone-200"
            aria-label="グラフの凡例"
          >
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-teal-700" />
              現在
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-teal-700 opacity-40" />
              過去
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-6 sm:p-6">
        <ChartContainer config={chartConfig} className="min-h-72 w-full">
          <BarChart accessibilityLayer data={chartData}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              tickFormatter={(value) => value.slice(0, 5)}
            />
            <YAxis axisLine={false} tickLine={false} width={32} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="realtimeData" radius={[5, 5, 0, 0]} maxBarSize={36} />
            <Bar
              dataKey="pastData"
              radius={[5, 5, 0, 0]}
              maxBarSize={36}
              style={{ opacity: 0.4 }}
            />
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
