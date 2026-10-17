import { describe, expect, test } from "vitest";
import { parseStoredPrinterSettings } from "./usePrinterAddresses";

describe("[unit] parseStoredPrinterSettings", () => {
  test("覚えておいた IP アドレスと機種・用紙の幅を読む", () => {
    const stored = {
      label_printer_ip: "192.168.77.12",
      receipt_printer_ip: "192.168.77.13",
      receipt_printer_model: "tm_m30",
      label_printer_paper_width: "58mm",
      receipt_printer_paper_width: "80mm",
    };
    expect(parseStoredPrinterSettings(JSON.stringify(stored))).toEqual(stored);
  });

  const ips = {
    label_printer_ip: "192.168.77.12",
    receipt_printer_ip: "192.168.77.13",
  };

  test("用紙の幅を選べるようにする前に覚えた設定は、機種はそのまま、用紙の幅を既定（ラベル用 80mm・レシート用 58mm）にする", () => {
    expect(
      parseStoredPrinterSettings(
        JSON.stringify({ ...ips, receipt_printer_model: "tm_m30" }),
      ),
    ).toEqual({
      ...ips,
      receipt_printer_model: "tm_m30",
      label_printer_paper_width: "80mm",
      receipt_printer_paper_width: "58mm",
    });
  });

  test("機種・用紙の幅が無い・知らない値なら、既定にする", () => {
    for (const stored of [
      ips,
      {
        ...ips,
        receipt_printer_model: "tm_t88",
        label_printer_paper_width: "112mm",
        receipt_printer_paper_width: 58,
      },
      {
        ...ips,
        receipt_printer_model: "toString",
        label_printer_paper_width: "toString",
        receipt_printer_paper_width: "hasOwnProperty",
      },
    ]) {
      expect(parseStoredPrinterSettings(JSON.stringify(stored))).toEqual({
        ...ips,
        receipt_printer_model: "tm_l90",
        label_printer_paper_width: "80mm",
        receipt_printer_paper_width: "58mm",
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
