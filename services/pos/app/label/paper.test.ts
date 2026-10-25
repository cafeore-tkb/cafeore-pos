import { DEFAULT_PRINTER_SETTINGS } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import { labelGeometry, printableWidths, receiptPrintableWidth } from "./paper";

describe("[unit] printableWidths", () => {
  test("ダイカットラベルは機種によらずレシート紙より狭い", () => {
    for (const model of ["tm_l90", "tm_m30"] as const) {
      expect(printableWidths("die_cut_label", model)).toEqual({
        "58mm": 384,
        "80mm": 560,
      });
    }
  });

  test("レシート紙の 58mm は機種で違い、機種を省くと狭い方（TM-L90）", () => {
    expect(printableWidths("receipt", "tm_l90")["58mm"]).toBe(416);
    expect(printableWidths("receipt", "tm_m30")["58mm"]).toBe(420);
    expect(printableWidths("receipt")).toEqual({ "58mm": 416, "80mm": 576 });
  });

  test("既定の設定では、レシート用は 58mm のレシート紙の TM-L90（416）", () => {
    expect(receiptPrintableWidth(DEFAULT_PRINTER_SETTINGS)).toBe(416);
  });

  test("用紙の種類・幅・機種を変えると、それに合わせる", () => {
    const settings = {
      ...DEFAULT_PRINTER_SETTINGS,
      receipt_printer_model: "tm_m30",
      receipt_printer_paper_type: "die_cut_label",
      receipt_printer_paper_width: "80mm",
    } as const;
    expect(receiptPrintableWidth(settings)).toBe(560);
  });
});

describe("[unit] labelGeometry", () => {
  test("既定の設定では、印字幅 360 ドット・長さ 29mm（232 ドット）・余白なしで、回さない", () => {
    expect(labelGeometry(DEFAULT_PRINTER_SETTINGS)).toEqual({
      width: 360,
      height: 232,
      margin: 0,
      rotate180: false,
    });
  });

  test("長さと余白の mm は、1mm = 8 ドットにして端数を丸める。用紙の種類・幅は見ない", () => {
    const settings = {
      ...DEFAULT_PRINTER_SETTINGS,
      label_printer_paper_width: "58mm",
      label_printer_label_length_mm: 30.06,
      label_printer_print_width_dots: 384,
      label_printer_margin_mm: 1.5,
      label_printer_rotate_180: true,
    } as const;
    expect(labelGeometry(settings)).toEqual({
      width: 384,
      height: 240,
      margin: 12,
      rotate180: true,
    });
  });
});
