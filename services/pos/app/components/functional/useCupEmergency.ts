import {
  type OrderEntity,
  addCupEmergencies,
  cancelCupEmergency,
  cupNeedsBrew,
  frequentEmergencyReasons,
} from "@cafeore/common";
import { useCallback, useMemo, useState } from "react";
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
    async (cups: EmergencyCup[], reason: string) => {
      const result = await addCupEmergencies(
        cups.map((cup) => cup.cupId),
        reason,
      );
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

/** 注文の抽出が要るカップ（表示の値つき。緊急で入れ直せるカップ） */
const brewCupsOf = (order: OrderEntity) => {
  const ids = new Set(order.cups.filter(cupNeedsBrew).map((cup) => cup.id));
  return order
    .getCups()
    .flatMap(({ cupId, ...cup }) =>
      cupId && ids.has(cupId) ? [{ ...cup, cupId }] : [],
    );
};

/** 注文番号の注文（同じ番号が複数あれば新しいもの） */
const orderByNo = (orders: readonly OrderEntity[], orderNo: string) =>
  orders
    .filter((order) => String(order.orderId) === orderNo.trim())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

/**
 * 緊急の入力：注文番号・入れ直すカップ・理由。initial はカップやカードから開いたときの注文番号とカップ。
 * 番号を変えると、その注文の抽出が要るカップが 1 杯ならそれを選び、ほかは選び直す。理由の候補はよく使う順（frequentEmergencyReasons）
 */
export const useEmergencyDraft = (
  orders: readonly OrderEntity[],
  initial?: { orderNo: number; cupIds: string[] },
) => {
  const [orderNo, setOrderNo] = useState(
    initial ? String(initial.orderNo) : "",
  );
  const [picked, setPicked] = useState(initial?.cupIds ?? []);
  const [reason, setReason] = useState("");
  const order = orderByNo(orders, orderNo);
  const cups = order ? brewCupsOf(order) : [];
  const reasons = useMemo(() => frequentEmergencyReasons(orders), [orders]);
  return {
    orderNo,
    changeOrderNo: (value: string) => {
      setOrderNo(value);
      const next = orderByNo(orders, value);
      const nextCups = next ? brewCupsOf(next) : [];
      setPicked(nextCups.length === 1 ? [nextCups[0].cupId] : []);
    },
    /** 番号の注文（無ければ undefined） */
    order,
    cups,
    picked,
    toggle: (cupId: string) =>
      setPicked((ids) =>
        ids.includes(cupId)
          ? ids.filter((id) => id !== cupId)
          : [...ids, cupId],
      ),
    reason,
    setReason,
    reasons,
    /** 入れ直すカップ（addEmergency に渡す） */
    selected: order
      ? cups
          .filter((cup) => picked.includes(cup.cupId))
          .map((cup) => ({ order, cupId: cup.cupId }))
      : [],
  };
};

export type EmergencyDraft = ReturnType<typeof useEmergencyDraft>;
