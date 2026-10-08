// カードの豆。POS の在庫対象（kind が bean）の ID と名前をそのまま持つ
export interface CardBean {
  id: string;
  name: string;
}

export interface OrderTicket {
  /** 背景色（#RRGGBB。色の設定の画面 master、無ければ白）。cafeore-pos の盤面のカードにだけ付く */
  color?: string;
  /** 商品を見分けるキー。盤面のカードは商品の ID（実データテストのカードは商品の情報が無いので、その中だけのキー） */
  itemKey: string;
  /** 豆。商品の在庫の使用量（item_stock_usages）から引いた在庫対象（盤面のカードにだけ付く） */
  beans?: CardBean[];
  /** 区分。商品の種類の表示名（display_name）をそのまま（盤面のカードにだけ付く） */
  typeName?: string;
  id: string; // e.g. "#152"
  ticketUid?: string; // unique identifier for React keys, e.g. "152-1", "152-2"
  itemIndex?: number; // e.g. 1 (of 2 items in order #152)
  totalItemsInOrder?: number; // e.g. 2
  totalOrderCups?: number; // e.g. 3 (total cups in entire order #152)
  orderNotes?: string; // e.g. "チャンプ 2杯 + 俺ブレ 1杯"
  sourceOrderIds?: string[]; // combined drip across separate register orders
  /** カードの名前。盤面のカードは商品の略称（abbr）をそのまま */
  beanName: string;
  cupCount: number;
  preferredBaristaId?: number; // 指名。必ず1人だけ
  status: "brewing" | "scheduled" | "ready" | "unassigned" | "completed";
  timeRemainingSec?: number; // for brewing
  totalDurationSec: number;
  scheduledTimeStr?: string; // e.g. "2:05"
  startTimeSec?: number; // 抽出の開始（盤面の秒。その日の 0:00 からの秒）
  endTimeSec?: number; // 抽出の終了（盤面の秒）
  completedAtSec?: number; // for historical completed drip
  seniorOnly?: boolean; // 限定（種類の senior_only）。上級生だけが淹れる
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
  /** 背景色（#RRGGBB。色の設定の画面 master、無ければ白）。cafeore-pos の盤面のカードにだけ付く */
  color?: string;
  /** 商品を見分けるキー。盤面のカードは商品の ID（実データテストのカードは商品の情報が無いので、その中だけのキー） */
  itemKey: string;
  /** 豆。商品の在庫の使用量（item_stock_usages）から引いた在庫対象（盤面のカードにだけ付く） */
  beans?: CardBean[];
  /** 区分。商品の種類の表示名（display_name）をそのまま（盤面のカードにだけ付く） */
  typeName?: string;
  id: string; // e.g. "#162"
  ticketUid?: string; // unique identifier e.g. "162-1", "162-2"
  itemIndex?: number;
  totalItemsInOrder?: number;
  totalOrderCups?: number;
  orderNotes?: string;
  sourceOrderIds?: string[]; // combined drip across separate register orders
  /** カードの名前。盤面のカードは商品の略称（abbr）をそのまま */
  beanName: string;
  cupCount: number;
  badgeTag: string;
  predictedTimeStr: string;
  recommendedBaristas: string;
  recommendedBayIds: number[];
  preferredBaristaId?: number; // 指名。必ず1人だけ
  seniorOnly?: boolean; // 限定（種類の senior_only）
  mergeKey?: string; // 統合できる相手を決めるキー（注文のカードは商品と指名、実データテストは豆）。同じキーの 1 杯どうしだけ統合できる
}

export interface HistoricalItem {
  name: string;
  price: number;
  /** 商品の種類の名前（POS の商品の種類の name）。表示名・判定は POS の種類から引く */
  type: string;
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
