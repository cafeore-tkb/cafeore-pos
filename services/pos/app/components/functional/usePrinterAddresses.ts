import {
  DEFAULT_PRINTER_SETTINGS,
  type PrinterSettings,
  usePrinterSettings,
} from "@cafeore/common";
import { useEffect, useState } from "react";

/** 最後に取れたプリンター設定を覚えておくキー */
const STORAGE_KEY = "cafeore:printer-settings";

const loadSettings = (): PrinterSettings | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "label_printer_ip" in parsed &&
      "receipt_printer_ip" in parsed &&
      typeof parsed.label_printer_ip === "string" &&
      typeof parsed.receipt_printer_ip === "string"
    ) {
      return {
        label_printer_ip: parsed.label_printer_ip,
        receipt_printer_ip: parsed.receipt_printer_ip,
      };
    }
    return null;
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
 * レジがつなぐプリンターの IP アドレス
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
