import type { Barista, BeanCode, UnassignedOrder } from "../types";
import { splitIntoDripUnits } from "./orderQueue";

// cafeore-pos の API（GET /api/orders・WebSocket /api/ws/orders）が返す注文の形。
// CaOS で使うフィールドだけを持つ。
export interface PosOrder {
  id: string;
  order_id: number;
  created_at: string;
  ready_at: string | null;
  served_at: string | null;
  menus: {
    id: string;
    assignee: string | null;
    menu_name: string;
    menu: {
      abbr: string;
      items: {
        quantity: number;
        item: { name: string; abbr: string; item_type: { name: string } };
      }[];
    };
  }[];
}

// POS と同じ API につなぐ（modules/common と同じく VITE_API_BASE_URL、未設定ならローカルの API）。
export const POS_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

export const posOrdersSocketUrl = (baseUrl: string) =>
  `${baseUrl.replace(/\/$/, "").replace(/^http/, "ws")}/api/ws/orders`;

// レジで受けたが、まだ提供準備ができていない注文だけをドリップ対象にする。
export const isPendingPosOrder = (order: PosOrder) =>
  order.ready_at === null && order.served_at === null;

const posBeanCode = (name: string, type: string): BeanCode => {
  if (type === "ice") return "ICE";
  if (type === "iceOre") return "MILK";
  if (name.includes("俺")) return "ORE";
  if (name.includes("優勝") || name.includes("縁")) return "CHAMP";
  if (name.includes("タンザニア") || name.includes("キリマンジャロ"))
    return "TNZ";
  if (name.includes("ケニア")) return "KEN";
  if (name.includes("ブラジル")) return "BRA";
  return "SP";
};

// cafeore-pos の指名は自由記述なので、番号（1〜6）か現在のドリッパー名に一致したときだけ枠を固定する。
const nominatedBayId = (assignee: string, baristas: Barista[]) => {
  const normalized = assignee.trim().normalize("NFKC");
  const bayNumber = Number(normalized);
  if (Number.isInteger(bayNumber) && bayNumber >= 1 && bayNumber <= 6)
    return bayNumber;
  return baristas.find((barista) => barista.name === normalized)?.id;
};

export const posOrderTicketPrefix = (posOrderId: string) =>
  `pos-${posOrderId}-`;

export const posOrderToDripUnits = (
  order: PosOrder,
  baristas: Barista[],
): UnassignedOrder[] => {
  const grouped = new Map<
    string,
    {
      beanCode: BeanCode;
      names: string[];
      count: number;
      preferredBaristaId?: number;
      assignee?: string;
    }
  >();
  order.menus.forEach((line) => {
    const assignee = line.assignee?.trim() || undefined;
    const preferredBaristaId = assignee
      ? nominatedBayId(assignee, baristas)
      : undefined;
    line.menu.items.forEach(({ item, quantity }) => {
      const type = item.item_type.name;
      // アイスミルクとグッズは抽出しないので、ドリップ管制に載せない。
      if (
        type === "others" ||
        type === "milk" ||
        item.name.includes("アイスミルク")
      )
        return;
      const beanCode = posBeanCode(item.name, type);
      const key = `${beanCode}-${assignee ?? ""}`;
      const current = grouped.get(key) || {
        beanCode,
        names: [],
        count: 0,
        preferredBaristaId,
        assignee,
      };
      current.count += quantity;
      if (!current.names.includes(item.abbr)) current.names.push(item.abbr);
      grouped.set(key, current);
    });
  });

  const id = `#${order.order_id.toString().padStart(3, "0")}`;
  const source = Array.from(
    grouped.values(),
    (group, index): UnassignedOrder => {
      const unmatchedAssignee =
        group.assignee && !group.preferredBaristaId
          ? `（指名:${group.assignee}）`
          : "";
      return {
        id,
        ticketUid: `${posOrderTicketPrefix(order.id)}${group.beanCode}-${index}`,
        beanCode: group.beanCode,
        beanName: `${group.names.join("・")}${unmatchedAssignee}`,
        cupCount: group.count,
        badgeTag: `${group.count}杯`,
        predictedTimeStr: group.count > 1 ? "3分15秒" : "2分15秒",
        recommendedBaristas: group.preferredBaristaId
          ? `ドリッパー ${group.preferredBaristaId}`
          : "全ドリッパー",
        recommendedBayIds: group.preferredBaristaId
          ? [group.preferredBaristaId]
          : [1, 2, 3, 4, 5, 6],
        preferredBaristaId: group.preferredBaristaId,
        cardColor:
          group.beanCode === "ICE"
            ? "cyan"
            : group.beanCode === "SP"
              ? "emerald"
              : group.beanCode === "KEN"
                ? "peach"
                : "blue",
      };
    },
  );
  return splitIntoDripUnits(source);
};
