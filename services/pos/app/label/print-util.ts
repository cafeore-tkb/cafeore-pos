import type { ItemEntity, OrderEntity } from "@cafeore/common";
import { useRawPrinter } from "./printer";

export const usePrinter = () => {
  const rawPrinter = useRawPrinter();

  const printSingleItemLabel = (
    orderId: number,
    index: number,
    total: number,
    item: ItemEntity,
  ) => {
    console.log(item.name);
    rawPrinter.addLine(`No. ${orderId.toString()}`, [2, 2]);
    rawPrinter.addLine(item.name, [1, 2]);
    rawPrinter.addLine(`${index}/${total}`, [2, 1]);
    if (item.assignee) {
      rawPrinter.addLine(`指名： ${item.assignee}`, [1, 1]);
    } else {
      rawPrinter.addLine("　", [1, 1]);
    }
    rawPrinter.addFeed(1);
  };

  // 追加で番号と注文を載せたラベルを印刷
  const printOrderSummaryLabel = (order: OrderEntity) => {
    rawPrinter.addLine(
      `No. ${order.orderId.toString().padEnd(4, " ")}￥${order.total}`,
      [2, 2],
    );

    for (let i = 0; i < order.items.length; i += 2) {
      const item1 = order.items[i];
      const item2 = order.items[i + 1];

      if (item2) {
        // 2つある場合は横に並べる
        const line = `${item1.name.padEnd(10, " ")}${item2.name}`;
        rawPrinter.addLine(line, [1, 1]);
      } else {
        // 1つだけの場合
        rawPrinter.addLine(item1.name, [1, 1]);
      }
    }
  };

  const printOrderLabel = (order: OrderEntity) => {
    const items = order.items.toSorted((a, b) => a.name.localeCompare(b.name));
    rawPrinter.init();

    const coffees = order.getCoffeeCups();

    console.log(coffees);

    // 各アイテムのラベルを印刷
    for (const [idx, item] of coffees.entries()) {
      printSingleItemLabel(
        order.orderId,
        idx + 1,
        order.getCoffeeCups().length,
        item,
      );
    }

    // 引換券に貼るラベルを印刷
    printOrderSummaryLabel(order);

    rawPrinter.addFeed(7);
    rawPrinter.print();
  };

  return { status: rawPrinter.status, printOrderLabel };
};
