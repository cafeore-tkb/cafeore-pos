// data/printerSettings.ts
import useSWR from "swr";
import {
  DEFAULT_LABEL_PRINTER_PAPER_TYPE,
  DEFAULT_LABEL_PRINTER_PAPER_WIDTH,
  DEFAULT_RECEIPT_PRINTER_MODEL,
  DEFAULT_RECEIPT_PRINTER_PAPER_TYPE,
  DEFAULT_RECEIPT_PRINTER_PAPER_WIDTH,
  type PrinterSettings,
  printerSettingRepository,
} from "../repositories/printerSetting";

const PRINTER_SETTINGS_KEY = "printer-settings";

/** 一度も保存していないときの設定。サーバーの既定値（models.DefaultPrinterSetting）とそろえる */
export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  label_printer_ip: "192.168.77.2",
  receipt_printer_ip: "192.168.77.3",
  receipt_printer_model: DEFAULT_RECEIPT_PRINTER_MODEL,
  label_printer_paper_width: DEFAULT_LABEL_PRINTER_PAPER_WIDTH,
  receipt_printer_paper_width: DEFAULT_RECEIPT_PRINTER_PAPER_WIDTH,
  label_printer_paper_type: DEFAULT_LABEL_PRINTER_PAPER_TYPE,
  receipt_printer_paper_type: DEFAULT_RECEIPT_PRINTER_PAPER_TYPE,
};

/**
 * ラベル用とレシート用のプリンターの IP アドレスと用紙（幅と種類）、レシート用のプリンターの機種（全レジで共通）
 *
 * 取れるまで（と取れなかったとき）は undefined。
 */
export const usePrinterSettings = () => {
  const { data, error, isLoading, mutate } = useSWR(
    PRINTER_SETTINGS_KEY,
    printerSettingRepository.get,
  );

  return {
    printerSettings: data,
    error,
    isLoading,
    mutatePrinterSettings: mutate,
  };
};
