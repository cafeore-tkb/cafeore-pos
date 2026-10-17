import { describe, expect, test } from "vitest";
import { parseStoredPrinterSettings } from "./usePrinterAddresses";

describe("[unit] parseStoredPrinterSettings", () => {
  test("覚えておいた IP アドレスと機種を読む", () => {
    expect(
      parseStoredPrinterSettings(
        JSON.stringify({
          label_printer_ip: "192.168.77.12",
          receipt_printer_ip: "192.168.77.13",
          receipt_printer_model: "tm_m30",
        }),
      ),
    ).toEqual({
      label_printer_ip: "192.168.77.12",
      receipt_printer_ip: "192.168.77.13",
      receipt_printer_model: "tm_m30",
    });
  });

  test("機種が無い（機種を選べるようにする前に覚えた）・知らない機種なら、既定の機種にする", () => {
    const ips = {
      label_printer_ip: "192.168.77.12",
      receipt_printer_ip: "192.168.77.13",
    };
    for (const stored of [
      ips,
      { ...ips, receipt_printer_model: "tm_t88" },
      { ...ips, receipt_printer_model: "toString" },
    ]) {
      expect(parseStoredPrinterSettings(JSON.stringify(stored))).toEqual({
        ...ips,
        receipt_printer_model: "tm_l90",
      });
    }
  });

  test("覚えていない・読めない・IP アドレスが無いなら null", () => {
    expect(parseStoredPrinterSettings(null)).toBeNull();
    expect(parseStoredPrinterSettings("{")).toBeNull();
    expect(
      parseStoredPrinterSettings(
        JSON.stringify({ label_printer_ip: "192.168.77.12" }),
      ),
    ).toBeNull();
  });
});
