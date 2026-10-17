import { describe, expect, test } from "vitest";
import { withPrinterSettingDefaults } from "./printerSetting";

describe("[unit] withPrinterSettingDefaults", () => {
  const ips = {
    label_printer_ip: "192.168.77.2",
    receipt_printer_ip: "192.168.77.3",
  };

  test("知っている機種・用紙の幅はそのまま", () => {
    const settings = {
      ...ips,
      receipt_printer_model: "tm_m30",
      label_printer_paper_width: "58mm",
      receipt_printer_paper_width: "80mm",
    } as const;
    expect(withPrinterSettingDefaults(settings)).toEqual(settings);
  });

  test("機種・用紙の幅を返さない前の API・知らない値なら、既定にする（ラベル用は 80mm、レシート用は 58mm）", () => {
    for (const settings of [
      ips,
      {
        ...ips,
        receipt_printer_model: "tm_t88",
        label_printer_paper_width: "112mm",
        receipt_printer_paper_width: "toString",
      },
    ]) {
      expect(withPrinterSettingDefaults(settings)).toEqual({
        ...ips,
        receipt_printer_model: "tm_l90",
        label_printer_paper_width: "80mm",
        receipt_printer_paper_width: "58mm",
      });
    }
  });
});
