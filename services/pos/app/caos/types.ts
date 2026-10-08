// カードの豆。POS の在庫対象（kind が bean）の ID と名前をそのまま持つ
export interface CardBean {
  id: string;
  name: string;
}

// カード（1 回のドリップ。最大 2 杯）。未割当のカードも、ドリッパーのカードも同じ形。
// cafeore-pos の注文から組み立てる（logic/posOrders.ts）。実データテストのカードは logic/historical.ts。
export interface DripCard {
  /** 画面の中でカードを指すキー */
  ticketUid: string;
  /** 注文番号。統合したカードは元の注文すべて（小さい順）。表示は orderLabel で整える */
  orderNos: number[];
  /** 同じ注文の中のカードの並び（1 始まり）・カードの数・注文の杯数。統合したカードは 1・1・2 */
  itemIndex: number;
  totalItemsInOrder: number;
  totalOrderCups: number;
  /** カードの名前。cafeore-pos の注文のカードは商品の略称（abbr）をそのまま */
  beanName: string;
  cupCount: number;
  /** 色の設定を引く商品（cafeore-pos の注文のカードにだけ付く） */
  item?: { id?: string; item_type: { id?: string } };
  /** 背景色（#RRGGBB）。item から色の設定（画面 master）を引いて付ける（logic/posOrders.ts の paintBoard） */
  color?: string;
  /** 区分。商品の種類の表示名（display_name）をそのまま（cafeore-pos の注文のカードにだけ付く） */
  typeName?: string;
  /** 豆。item から在庫の設定の「商品 → 豆」を引いて付ける（logic/beans.ts の attachBeans）。設定が無い商品は空 */
  beans?: CardBean[];
  /** 指名のドリッパー（1〜6） */
  preferredBaristaId?: number;
  /** 統合できる相手を決めるキー。同じキーの 1 杯どうしだけ統合できる（注文のカードは商品と指名） */
  mergeKey: string;
  /** 緊急の入れ直し */
  isRebrew?: boolean;
  /** cafeore-pos の注文の ID（UUID）。POS 側で準備完了・提供済み・削除になったら未割当から外す */
  posOrderId?: string;
  /** 統合したカードの元のカード（元の注文の一部だけ取り下げられたら、残りの注文のカードに戻す） */
  mergedFrom?: DripCard[];
}

// ドリッパーのカード（抽出中・待機・終わり）
export interface OrderTicket extends DripCard {
  status: "brewing" | "scheduled" | "completed";
  /** 抽出中のカードの残り（秒） */
  timeRemainingSec?: number;
  totalDurationSec: number;
  /** 抽出の開始・終了（盤面の秒。その日の 0:00 からの秒）。終わったカードの終了は終えた時刻 */
  startTimeSec?: number;
  endTimeSec?: number;
  /** 入れ直しのために途中で止めた */
  isInterrupted?: boolean;
}

// ドリッパーの列（1st〜6th）。担当者（名前・限定を淹れられる上級生か）は CaOS では持たない
export interface Barista {
  /** ドリッパーの番号（1〜6） */
  id: number;
  /** 終わったカード */
  pastTickets: OrderTicket[];
  /** 抽出中（先頭）と待機のカード */
  queue: OrderTicket[];
}

// 盤面（6 列のドリッパーと未割当のカード）
export interface Board {
  baristas: Barista[];
  unassigned: DripCard[];
}

interface HistoricalItem {
  name: string;
  price: number;
  /** 商品の種類の名前（POS の商品の種類の name）。表示名は POS の種類から引く */
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
