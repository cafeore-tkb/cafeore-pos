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
    rawPrinter.addHeader(orderId, null);
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
    rawPrinter.addHeader(order.orderId, order.total);

    const assignedItems = order.items.filter((item) => item.assignee !== null);
    const unassignedItems = order.items.filter(
      (item) => item.assignee === null,
    );

    assignedItems.map((item) => {
      rawPrinter.addLine(item.name, [1, 1]);
      rawPrinter.addLine(`  指名：${item.assignee}`, [1, 1]);
    });

    for (let i = 0; i < unassignedItems.length; i += 2) {
      // アイテム名が8文字以上のときは6文字だけ取り出す
      // 俺ブレが正式名称だと入らない、ブレンで切りたくないため
      const item1 =
        unassignedItems[i].name.length < 8
          ? unassignedItems[i].name
          : unassignedItems[i].name.slice(0, 6);
      const item2 = unassignedItems[i + 1]
        ? unassignedItems[i + 1].name.length < 8
          ? unassignedItems[i + 1].name
          : unassignedItems[i + 1].name.slice(0, 6)
        : null;

      if (item2) {
        // 2つある場合は横に並べる
        const line = `${item1.padEnd(8, " ")}${item2}`;
        rawPrinter.addLine(line, [1, 1]);
      } else {
        // 1つだけの場合
        rawPrinter.addLine(item1, [1, 1]);
      }
    }
  };

  const printOrderLabel = (order: OrderEntity) => {
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

  // 緊急アイテムだけを印刷
  const printEmergencyItem = (order: OrderEntity, item: ItemEntity) => {
    rawPrinter.init();

    const coffees = order.getCoffeeCups();
    const itemIndex = coffees.findIndex((i) => i.id === item.id);

    if (itemIndex !== -1) {
      printSingleItemLabel(order.orderId, itemIndex + 1, coffees.length, item);
    }

    rawPrinter.addFeed(7);
    rawPrinter.print();
  };

  return { status: rawPrinter.status, printOrderLabel, printEmergencyItem };
};
