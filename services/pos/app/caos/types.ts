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
  /** 商品の ID（盤面のカードにだけ付く）。あれば名前は API の商品の略称をそのまま出す */
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
  /** マスターの画面と同じ背景色（#RRGGBB）。cafeore-pos の盤面のカードにだけ付く */
  color?: string;
  /** 商品の ID（盤面のカードにだけ付く）。あれば名前は API の商品の略称をそのまま出す */
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
  seniorOnly?: boolean; // 限定（種類の senior_only）
  mergeKey?: string; // 統合できる相手を決めるキー（商品と指名）。同じキーの 1 杯どうしだけ統合できる
  cardColor: "blue" | "peach" | "cyan" | "emerald";
}

// 実データテスト（練習）の実績に出す注文。読み込んだ実データの注文に、練習の結果（提供時間）と品物の種類を足したもの
export interface PracticeSalesOrder {
  orderId: number;
  createdAt: string;
  /** 練習で、抽出の要るカップが全部準備完了になった時刻。まだ・抽出の要るカップが無い注文は null */
  readyAt: string | null;
  billingAmount: number;
  items: PracticeSalesItem[];
}

export interface PracticeSalesItem {
  name: string;
  price: number;
  /** 商品の種類の名前と表示名（DB の今の種類から。決め方は @cafeore/common の practiceItemType） */
  type: string;
  typeLabel: string;
  /** カップを作る品物か（グッズは false。杯数・商品構成に数えない） */
  makesCup: boolean;
}
