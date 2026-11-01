import { describe, expect, test } from "vitest";
import { parseStoredPrinterSettings } from "./usePrinterAddresses";

describe("[unit] parseStoredPrinterSettings", () => {
  test("覚えておいた IP アドレスと機種・用紙の幅・種類・シールの大きさ・向き・最後の送り方を読む", () => {
    const stored = {
      label_printer_ip: "192.168.77.12",
      receipt_printer_ip: "192.168.77.13",
      receipt_printer_model: "tm_m30",
      label_printer_paper_width: "58mm",
      receipt_printer_paper_width: "80mm",
      label_printer_paper_type: "receipt",
      receipt_printer_paper_type: "die_cut_label",
      label_printer_label_length_mm: 30.5,
      label_printer_print_width_dots: 384,
      label_printer_margin_mm: 1.5,
      label_printer_rotate_180: false,
      label_printer_trailing_feed: "peeling",
      label_printer_receipt_cut: "full",
    };
    expect(parseStoredPrinterSettings(JSON.stringify(stored))).toEqual(stored);
  });

  const ips = {
    label_printer_ip: "192.168.77.12",
    receipt_printer_ip: "192.168.77.13",
  };

  /** シールの大きさ・向き・最後の送り方の既定（29mm・360 ドット・余白なしで 180° 回し、空のシールを 1 枚送る） */
  const defaultLabelSize = {
    label_printer_label_length_mm: 29,
    label_printer_print_width_dots: 360,
    label_printer_margin_mm: 0,
    label_printer_rotate_180: true,
    label_printer_trailing_feed: "blank_label",
    label_printer_receipt_cut: "partial",
  };

  test("用紙の種類を選べるようにする前に覚えた設定は、機種・用紙の幅はそのまま、種類（ラベル用はダイカットラベル・レシート用はレシート紙）とシールの大きさを既定にする", () => {
    const before = {
      ...ips,
      receipt_printer_model: "tm_m30",
      label_printer_paper_width: "58mm",
      receipt_printer_paper_width: "80mm",
    };
    expect(parseStoredPrinterSettings(JSON.stringify(before))).toEqual({
      ...before,
      label_printer_paper_type: "die_cut_label",
      receipt_printer_paper_type: "receipt",
      ...defaultLabelSize,
    });
  });

  test("機種・用紙の幅・種類・シールの大きさ・向き・最後の送り方が無い・知らない値なら、既定にする", () => {
    for (const stored of [
      ips,
      {
        ...ips,
        receipt_printer_model: "tm_t88",
        label_printer_paper_width: "112mm",
        receipt_printer_paper_width: 58,
        label_printer_paper_type: "label",
        receipt_printer_paper_type: null,
        label_printer_label_length_mm: 0,
        label_printer_print_width_dots: "360",
        label_printer_margin_mm: null,
        label_printer_rotate_180: 0,
        label_printer_trailing_feed: "toString",
        label_printer_receipt_cut: "tear",
      },
      {
        ...ips,
        receipt_printer_model: "toString",
        label_printer_paper_width: "toString",
        receipt_printer_paper_width: "hasOwnProperty",
        label_printer_paper_type: "constructor",
        receipt_printer_paper_type: "toString",
      },
    ]) {
      expect(parseStoredPrinterSettings(JSON.stringify(stored))).toEqual({
        ...ips,
        receipt_printer_model: "tm_l90",
        label_printer_paper_width: "80mm",
        receipt_printer_paper_width: "58mm",
        label_printer_paper_type: "die_cut_label",
        receipt_printer_paper_type: "receipt",
        ...defaultLabelSize,
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
