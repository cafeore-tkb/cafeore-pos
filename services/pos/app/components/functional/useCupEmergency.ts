import {
  type OrderEntity,
  addCupEmergencies,
  cancelCupEmergency,
} from "@cafeore/common";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { eposPrinterAt } from "~/label/infra/epos";
import { removePendingPrint } from "~/label/pending-prints";
import { usePrinter } from "~/label/print-util";
import { usePrinterAddresses } from "./usePrinterAddresses";

/** 入れ直すカップ（注文と、その中のカップの ID） */
export type EmergencyCup = { order: OrderEntity; cupId: string };

/**
 * 緊急（入れ直し）。マスターの緊急ボタンと CaOS の入れ直しのパネルで使う。
 * カップに入れ直しを足し（POST /api/cup-emergencies）、足せたら、そのカップのシール（レジで刷るのと同じもの）を 1 枚ずつ
 * この端末から印刷の設定のシールのプリンター（label_printer_ip）に刷る。刷れなければ端末に残して送り直す（usePrinter）。
 * 取り消す（DELETE /api/cup-emergencies/{id}）と、この端末に残っているそのシールも消す。
 */
export const useCupEmergency = () => {
  const { label_printer_ip } = usePrinterAddresses();
  const printer = usePrinter(
    useMemo(() => eposPrinterAt(label_printer_ip), [label_printer_ip]),
  );
  const { printCupLabel } = printer;

  /** 足せたら true。断られたら理由を通知で出す */
  const addEmergency = useCallback(
    async (cups: EmergencyCup[]) => {
      const result = await addCupEmergencies(cups.map((cup) => cup.cupId));
      if (result.error !== undefined) {
        toast.error(result.error);
        return false;
      }
      toast(`入れ直しを ${cups.length} 杯足しました`);
      cups.forEach(({ order, cupId }, i) => {
        void printCupLabel(order, cupId, result.data.ids[i]);
      });
      return true;
    },
    [printCupLabel],
  );

  /** 入れ直しを取り消す（まだ抽出を始めていないものだけ。断られたら理由を通知で出す） */
  const cancelEmergency = useCallback(async (ids: string[]) => {
    for (const id of ids) {
      const { error } = await cancelCupEmergency(id);
      if (error !== undefined) {
        toast.error(error);
        return;
      }
      removePendingPrint(id);
    }
    toast(`入れ直しを ${ids.length} 杯取り消しました`);
  }, []);

  return { printer, addEmergency, cancelEmergency };
};
