import {
  DEFAULT_PRINTER_SETTINGS,
  type PrinterSettings,
  usePrinterSettings,
  withPrinterSettingDefaults,
} from "@cafeore/common";
import { useEffect, useState } from "react";

/** 最後に取れたプリンター設定を覚えておくキー */
const STORAGE_KEY = "cafeore:printer-settings";

/**
 * 覚えておいたプリンター設定を読む。読めなければ null
 *
 * 機種・用紙の幅・種類・シールの大きさ・向きを選べるようにする前に覚えた設定にはそれが無いので、そのときは既定にする。
 */
export const parseStoredPrinterSettings = (
  raw: string | null,
): PrinterSettings | null => {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "label_printer_ip" in parsed &&
      "receipt_printer_ip" in parsed &&
      typeof parsed.label_printer_ip === "string" &&
      typeof parsed.receipt_printer_ip === "string"
    ) {
      const {
        receipt_printer_model,
        label_printer_paper_width,
        receipt_printer_paper_width,
        label_printer_paper_type,
        receipt_printer_paper_type,
        label_printer_label_length_mm,
        label_printer_print_width_dots,
        label_printer_margin_mm,
        label_printer_rotate_180,
      }: Record<string, unknown> = parsed;
      return withPrinterSettingDefaults({
        label_printer_ip: parsed.label_printer_ip,
        receipt_printer_ip: parsed.receipt_printer_ip,
        receipt_printer_model,
        label_printer_paper_width,
        receipt_printer_paper_width,
        label_printer_paper_type,
        receipt_printer_paper_type,
        label_printer_label_length_mm,
        label_printer_print_width_dots,
        label_printer_margin_mm,
        label_printer_rotate_180,
      });
    }
    return null;
  } catch {
    return null;
  }
};

const loadSettings = (): PrinterSettings | null => {
  try {
    return parseStoredPrinterSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
};

const storeSettings = (settings: PrinterSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 覚えておけなくても、取れた設定はこのページを開いている間は使える
  }
};

/**
 * レジがつなぐプリンターの IP アドレス、ラベル用のシールの大きさと向き、レシート用のプリンターの用紙（幅と種類）と機種
 *
 * 設定は管理画面で決め、サーバーから取る。レジは API に届かなくても会計を続けられるので、
 * 取れないとき（取れるまでの間も）は最後に取れた設定、それも無ければ既定値でつなぐ。
 * 取れて値が変わったら、プリンターはつなぎ直す。
 */
export const usePrinterAddresses = (): PrinterSettings => {
  const { printerSettings } = usePrinterSettings();
  const [stored] = useState(loadSettings);

  useEffect(() => {
    if (printerSettings) {
      storeSettings(printerSettings);
    }
  }, [printerSettings]);

  return printerSettings ?? stored ?? DEFAULT_PRINTER_SETTINGS;
};
