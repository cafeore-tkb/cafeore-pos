import { describe, expect, test } from "vitest";
import {
  type PrinterSettings,
  withReceiptPrinterModel,
} from "./printerSetting";

describe("[unit] withReceiptPrinterModel", () => {
  const ips = {
    label_printer_ip: "192.168.77.2",
    receipt_printer_ip: "192.168.77.3",
  };

  test("知っている機種はそのまま", () => {
    expect(
      withReceiptPrinterModel({ ...ips, receipt_printer_model: "tm_m30" }),
    ).toEqual({ ...ips, receipt_printer_model: "tm_m30" });
  });

  test("機種を返さない前の API・知らない機種なら、既定の機種にする", () => {
    for (const settings of [
      ips,
      { ...ips, receipt_printer_model: "tm_t88" },
    ] as PrinterSettings[]) {
      expect(withReceiptPrinterModel(settings)).toEqual({
        ...ips,
        receipt_printer_model: "tm_l90",
      });
    }
  });
});
