export type BeanCode =
  | "CHAMP"
  | "ORE"
  | "TNZ"
  | "KEN"
  | "BRA"
  | "ICE"
  | "MILK"
  | "SP";

export interface OrderTicket {
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
  seniorOnly?: boolean; // 上級生のみ（@cafeore/common の cupSeniorOnly）。上級生だけが淹れる
}

// ドリッパーの列（1st〜6th）。担当者（名前・上級生のみのカードを淹れられる上級生か）は CaOS では持たない
export interface Barista {
  id: number;
  bayNumber: number;
  status: "brewing" | "imminent" | "standby" | "ready";
  remainingStr: string; // "01:48 残り"
  pastTickets?: OrderTicket[]; // Past completed tickets in this bay
  queue: OrderTicket[];
}

export interface UnassignedOrder {
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
  seniorOnly?: boolean; // 上級生のみ（@cafeore/common の cupSeniorOnly）
  mergeKey?: string; // 統合できる相手を決めるキー（商品と指名。実データテストも同じ）。同じキーの 1 杯どうしだけ統合できる
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
