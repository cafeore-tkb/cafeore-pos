import { describe, expect, test } from "vitest";
import { labelMarginFits, withPrinterSettingDefaults } from "./printerSetting";

describe("[unit] withPrinterSettingDefaults", () => {
  const ips = {
    label_printer_ip: "192.168.77.2",
    receipt_printer_ip: "192.168.77.3",
  };

  test("知っている機種・用紙の幅・種類・シールの大きさ・向き・最後の送り方はそのまま", () => {
    const settings = {
      ...ips,
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
    } as const;
    expect(withPrinterSettingDefaults(settings)).toEqual(settings);
  });

  test("機種・用紙・シールの大きさ・向き・最後の送り方を返さない前の API・知らない値なら、既定にする（ラベル用は 29mm・360 ドット・余白なしで 180° 回し、空のシールを 1 枚送る。レシート用は 58mm のレシート紙）", () => {
    for (const settings of [
      ips,
      {
        ...ips,
        receipt_printer_model: "tm_t88",
        label_printer_paper_width: "112mm",
        receipt_printer_paper_width: "toString",
        label_printer_paper_type: "label",
        receipt_printer_paper_type: "toString",
        label_printer_label_length_mm: "29",
        label_printer_print_width_dots: 361,
        label_printer_margin_mm: -1,
        label_printer_rotate_180: "false",
        label_printer_trailing_feed: "next_tof",
      },
    ]) {
      expect(withPrinterSettingDefaults(settings)).toEqual({
        ...ips,
        receipt_printer_model: "tm_l90",
        label_printer_paper_width: "80mm",
        receipt_printer_paper_width: "58mm",
        label_printer_paper_type: "die_cut_label",
        receipt_printer_paper_type: "receipt",
        label_printer_label_length_mm: 29,
        label_printer_print_width_dots: 360,
        label_printer_margin_mm: 0,
        label_printer_rotate_180: true,
        label_printer_trailing_feed: "blank_label",
      });
    }
  });

  test("余白の内側に印字する所が残らなければ、シールの大きさは 3 つとも既定にする", () => {
    expect(
      withPrinterSettingDefaults({
        ...ips,
        label_printer_label_length_mm: 10,
        label_printer_print_width_dots: 384,
        label_printer_margin_mm: 4.5,
      }),
    ).toMatchObject({
      label_printer_label_length_mm: 29,
      label_printer_print_width_dots: 360,
      label_printer_margin_mm: 0,
    });
  });
});

describe("[unit] labelMarginFits", () => {
  test("余白の内側に縦横 2mm 残れば収まる", () => {
    expect(labelMarginFits(10, 384, 4)).toBe(true);
    expect(labelMarginFits(10, 384, 4.5)).toBe(false);
    // 印字幅（64 ドット = 8mm）の方が短い
    expect(labelMarginFits(29, 64, 3)).toBe(true);
    expect(labelMarginFits(29, 64, 3.5)).toBe(false);
  });
});
