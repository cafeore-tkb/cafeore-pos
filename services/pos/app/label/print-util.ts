import type { OrderEntity } from "@cafeore/common";
import { useCallback, useEffect, useState } from "react";
import { createEposPrinter } from "./infra/epos";
import type {
  CreateLabelPrinter,
  PrinterConnectionStatus,
} from "./infra/printer";
import { orderLabelJob } from "./order-label";

/**
 * シールのプリンター
 *
 * 注文から印刷データを作り（order-label）、プリンター（infra）に渡して刷る。
 * 使うプリンターは createPrinter で差し替えられる（既定は Epson の ePOS）。
 */
export const usePrinter = (
  createPrinter: CreateLabelPrinter = createEposPrinter,
) => {
  const [status, setStatus] = useState<"init" | PrinterConnectionStatus>(
    "init",
  );
  const [printer] = useState(() => createPrinter(setStatus));

  /**
   * BAD
   * https://ja.react.dev/learn/you-might-not-need-an-effect#initializing-the-application
   */
  useEffect(() => {
    printer.connect();
  }, [printer]);

  const printOrderLabel = useCallback(
    (order: OrderEntity) => {
      printer.print(orderLabelJob(order));
    },
    [printer],
  );

  return { status, printOrderLabel };
};
