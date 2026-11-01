import {
  type CaosOrderInput,
  type OrderEntity,
  type WithId,
  addCupEmergencies,
  cancelCupEmergency,
  cupNeedsBrew,
  requestLabelPrint,
} from "@cafeore/common";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { eposCertificateUrl, labelPrinterAt } from "~/label/infra/epos";
import { labelGeometry } from "~/label/paper";
import { cancelPendingPrint } from "~/label/pending-prints";
import { useLabelPrintQueue } from "~/label/print-relay";
import { usePrinter } from "~/label/print-util";
import { usePrinterAddresses } from "./usePrinterAddresses";

/** 淹れ直すカップ（注文と、その中のカップの ID）。刷るときは POS の注文（OrderEntity） */
export type EmergencyCup<O extends CaosOrderInput = WithId<OrderEntity>> = {
  order: O;
  cupId: string;
};

/** 淹れ直しを足した・取り消したことを通知で出す（実データテストの練習の盤面でも同じ文） */
export const toastEmergenciesAdded = (count: number) =>
  toast(`淹れ直しを ${count} 杯足しました`);
export const toastEmergenciesCancelled = (count: number) =>
  toast(`淹れ直しを ${count} 杯取り消しました`);

/**
 * 緊急（淹れ直し）。マスターの緊急ボタンと CaOS の淹れ直しのパネルで使う。
 * カップに淹れ直しを足し（POST /api/cup-emergencies）、足せたら、そのカップのシール（レジで刷るのと同じもの）を 1 枚ずつ、
 * 一度に足した分まとめて緊急のシール（ここから・ここまで）で挟んで、この端末から印刷の設定のシールのプリンター（label_printer_ip）に刷る。直接刷れなければ、すぐ代理印刷をオンにしたレジに頼む
 * （POST /api/label-print-requests。label/print-relay）。頼めなければ端末に残し、送り直すたびにもう一度試す（usePrinter）。
 * 取り消す（DELETE /api/cup-emergencies/{id}）と、この端末に残っているそのシールも消す（ほかの端末のものは、取り消しの知らせで消える。OrdersWSProvider）。
 * レジに頼んだものはサーバーが消す（代理印刷のレジは、取り消しの知らせで刷るのをやめる）。
 */
export const useCupEmergency = (
  onActivity?: (event: string, details: Record<string, unknown>) => void,
) => {
  const printerSettings = usePrinterAddresses();
  const {
    label_printer_ip,
    label_printer_paper_type,
    label_printer_trailing_feed,
  } = printerSettings;
  const printer = usePrinter(
    useMemo(
      () =>
        labelPrinterAt(
          label_printer_ip,
          label_printer_paper_type,
          label_printer_trailing_feed,
        ),
      [label_printer_ip, label_printer_paper_type, label_printer_trailing_feed],
    ),
    labelGeometry(printerSettings),
    onActivity,
    requestLabelPrint,
  );
  const { printEmergencyLabels } = printer;
  // レジに頼んで、まだ刷れていないシール（ほかの端末が頼んだものも）
  const { requests: relayed, relayAvailable } = useLabelPrintQueue();

  /** 淹れ直しを足し、足せたらカップのシールを緊急のシールで挟んで刷る。足した淹れ直しの id を返す（cups と同じ順）。断られたら理由を通知で出して null */
  const addEmergency = useCallback(
    async (cups: EmergencyCup[], reason: string) => {
      onActivity?.("emergency.api.requested", {
        cupIds: cups.map((cup) => cup.cupId),
        reason,
      });
      const result = await addCupEmergencies(
        cups.map((cup) => cup.cupId),
        reason,
      );
      if (result.error !== undefined) {
        onActivity?.("emergency.api.rejected", { error: result.error });
        toast.error(result.error);
        return null;
      }
      onActivity?.("emergency.api.succeeded", { unitIds: result.data.ids });
      void printEmergencyLabels(
        cups.map(({ order, cupId }, i) => ({
          order,
          cupId,
          emergencyId: result.data.ids[i],
        })),
      );
      toastEmergenciesAdded(cups.length);
      return result.data.ids;
    },
    [printEmergencyLabels, onActivity],
  );

  /** 淹れ直しを取り消す（まだ抽出を始めていないものだけ。断られたら理由を通知で出す）。全部取り消せたら true */
  const cancelEmergency = useCallback(async (ids: string[]) => {
    for (const [done, id] of ids.entries()) {
      const { error } = await cancelCupEmergency(id);
      if (error !== undefined) {
        toast.error(
          done > 0 ? `${error}（${done} 杯は取り消しました）` : error,
        );
        return false;
      }
      cancelPendingPrint(id);
    }
    toastEmergenciesCancelled(ids.length);
    return true;
  }, []);

  return {
    /** この端末のシールのプリンターと、つながらないときに証明書を許可するページ、レジで印刷待ちのシールの数 */
    printer: {
      ...printer,
      certificateUrl: eposCertificateUrl(label_printer_ip),
      relayedCount: relayed.length,
      relayAvailable,
    },
    addEmergency,
    cancelEmergency,
  };
};

