import { DEFAULT_PRINTER_SETTINGS } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import {
  labelPrintableWidth,
  printableWidths,
  receiptPrintableWidth,
} from "./paper";

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

  test("既定の設定では、ラベル用は 80mm のダイカットラベル（560）、レシート用は 58mm のレシート紙の TM-L90（416）", () => {
    expect(labelPrintableWidth(DEFAULT_PRINTER_SETTINGS)).toBe(560);
    expect(receiptPrintableWidth(DEFAULT_PRINTER_SETTINGS)).toBe(416);
  });

  test("用紙の種類・幅・機種を変えると、それに合わせる", () => {
    const settings = {
      ...DEFAULT_PRINTER_SETTINGS,
      label_printer_paper_type: "receipt",
      label_printer_paper_width: "58mm",
      receipt_printer_model: "tm_m30",
      receipt_printer_paper_type: "die_cut_label",
      receipt_printer_paper_width: "80mm",
    } as const;
    expect(labelPrintableWidth(settings)).toBe(416);
    expect(receiptPrintableWidth(settings)).toBe(560);
  });
});
