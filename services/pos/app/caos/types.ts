// カードの豆。POS の在庫対象（kind が bean）の ID と名前をそのまま持つ
export interface CardBean {
  id: string;
  name: string;
}

export interface OrderTicket {
  /** マスターの画面の色の設定の背景色（#RRGGBB）。設定の無い商品には付かない */
  color?: string;
  /** 区分。商品の種類の表示名（display_name）をそのまま */
  typeName?: string;
  /** 豆。商品の在庫の使用量（item_stock_usages）から引いた在庫対象（商品の ID で引く） */
  beans?: CardBean[];
  id: string; // e.g. "#152"
  /** カードのキー（@cafeore/common の CaosCard の key）。画面の key と、カードを引くのに使う */
  ticketUid: string;
  itemIndex?: number; // e.g. 1 (of 2 items in order #152)
  totalItemsInOrder?: number; // e.g. 2
  totalOrderCups?: number; // e.g. 3 (total cups in entire order #152)
  orderNotes?: string; // e.g. "チャンプ 2杯 + 俺ブレ 1杯"
  sourceOrderIds?: string[]; // combined drip across separate register orders
  /** カードの名前。商品の略称（abbr）をそのまま（略称の無い実データは商品名） */
  beanName: string;
  cupCount: number;
  preferredBaristaId?: number; // 指名（明細のドリッパーの番号）。必ず1人だけ
  /** 指名の表示（マスターの画面と同じ assignmentDisplay。番号は「2nd」、番号の無い古い明細は自由記述）。指名なしは付かない */
  nominee?: string;
  status: "brewing" | "scheduled" | "ready" | "unassigned" | "completed";
  timeRemainingSec?: number; // for brewing
  totalDurationSec: number;
  startTimeSec?: number; // 抽出の開始（盤面の秒。その日の 0:00 からの秒）
  endTimeSec?: number; // 抽出の終了（盤面の秒）
  completedAtSec?: number; // for historical completed drip
  seniorOnly?: boolean; // 限定（種類の senior_only）。上級生だけが淹れる
  isRebrew?: boolean; // 緊急（入れ直し）のカード
}

// ドリッパーの列（1st〜6th）。担当者（名前・限定を淹れられる上級生か）はここでは持たず、サーバーの担当者から出す（lanes/）
export interface Barista {
  id: number;
  bayNumber: number;
  status: "brewing" | "imminent" | "standby" | "ready";
  pastTickets?: OrderTicket[]; // Past completed tickets in this bay
  queue: OrderTicket[];
}

export interface UnassignedOrder {
  /** マスターの画面の色の設定の背景色（#RRGGBB）。設定の無い商品には付かない */
  color?: string;
  /** 区分。商品の種類の表示名（display_name）をそのまま */
  typeName?: string;
  /** 豆。商品の在庫の使用量（item_stock_usages）から引いた在庫対象（商品の ID で引く） */
  beans?: CardBean[];
  id: string; // e.g. "#162"
  /** カードのキー（@cafeore/common の CaosCard の key） */
  ticketUid: string;
  itemIndex?: number;
  totalItemsInOrder?: number;
  totalOrderCups?: number;
  orderNotes?: string;
  sourceOrderIds?: string[]; // combined drip across separate register orders
  /** カードの名前。商品の略称（abbr）をそのまま（略称の無い実データは商品名） */
  beanName: string;
  cupCount: number;
  badgeTag: string;
  predictedTimeStr: string;
  preferredBaristaId?: number; // 指名（明細のドリッパーの番号）。必ず1人だけ
  /** 指名の表示（マスターの画面と同じ assignmentDisplay。番号は「2nd」、番号の無い古い明細は自由記述）。指名なしは付かない */
  nominee?: string;
  seniorOnly?: boolean; // 限定（種類の senior_only）
  isRebrew?: boolean; // 緊急（入れ直し）のカード。未割当のいちばん上に出る
  /** 統合できる相手を決めるキー（商品と指名）。同じキーの 1 杯どうしだけ統合できる（@cafeore/common の canMergeCards と同じ決まり） */
  mergeKey: string;
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