/** 注文の抽出が要るカップ（表示の値つき。緊急で淹れ直せるカップ）。指名は明細のもの */
const brewCupsOf = <O extends CaosOrderInput>(order: O) =>
  order.cups.filter(cupNeedsBrew).map((cup) => {
    const menu = order.menus.find((m) => m.orderMenuId === cup.orderMenuId);
    return {
      order,
      cupId: cup.id,
      abbr: cup.item.abbr,
      name: cup.item.name,
      dripper: menu?.dripper ?? null,
      assignee: menu?.assignee ?? null,
    };
  });

/** 注文番号（入れた文字。数で比べるので「012」でもよい）の注文。同じ番号が複数あれば新しいもの */
export const orderByNo = <O extends CaosOrderInput>(
  orders: readonly O[],
  orderNo: string,
) => {
  const no = /^\d+$/.test(orderNo.trim()) ? Number(orderNo) : Number.NaN;
  return orders
    .filter((order) => order.orderId === no)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
};

/** 緊急の入力を開いたときの値（カップやカードから開けば、その注文番号とカップ） */
export type EmergencyInitial = { orderNo: number; cupIds: string[] };

/**
 * 緊急の入力：注文番号・淹れ直すカップ・理由。initial はカップやカードから開いたときの注文番号とカップ。
 * 淹れ直せるのは番号の注文の抽出が要るカップと、initial のカップのあるほかの注文（注文をまたいで統合したカード）の抽出が要るカップ。
 * 番号を変えると、ほかの注文は外し、その注文の抽出が要るカップが 1 杯ならそれを選び、ほかは選び直す。
 * 注文は POS の注文（OrderEntity）か、実データテストの練習の盤面の注文
 */
export const useEmergencyDraft = <O extends CaosOrderInput>(
  orders: readonly O[],
  initial?: EmergencyInitial,
) => {
  const [orderNo, setOrderNo] = useState(
    initial ? String(initial.orderNo) : "",
  );
  const [picked, setPicked] = useState(initial?.cupIds ?? []);
  // ほかの注文を探すカップ（番号を変えたら空）
  const [withCups, setWithCups] = useState(initial?.cupIds ?? []);
  const [reason, setReason] = useState("");
  const order = orderByNo(orders, orderNo);
  const scope = order
    ? [
        order,
        ...orders.filter(
          (other) =>
            other !== order &&
            other.cups.some((cup) => withCups.includes(cup.id)),
        ),
      ]
    : [];
  const cups = scope.flatMap(brewCupsOf);
  return {
    orderNo,
    changeOrderNo: (value: string) => {
      setOrderNo(value);
      setWithCups([]);
      const next = orderByNo(orders, value);
      const nextCups = next ? brewCupsOf(next) : [];
      setPicked(nextCups.length === 1 ? [nextCups[0].cupId] : []);
    },
    /** 番号の注文（無ければ undefined） */
    order,
    /** 淹れ直せるカップ（注文つき。番号の注文のカップが先） */
    cups,
    /** ほかの注文のカップも淹れ直せるか（カップに注文番号を添える） */
    manyOrders: scope.length > 1,
    picked,
    toggle: (cupId: string) =>
      setPicked((ids) =>
        ids.includes(cupId)
          ? ids.filter((id) => id !== cupId)
          : [...ids, cupId],
      ),
    reason,
    setReason,
    /** 淹れ直すカップ（addEmergency に渡す。理由は reason） */
    selected: cups
      .filter((cup) => picked.includes(cup.cupId))
      .map((cup): EmergencyCup<O> => ({ order: cup.order, cupId: cup.cupId })),
  };
};
