export type BeanCode =
  | "CHAMP"
  | "ORE"
  | "TNZ"
  | "KEN"
  | "BRA"
  | "ICE"
  | "MILK"
  | "SP"
  // 盤面のカードで、氷・牛・限定のどれでもない商品（どの豆かは beans で見分ける）
  | "OTHER";

// カードの豆。POS の在庫対象（kind が bean）の ID と名前をそのまま持つ
export interface CardBean {
  id: string;
  name: string;
}

export interface OrderTicket {
  /** マスターの画面と同じ背景色（#RRGGBB）。cafeore-pos の盤面のカードにだけ付く */
  color?: string;
  /** 商品の ID。統合の候補を同じ商品どうしに絞るのに使う（盤面のカードにだけ付く） */
  itemKey?: string;
  /** 豆。商品の在庫の使用量（item_stock_usages）から引いた在庫対象（盤面のカードにだけ付く） */
  beans?: CardBean[];
  id: string; // e.g. "#152"
  ticketUid?: string; // unique identifier for React keys, e.g. "152-1", "152-2"
  itemIndex?: number; // e.g. 1 (of 2 items in order #152)
  totalItemsInOrder?: number; // e.g. 2
  totalOrderCups?: number; // e.g. 3 (total cups in entire order #152)
  orderNotes?: string; // e.g. "チャンプ 2杯 + 俺ブレ 1杯"
  sourceOrderIds?: string[]; // combined drip across separate register orders
  beanCode: BeanCode;
  beanName: string;
  cupCount: number;
  tag?:
    | "HOT"
    | "ICE"
    | "BATCH"
    | "牛"
    | "牛オレ"
    | "氷"
    | "★SP"
    | "定番"
    | "浅煎り"
    | "水洗"
    | string;
  preferredBaristaId?: number; // 指名。必ず1人だけ
  status: "brewing" | "scheduled" | "ready" | "unassigned" | "completed";
  timeRemainingSec?: number; // for brewing
  totalDurationSec: number;
  scheduledTimeStr?: string; // e.g. "2:05"
  startTimeSec?: number; // sim time in seconds when this drip starts
  endTimeSec?: number; // sim time in seconds when this drip ends
  completedAtSec?: number; // for historical completed drip
}

// ドリッパーの列（1st〜6th）。担当者（名前・限定を淹れられる上級生か）は CaOS では持たない
export interface Barista {
  id: number;
  bayNumber: number;
  status: "brewing" | "imminent" | "standby" | "ready";
  remainingStr: string; // "01:48 残り"
  pastTickets?: OrderTicket[]; // Past completed tickets in this bay
  queue: OrderTicket[];
}

export interface UnassignedOrder {
  /** マスターの画面と同じ背景色（#RRGGBB）。cafeore-pos の盤面のカードにだけ付く */
  color?: string;
  /** 商品の ID。統合の候補を同じ商品どうしに絞るのに使う（盤面のカードにだけ付く） */
  itemKey?: string;
  /** 豆。商品の在庫の使用量（item_stock_usages）から引いた在庫対象（盤面のカードにだけ付く） */
  beans?: CardBean[];
  id: string; // e.g. "#162"
  ticketUid?: string; // unique identifier e.g. "162-1", "162-2"
  itemIndex?: number;
  totalItemsInOrder?: number;
  totalOrderCups?: number;
  orderNotes?: string;
  sourceOrderIds?: string[]; // combined drip across separate register orders
  beanCode: BeanCode;
  beanName: string;
  cupCount: number;
  badgeTag: string;
  predictedTimeStr: string;
  recommendedBaristas: string;
  recommendedBayIds: number[];
  preferredBaristaId?: number; // 指名。必ず1人だけ
  cardColor: "blue" | "peach" | "cyan" | "emerald";
}

export interface HistoricalItem {
  name: string;
  price: number;
  type: "hot" | "iceOre" | "ice" | "milk" | "others" | string;
}

export interface HistoricalOrder {
  orderId: number;
  createdAt: string;
  readyAt: string | null;
  servedAt: string | null;
  total: number;
  billingAmount: number;
  items: HistoricalItem[];
}

export interface HistoricalDataset {
  source: string;
  orders: HistoricalOrder[];
}

export interface TestPlaySession {
  status: "active" | "finished";
  startMs: number;
  endMs: number;
  currentMs: number;
  durationMinutes: 30 | 60;
  orders: HistoricalOrder[];
}
