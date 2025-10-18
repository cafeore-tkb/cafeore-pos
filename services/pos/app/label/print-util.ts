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

    for (let i = 0; i < order.items.length; i += 2) {
      // アイテム名が8文字以上のときは6文字だけ取り出す
      const item1 =
        order.items[i].name.length < 8
          ? order.items[i].name
          : order.items[i].name.slice(0, 6);
      const item2 = order.items[i + 1]
        ? order.items[i + 1].name.length < 8
          ? order.items[i + 1].name
          : order.items[i + 1].name.slice(0, 6)
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

  return { status: rawPrinter.status, printOrderLabel };
};
