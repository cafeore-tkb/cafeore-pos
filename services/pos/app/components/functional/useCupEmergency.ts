import {
  type CaosOrderInput,
  type OrderEntity,
  type WithId,
  addCupEmergencies,
  cancelCupEmergency,
  cupNeedsBrew,
  getCupEmergencyReasons,
} from "@cafeore/common";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { eposCertificateUrl, eposPrinterAt } from "~/label/infra/epos";
import { LABEL_WIDTHS } from "~/label/paper";
import { cancelPendingPrint } from "~/label/pending-prints";
import { usePrinter } from "~/label/print-util";
import { usePrinterAddresses } from "./usePrinterAddresses";

/** 入れ直すカップ（注文と、その中のカップの ID）。刷るときは POS の注文（OrderEntity） */
export type EmergencyCup<O extends CaosOrderInput = WithId<OrderEntity>> = {
  order: O;
  cupId: string;
};

/** 入れ直しを足した・取り消したことを通知で出す（実データテストの練習の盤面でも同じ文） */
export const toastEmergenciesAdded = (count: number) =>
  toast(`入れ直しを ${count} 杯足しました`);
export const toastEmergenciesCancelled = (count: number) =>
  toast(`入れ直しを ${count} 杯取り消しました`);

/**
 * 緊急（入れ直し）。マスターの緊急ボタンと CaOS の入れ直しのパネルで使う。
 * カップに入れ直しを足し（POST /api/cup-emergencies）、足せたら、そのカップのシール（レジで刷るのと同じもの）を 1 枚ずつ
 * この端末から印刷の設定のシールのプリンター（label_printer_ip）に刷る。刷れなければ端末に残して送り直す（usePrinter）。
 * 取り消す（DELETE /api/cup-emergencies/{id}）と、この端末に残っているそのシールも消す（ほかの端末のものは、取り消しの知らせで消える。OrdersWSProvider）。
 */
export const useCupEmergency = (
  onActivity?: (event: string, details: Record<string, unknown>) => void,
) => {
  const { label_printer_ip, label_printer_paper_width } = usePrinterAddresses();
  const printer = usePrinter(
    useMemo(() => eposPrinterAt(label_printer_ip), [label_printer_ip]),
    LABEL_WIDTHS[label_printer_paper_width],
    onActivity,
  );
  const { printCupLabel } = printer;

  /** 入れ直しを足し、足せたらカップのシールを 1 枚ずつ刷る。足した入れ直しの id を返す（cups と同じ順）。断られたら理由を通知で出して null */
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
      cups.forEach(({ order, cupId }, i) => {
        void printCupLabel(order, cupId, result.data.ids[i]);
      });
      toastEmergenciesAdded(cups.length);
      return result.data.ids;
    },
    [printCupLabel, onActivity],
  );

  /** 入れ直しを取り消す（まだ抽出を始めていないものだけ。断られたら理由を通知で出す）。全部取り消せたら true */
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
    /** この端末のシールのプリンターと、つながらないときに証明書を許可するページ */
    printer: {
      ...printer,
      certificateUrl: eposCertificateUrl(label_printer_ip),
    },
    addEmergency,
    cancelEmergency,
  };
};

/** 注文の抽出が要るカップ（表示の値つき。緊急で入れ直せるカップ）。指名は明細のもの */
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

// 理由の候補（前の日までも含めてよく使う順。GET /api/cup-emergencies/reasons）。取れなければ前に取れたもののまま
const fetchReasons = async () => {
  const result = await getCupEmergencyReasons();
  if (result.error !== undefined) throw new Error(result.error);
  return result.data;
};

/**
 * 緊急の入力：注文番号・入れ直すカップ・理由。initial はカップやカードから開いたときの注文番号とカップ。
 * 入れ直せるのは番号の注文の抽出が要るカップと、initial のカップのあるほかの注文（注文をまたいで統合したカード）の抽出が要るカップ。
 * 番号を変えると、ほかの注文は外し、その注文の抽出が要るカップが 1 杯ならそれを選び、ほかは選び直す。理由の候補は開くたびに読み直す。
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
  const { data: reasons = [] } = useSWR("cup-emergency-reasons", fetchReasons);
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
    /** 入れ直せるカップ（注文つき。番号の注文のカップが先） */
    cups,
    /** ほかの注文のカップも入れ直せるか（カップに注文番号を添える） */
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
    reasons,
    /** 入れ直すカップ（addEmergency に渡す。理由は reason） */
    selected: cups
      .filter((cup) => picked.includes(cup.cupId))
      .map((cup): EmergencyCup<O> => ({ order: cup.order, cupId: cup.cupId })),
  };
};
