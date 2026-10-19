import { type OrderEntity, jstClock, jstDate } from "@cafeore/common";

export const squarePaymentLabel = (type: string) => {
  if (type === "CARD_PRESENT") return "カード";
  if (type === "QR_CODE") return "QRコード";
  if (type === "unknown") return "決済種別の記録なし";
  return "その他のSquare決済";
};

export function dashboardFinance(
  selectedOrders: readonly OrderEntity[],
  cutoff: number,
  now: number,
  selectedDate: string,
) {
  const valid = selectedOrders.filter(
    (o) => o.cancelledAt == null || o.cancelledAt.getTime() >= cutoff,
  );
  let cash = 0;
  let square = 0;
  let unclassified = 0;
  let lumpSum = 0;
  const byType = new Map<string, number>();
  const addSquare = (amount: number, type = "unknown") => {
    square += amount;
    byType.set(type, (byType.get(type) ?? 0) + amount);
  };
  for (const order of valid) {
    if (order.payments.length) {
      for (const p of order.payments) {
        if (p.method === "square") addSquare(p.amount, p.squarePaymentType);
        else cash += p.amount;
      }
    } else if (order.paymentMethod) {
      // 一括会計には payments がない。保存された方法と請求額で内訳を補う。
      lumpSum += order.billingAmount;
      if (order.paymentMethod === "square") addSquare(order.billingAmount);
      else cash += order.billingAmount;
    } else {
      // 未記録を現金支払いと決めつけない。
      unclassified += order.billingAmount;
    }
  }
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    revenue: 0,
    orders: 0,
  }));
  for (const order of valid) {
    const hour = Number(jstClock(order.createdAt.getTime()).slice(0, 2));
    hourly[hour].revenue += order.billingAmount;
    hourly[hour].orders++;
  }
  const billing = valid.reduce((n, o) => n + o.billingAmount, 0);
  const paymentTotal = cash + square;
  const peak =
    [...hourly]
      .filter((h) => h.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)[0] ?? null;
  return {
    cash,
    square,
    unclassified,
    lumpSum,
    paymentTotal,
    billing,
    difference: billing - paymentTotal,
    squareDetails: [...byType]
      .map(([type, amount]) => ({
        type,
        amount,
        label: squarePaymentLabel(type),
      }))
      .sort((a, b) => b.amount - a.amount),
    discount: valid.reduce((n, o) => n + o.discount, 0),
    cancelled: selectedOrders.length - valid.length,
    average: valid.length ? Math.round(billing / valid.length) : 0,
    hourly: hourly.slice(
      0,
      selectedDate === jstDate(now)
        ? Number(jstClock(now).slice(0, 2)) + 1
        : 24,
    ),
    peak,
  };
}
