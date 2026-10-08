// カードの豆。POS の在庫対象（kind が bean）の ID と名前をそのまま持つ
export interface CardBean {
  id: string;
  name: string;
}

// カード（1 回のドリップ。最大 2 杯）の表示に使う値。未割当のカードも、ドリッパーのカードも同じ形。
// 盤面のカードは live/board.ts が @cafeore/common の CaosCard から作る（実データテストのカードは App.tsx）。
export interface DripCard {
  /** 画面の中でカードを指すキー（盤面のカードは CaosCard の key） */
  ticketUid: string;
  /** 注文番号。統合したカードは元の注文すべて（小さい順）。表示は orderLabel で整える */
  orderNos: number[];
  /** 同じ注文の中のカードの並び（1 始まり）・カードの数・注文の杯数。統合したカードは 1・1・2 */
  itemIndex: number;
  totalItemsInOrder: number;
  totalOrderCups: number;
  /** カードの名前。盤面のカードは商品の略称（abbr）をそのまま */
  beanName: string;
  cupCount: number;
  /** 背景色（#RRGGBB。色の設定の画面 master、無ければ白）。盤面のカードにだけ付く */
  color?: string;
  /** 豆。商品の在庫の使用量（item_stock_usages）から引いた在庫対象（盤面のカードにだけ付く） */
  beans?: CardBean[];
  /** 区分。商品の種類の表示名（display_name）をそのまま（盤面のカードにだけ付く） */
  typeName?: string;
  /** 指名のドリッパー（1〜6。盤面のカードは注文の明細の dripper）。このドリッパーにだけ置ける */
  preferredBaristaId?: number;
  /**
   * 統合できる相手を決めるキー。同じキーの 1 杯どうしだけ統合できる。
   * 盤面のカードは商品と指名の番号（@cafeore/common の caosMergeKey）、実データテストのカードはまとめ方
   */
  mergeKey: string;
}

// 未割当のカード
export type UnassignedOrder = DripCard;

// ドリッパーのカード（抽出中・待機・終わり）
export interface OrderTicket extends DripCard {
  status: "brewing" | "scheduled" | "completed";
  /** 抽出中のカードの残り（秒） */
  timeRemainingSec?: number;
  totalDurationSec: number;
  /** 抽出の開始・終了（盤面の秒。その日の 0:00 からの秒）。終わったカードの終了は終えた時刻 */
  startTimeSec?: number;
  endTimeSec?: number;
}

// ドリッパーの列（1st〜6th）。担当者（名前・限定を淹れられる上級生か）は CaOS では持たない
export interface Barista {
  id: number;
  bayNumber: number;
  /** 終わったカード */
  pastTickets?: OrderTicket[];
  /** 抽出中（先頭）と待機のカード */
  queue: OrderTicket[];
}

interface HistoricalItem {
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

export interface TestPlaySession {
  status: "active" | "finished";
  startMs: number;
  endMs: number;
  currentMs: number;
  durationMinutes: 30 | 60;
  orders: HistoricalOrder[];
}
