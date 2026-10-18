/** 金額を「¥1,200」「−¥100」の形で出す */
export const formatYen = (amount: number): string =>
  `${amount < 0 ? "−" : ""}¥${Math.abs(amount).toLocaleString("ja-JP")}`;
