import type { ItemEntity } from "common/models/item";
import type { OrderEntity } from "common/models/order";
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

  const printOrderLabel = (order: OrderEntity) => {
    const items = order.items.toSorted((a, b) => a.name.localeCompare(b.name));
    rawPrinter.init();

    const coffees = order.getCoffeeCups();

    console.log(coffees);

    for (const [idx, item] of coffees.entries()) {
      printSingleItemLabel(
        order.orderId,
        idx + 1,
        order.getCoffeeCups().length,
        item,
      );
    }
    rawPrinter.addFeed(7);
    rawPrinter.print();
  };

  return { status: rawPrinter.status, printOrderLabel };
};
