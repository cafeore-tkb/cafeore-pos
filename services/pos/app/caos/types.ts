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
  secondaryTag?: string;
  preferredBaristaId?: number; // 指名。必ず1人だけ
  /** 割り当て・移動できる列（指名と、限定のカードは上級生の列だけ）。盤面のカードにだけ付く */
  allowedBayIds?: number[];
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
  queuePos?: number; // cafeore-pos の盤面での待機列の並び順（入れ直しの差し込み位置に使う）
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
  /** 列の担当者の名前（サーバーの盤面の caos_lanes）。担当者がいなければ空 */
  name: string;
  /** 担当者が上級生（限定を淹れられる）か。交代したときの sohosai-shift の名簿の判定（サーバーが持つ） */
  senior: boolean;
  status: "brewing" | "imminent" | "standby" | "ready";
  remainingStr: string; // "01:48 残り"
  activeTicketId?: string;
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
  /** 割り当てられる列（指名と、限定のカードは上級生の列だけ）。盤面のカードにだけ付く */
  allowedBayIds?: number[];
  isRebrew?: boolean;
  rebrewOfTicketUid?: string;
  cardColor: "blue" | "peach" | "cyan" | "emerald";
}

/** 実績（売上・注文→完成）に出す注文。実データテストの練習用の盤面の注文から作る（practice/board.ts） */
export interface SalesOrderItem {
  name: string;
  price: number;
  type: "hot" | "iceOre" | "ice" | "milk" | "others" | string;
}

export interface SalesOrder {
  orderId: number;
  createdAt: string;
  /** 練習の中で準備完了になった時刻。まだなら null */
  readyAt: string | null;
  billingAmount: number;
  items: SalesOrderItem[];
}
