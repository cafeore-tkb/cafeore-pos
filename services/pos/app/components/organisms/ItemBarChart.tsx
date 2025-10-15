import {
  ITEM_MASTER,
  type OrderEntity,
  type WithId,
  itemSource,
} from "@cafeore/common";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  XAxis,
  YAxis,
} from "recharts";
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
 * ダッシュボードでアイテムごとの杯数を表示するコンポーネント
 * @param props
 * @returns
 */
const ItemBarChart = ({ orders }: props) => {
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
  const chartData = [
    {
      name: "優勝",
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
      name: "トラジャ",
      num: itemValue(ITEM_MASTER["]"].name),
      fill: "var(--color-hot)",
    },
    {
      name: "キリマン",
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
      name: "牛",
      num: itemValue(ITEM_MASTER["["].name),
      fill: "var(--color-aulait)",
    },
    {
      name: "トート+優勝",
      num: itemValue(ITEM_MASTER["@"].name),
      fill: "var(--color-aulait)",
    },
    {
      name: "ミルク",
      num: itemValue(ITEM_MASTER["."].name),
      fill: "var(--color-milk)",
    },
  ];

  return (
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

export { ItemBarChart };
