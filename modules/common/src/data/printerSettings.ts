// data/printerSettings.ts
import useSWR from "swr";
import {
  type PrinterSettings,
  printerSettingRepository,
} from "../repositories/printerSetting";

const PRINTER_SETTINGS_KEY = "printer-settings";

/** 一度も保存していないときの設定。サーバーの既定値（models.DefaultPrinterSetting）とそろえる */
export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  label_printer_ip: "192.168.77.2",
  receipt_printer_ip: "192.168.77.3",
};

/**
 * ラベル用とレシート用のプリンターの IP アドレス（全レジで共通）
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
