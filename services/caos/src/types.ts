export type BeanCode =
  | "CHAMP"
  | "ORE"
  | "TNZ"
  | "KEN"
  | "BRA"
  | "ICE"
  | "MILK"
  | "SP";

export interface BeanConfig {
  code: BeanCode;
  label: string;
  subLabel: string;
  badgeBg: string;
  badgeText: string;
  borderColor: string;
  accentColor: string;
}

export interface BeanItem {
  code: BeanCode;
  name: string;
  roastProfile: string;
  roastDate: string;
  flavorNotes: string;
  origin: string;
  stockGrams: number;
}

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
  secondaryTag?: string;
  preferredBaristaId?: number; // 指名。必ず1人だけ
  status: "brewing" | "scheduled" | "ready" | "unassigned" | "completed";
  timeRemainingSec?: number; // for brewing
  totalDurationSec: number;
  scheduledTimeStr?: string; // e.g. "2:05"
  startTimeSec?: number; // sim time in seconds when this drip starts
  endTimeSec?: number; // sim time in seconds when this drip ends
  completedAtSec?: number; // for historical completed drip
  isRebrew?: boolean; // emergency remake linked to an original cup
  rebrewOfTicketUid?: string;
  isInterrupted?: boolean; // original drip stopped because a remake was required
  imminent?: boolean; // e.g. "残 0:07" or "まもなく完了"
  recipe?: {
    grindSize: string;
    waterTemp: string;
    ratio: string;
    targetYield: string;
    pourSteps: { step: string; amount: string; time: string }[];
  };
}

export interface Barista {
  id: number;
  bayNumber: number;
  name: string;
  canHandleSpecial?: boolean;
  coefficient: number; // initial: SP-capable 0.97, others 1.05
  coefficientColor: "green" | "orange" | "blue" | "purple";
  status: "brewing" | "imminent" | "standby" | "ready";
  remainingStr: string; // "01:48 残り"
  iconType: "cup" | "clock" | "snowflake";
  activeTicketId?: string;
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
  isRebrew?: boolean;
  rebrewOfTicketUid?: string;
  cardColor: "blue" | "peach" | "cyan" | "emerald";
}

export interface LearningEngineLog {
  id: string;
  baristaKey: string; // "A 佐藤", "B 鈴木", "F 渡辺"
  recentActual: string; // "2:04"
  deltaStr: string; // "(-11秒)"
  deltaType: "faster" | "slower" | "neutral";
  coefficient: number;
  coefficientStatus: string; // "係数 0.93 維持" or "最速補正 0.91"
  timestamp: string;
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
