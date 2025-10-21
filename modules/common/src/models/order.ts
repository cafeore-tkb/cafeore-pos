import { z } from "zod";
import { ITEM_MASTER } from "../data/items";
import type { WithId } from "../lib/typeguard";
import { ItemEntity, itemSchema } from "./item";

const AUTHORS = ["cashier", "master", "serve", "others"] as const;

export type Author = (typeof AUTHORS)[number];

const commentSchema = z.object({
  author: z.enum(AUTHORS),
  text: z.string(),
  createdAt: z.date(),
});

export const orderSchema = z.object({
  id: z.string().optional(), // Firestore のドキュメント ID
  orderId: z.number(),
  createdAt: z.date(),
  readyAt: z.date().nullable(),
  servedAt: z.date().nullable(),
  items: z.array(itemSchema.required()),
  total: z.number(), // sum of item.price
  comments: z.array(commentSchema),
  billingAmount: z.number(), // total - discount
  received: z.number(), // お預かり金額
  discountOrderId: z.number().nullable(),
  discountOrderCups: z.number(),
  DISCOUNT_PER_CUP: z.number(),
  discount: z.number(), // min(this.getCoffeeCups(), discountOrderCups) * DISCOUNT_PER_CUP
  estimateTime: z.number(), // seconds
});

export type Order = z.infer<typeof orderSchema>;

type Comment = z.infer<typeof commentSchema>;

// 途中から割引額を変更する場合はこの値を変更する
const STATIC_DISCOUNT_PER_CUP = 100;

class CommentEntity implements Comment {
  constructor(
    public readonly author: Author,
    public readonly text: string,
    public readonly createdAt: Date,
  ) {}

  static fromComment(comment: Comment): CommentEntity {
    return new CommentEntity(comment.author, comment.text, comment.createdAt);
  }

  static createNew({
    author,
    text,
  }: Omit<Comment, "createdAt">): CommentEntity {
    return new CommentEntity(author, text, new Date());
  }

  toComment(): Comment {
    return {
      author: this.author,
      text: this.text,
      createdAt: this.createdAt,
    };
  }
}

export class OrderEntity implements Order {
  order: ItemEntity | undefined;
  // 全てのプロパティを private にして外部からの直接アクセスを禁止
  private constructor(
    private readonly _id: string | undefined,
    private _orderId: number,
    private _createdAt: Date,
    private _readyAt: Date | null,
    private _servedAt: Date | null,
    private _items: WithId<ItemEntity>[],
    private _total: number,
    private _comments: CommentEntity[],
    private _billingAmount: number,
    private _received: number,
    private _discountOrderId: number | null,
    private _discountOrderCups: number,
    private readonly _DISCOUNT_PER_CUP: number,
    private _discount: number,
    private _estimateTime: number,
  ) {}

  static createNew({ orderId }: { orderId: number }): OrderEntity {
    return new OrderEntity(
      undefined,
      orderId,
      new Date(),
      null,
      null,
      [],
      0,
      [],
      0,
      0,
      null,
      0,
      STATIC_DISCOUNT_PER_CUP,
      0,
      -1,
    );
  }

  static fromOrder(order: WithId<Order>): WithId<OrderEntity>;
  static fromOrder(order: Order): OrderEntity;
  static fromOrder(
    order: WithId<Order> | Order,
  ): WithId<OrderEntity> | OrderEntity {
    return new OrderEntity(
      order.id,
      order.orderId,
      order.createdAt,
      order.readyAt,
      order.servedAt,
      order.items.map((item) => ItemEntity.fromItem(item)),
      order.total,
      order.comments.map((comment) => CommentEntity.fromComment(comment)),
      order.billingAmount,
      order.received,
      order.discountOrderId,
      order.discountOrderCups,
      order.DISCOUNT_PER_CUP,
      order.discount,
      order.estimateTime,
    );
  }

  // --------------------------------------------------
  // getter / setter
  // --------------------------------------------------

  get id() {
    return this._id;
  }

  get orderId() {
    return this._orderId;
  }
  set orderId(orderId: number) {
    this._orderId = orderId;
  }

  get createdAt() {
    return this._createdAt;
  }

  get readyAt() {
    return this._readyAt;
  }

  get servedAt() {
    return this._servedAt;
  }

  get items() {
    return this._items;
  }
  set items(items: WithId<ItemEntity>[]) {
    this._items = items;
  }

  get total() {
    // items の更新に合わせて total を自動で計算する
    // その代わり total は直接更新できない
    // TODO(toririm): 計算するのは items が変更された時だけでいい
    this._total = this._items.reduce((acc, item) => acc + item.price, 0);
    return this._total;
  }

  get comments() {
    return this._comments;
  }

  get billingAmount() {
    this._billingAmount = this.total - this.discount;
    return this._billingAmount;
  }

  get received() {
    return this._received;
  }
  set received(received: number) {
    this._received = received;
  }

  get discountOrderId() {
    return this._discountOrderId;
  }

  get discountOrderCups() {
    return this._discountOrderCups;
  }

  get DISCOUNT_PER_CUP() {
    return this._DISCOUNT_PER_CUP;
  }

  get discount() {
    this._discount =
      Math.min(this.getCoffeeCups().length, this._discountOrderCups) *
      this._DISCOUNT_PER_CUP;
    return this._discount;
  }

  get estimateTime() {
    return this._estimateTime;
  }
  set estimateTime(estimateTime: number) {
    this._estimateTime = estimateTime;
  }

  // --------------------------------------------------
  // methods
  // --------------------------------------------------

  /**
   * コーヒーの数を取得する
   * @returns 割引の対象となるコーヒーの数
   */
  getCoffeeCups() {
    // milk と others 以外のアイテムを返す
    // TODO(toririm): このメソッドは items が変更された時だけでいい
    return this.items.filter(
      (item) => item.type !== "milk" && item.type !== "others",
    );
  }

  /**
   * ドリッパーを3人以上確保する注文かどうかを判定する
   * 条件：コーヒーが3種以上 または 5杯以上
   * @returns 分割判定の詳細情報
   */
  shouldSplitOrder(): {
    shouldSplit: boolean;
    recommendation?: {
      id: string;
      name: string;
      count: number;
    }[][];
  } {
    const yushoId = ITEM_MASTER["-"].id;
    const toteSetsId = ITEM_MASTER["@"].id;
    
    const coffeeCups = this.getCoffeeCups();
    const toteSets = this.items.filter((item) => item.id === toteSetsId);
    
    // トートセットを縁ブレンドとして扱う
    const totalCoffeeCups = coffeeCups.length + toteSets.length;
    const uniqueCoffeeTypes = new Set(coffeeCups.map(item => item.id));
    if (toteSets.length > 0) uniqueCoffeeTypes.add(yushoId);
    const uniqueCoffeeCount = uniqueCoffeeTypes.size;
    
    const shouldSplit = uniqueCoffeeCount >= 3 || totalCoffeeCups >= 5;
    
    let recommendation;
    if (shouldSplit) {
      recommendation = this.generateSimpleRecommendation();
    }
    
    return {
      shouldSplit,
      recommendation: shouldSplit ? recommendation : undefined,
    };
  }

  getDrinkCups() {
    // others 以外のアイテムを返す
    return this.items.filter((item) => item.type !== "others");
  }

  /**
   * コーヒー注文分割最適化アルゴリズム
   * 
   * 【概要】
   * コーヒー注文を最小の注文数に分割する最適化問題を解決する。
   * ドリッパーの制約条件を満たしながら、効率的な注文分割を実現する。
   * 
   * 【制約条件】
   * 1. 1注文あたり最大4杯まで
   * 2. 1人のドリッパーは2杯まで淹れられる
   * 3. 1人のドリッパーは1種類のコーヒーのみ淹れる
   * 4. 1注文で最大2人のドリッパーを使用可能
   *    - 同じ種類: 2人で最大4杯（例: A×4）
   *    - 違う種類: 各種類2杯ずつまで（例: A×2 + B×2）
   * 5. トートセットを優先的に注文に配置する
   * 
   * 【アルゴリズム】
   * 1. その他アイテム（アイスミルク、コースター等）を種類ごとにまとめて最初の注文に配置
   * 2. その他アイテムの後にコーヒーを4杯まで追加（トートセット優先）
   * 3. 残りのコーヒーを貪欲法で分割：
   *    - トートセットを最優先で配置
   *    - 同じ種類を優先的にまとめる（最大4杯）
   *    - 異なる種類の組み合わせは各2杯ずつまで
   * 
   * 【最適化のポイント】
   * - 同種4杯が最も効率的（1注文で多く処理）
   * - トートセットを最優先で配置
   * - その他アイテムを1つの注文にまとめることで注文数を最小化
   * - 制約条件を満たしながら理論的最小注文数に近づける
   */
  private generateSimpleRecommendation(): {
    id: string;
    name: string;
    count: number;
  }[][] {
    const yushoId = ITEM_MASTER["-"].id;
    const toteSetsId = ITEM_MASTER["@"].id;
    
    const coffeeCups = this.getCoffeeCups();
    const toteSets = this.items.filter((item) => item.id === toteSetsId);
    
    // コーヒーを種類ごとにカウント
    const coffeeCounts = new Map<string, number>();
    coffeeCups.forEach(item => {
      coffeeCounts.set(item.id, (coffeeCounts.get(item.id) || 0) + 1);
    });
    
    const toteSetsCount = toteSets.length;
    const othersItems = this.items.filter(item => 
      (item.type === "others" || item.type === "milk") && item.id !== toteSetsId
    );
    
    const getItemInfo = (id: string) => {
      const item = Object.values(ITEM_MASTER).find(item => item.id === id);
      return { id, name: item?.name || id };
    };
    
    // 仕様書に基づく最適化アルゴリズム
    // 実際のコーヒーアイテムを動的に取得
    const coffeeItems = Object.values(ITEM_MASTER).filter(item => 
      item.type === "hot" || item.type === "ice" || item.type === "iceOre"
    );
    
    // コーヒーアイテムのIDリストを作成
    const coffeeIds = coffeeItems.map(item => item.id);
    
    // アイテム数をマップ形式で管理
    const items: Record<string, number> = {
      tote: toteSetsCount,
      ...Object.fromEntries(coffeeIds.map(id => [id, coffeeCounts.get(id) || 0]))
    };
    
    const orders: { id: string; name: string; count: number; }[][] = [];
    
    // その他アイテムを最初の注文にまとめて追加し、コーヒーも4杯まで追加
    if (othersItems.length > 0) {
      const firstOrder: { id: string; name: string; count: number; }[] = [];
      let totalCups = 0;
      let typeCount = 0;
      
      // その他アイテムを種類ごとにまとめて追加
      const othersCounts = new Map<string, number>();
      othersItems.forEach(item => {
        othersCounts.set(item.id, (othersCounts.get(item.id) || 0) + 1);
      });
      
      othersCounts.forEach((count, id) => {
        firstOrder.push({ ...getItemInfo(id), count });
      });
      
      // その他アイテムの後にコーヒーを4杯まで追加
      // ステップ1: トートを優先的に詰める
      if (items.tote > 0) {
        const addCount = Math.min(4, items.tote);
        firstOrder.push({ ...getItemInfo(toteSetsId), count: addCount });
        items.tote -= addCount;
        totalCups += addCount;
        typeCount = 1;
        
        // トートが4杯未満なら他の種類を1つ追加可能
        if (addCount < 4) {
          for (const coffeeId of coffeeIds) {
            if (items[coffeeId] > 0) {
              const addCount2 = Math.min(2, 4 - totalCups, items[coffeeId]);
              firstOrder.push({ ...getItemInfo(coffeeId), count: addCount2 });
              items[coffeeId] -= addCount2;
              totalCups += addCount2;
              typeCount = 2;
              break;
            }
          }
        }
      }
      // ステップ2: トートがない場合、他のコーヒーを詰める
      else {
        for (const coffeeId of coffeeIds) {
          if (items[coffeeId] > 0) {
            let addCount = Math.min(4, items[coffeeId]);
            
            // 2種類目の追加を検討して、制約に合うように調整
            if (addCount < 4) {
              for (const coffeeId2 of coffeeIds) {
                if (items[coffeeId2] > 0 && coffeeId2 !== coffeeId) {
                  const maxForSecondType = Math.min(2, items[coffeeId2]);
                  const remainingCapacity = 4 - addCount;
                  
                  if (maxForSecondType > 0 && remainingCapacity > 0) {
                    if (addCount > 2) {
                      addCount = 2;
                    }
                    break;
                  }
                }
              }
            }
            
            firstOrder.push({ ...getItemInfo(coffeeId), count: addCount });
            items[coffeeId] -= addCount;
            totalCups += addCount;
            typeCount = 1;
            
            // 4杯未満なら2種類目を追加可能
            if (addCount < 4) {
              for (const coffeeId2 of coffeeIds) {
                if (items[coffeeId2] > 0 && coffeeId2 !== coffeeId) {
                  const maxForSecondType = Math.min(2, items[coffeeId2]);
                  const addCount2 = Math.min(maxForSecondType, 4 - totalCups);
                  
                  if (addCount2 > 0) {
                    firstOrder.push({ ...getItemInfo(coffeeId2), count: addCount2 });
                    items[coffeeId2] -= addCount2;
                    totalCups += addCount2;
                    typeCount = 2;
                    break;
                  }
                }
              }
            }
            break;
          }
        }
      }
      
      orders.push(firstOrder);
    }
    
    // 残りのコーヒー分割ループ（すべてのアイテムが0になるまで）
    while (this.hasRemainingItems(items)) {
      const currentOrder: { id: string; name: string; count: number; }[] = [];
      let totalCups = 0;
      let typeCount = 0;
      
      // ステップ1: トートを優先的に詰める
      if (items.tote > 0) {
        // まずトートだけで4杯まで詰める
        const addCount = Math.min(4, items.tote);
        currentOrder.push({ ...getItemInfo(toteSetsId), count: addCount });
        items.tote -= addCount;
        totalCups += addCount;
        typeCount = 1;
        
        // トートが4杯未満なら他の種類を1つ追加可能
        if (addCount < 4) {
          for (const coffeeId of coffeeIds) {
            if (items[coffeeId] > 0) {
              // 残り容量まで追加（最大2杯）
              const addCount2 = Math.min(2, 4 - totalCups, items[coffeeId]);
              currentOrder.push({ ...getItemInfo(coffeeId), count: addCount2 });
              items[coffeeId] -= addCount2;
              totalCups += addCount2;
              typeCount = 2;
              break; // 1種類のみ追加
            }
          }
        }
      }
      // ステップ2: トートがない場合、他のコーヒーを詰める
      else {
        // 最初の種類を選択
        for (const coffeeId of coffeeIds) {
          if (items[coffeeId] > 0) {
            // 2種類の組み合わせを考慮して最初の種類の数を決定
            let addCount = Math.min(4, items[coffeeId]);
            
            // 2種類目の追加を検討して、制約に合うように調整
            if (addCount < 4) {
              for (const coffeeId2 of coffeeIds) {
                if (items[coffeeId2] > 0 && coffeeId2 !== coffeeId) {
                  // 異なる種類の場合、各2杯ずつまでの制約を適用
                  const maxForSecondType = Math.min(2, items[coffeeId2]);
                  const remainingCapacity = 4 - addCount;
                  
                  if (maxForSecondType > 0 && remainingCapacity > 0) {
                    // 2種類目の追加が可能な場合、最初の種類を2杯に制限
                    if (addCount > 2) {
                      addCount = 2;
                    }
                    break;
                  }
                }
              }
            }
            
            currentOrder.push({ ...getItemInfo(coffeeId), count: addCount });
            items[coffeeId] -= addCount;
            totalCups += addCount;
            typeCount = 1;
            
            // 4杯未満なら2種類目を追加可能（各2杯ずつまで）
            if (addCount < 4) {
              for (const coffeeId2 of coffeeIds) {
                if (items[coffeeId2] > 0 && coffeeId2 !== coffeeId) {
                  // 異なる種類の場合、各2杯ずつまでの制約を適用
                  const maxForSecondType = Math.min(2, items[coffeeId2]);
                  const addCount2 = Math.min(maxForSecondType, 4 - totalCups);
                  
                  if (addCount2 > 0) {
                    currentOrder.push({ ...getItemInfo(coffeeId2), count: addCount2 });
                    items[coffeeId2] -= addCount2;
                    totalCups += addCount2;
                    typeCount = 2;
                    break;
                  }
                }
              }
            }
            break;
          }
        }
      }
      
      // 空の注文は追加しない
      if (currentOrder.length > 0) {
        orders.push(currentOrder);
      }
    }
    
    return orders;
  }
  
  /**
   * 残りのアイテムがあるかチェック
   */
  private hasRemainingItems(items: Record<string, number>): boolean {
    return Object.values(items).some(count => count > 0);
  }

  /**
   * オーダーを準備完了状態に変更する
   */
  beReady() {
    this._readyAt = new Date();
  }

  /**
   * 準備完了状態を取り消す
   */
  undoReady() {
    this._readyAt = null;
  }

  /**
   * コメントを追加する
   * @param author コメントの投稿者
   * @param text コメントの内容
   */
  addComment(author: Author, text: string) {
    if (text === "") {
      return;
    }
    this._comments.push(CommentEntity.createNew({ author, text }));
  }

  /**
   * オーダーを提供済み状態に変更する
   * もし readyAt が null ならば readyAt を現在時刻に設定する
   */
  beServed() {
    const now = new Date();
    this._servedAt = now;
    if (this._readyAt === null) {
      this._readyAt = now;
    }
  }

  /**
   * 提供済み状態を取り消す
   */
  undoServed() {
    // readyAt も同時に更新された場合のみ readyAt を null にする
    if (this._readyAt === this._servedAt) {
      this._readyAt = null;
    }
    this._servedAt = null;
  }

  /**
   * 割引を適用する
   * @param previousOrder 割引の参照となる前回のオーダー
   */
  applyDiscount(previousOrder: OrderEntity) {
    this._discountOrderId = previousOrder.orderId;
    this._discountOrderCups = previousOrder.getCoffeeCups().length;
  }

  /**
   * 割引を解除する
   */
  removeDiscount() {
    this._discountOrderId = null;
    this._discountOrderCups = 0;
  }

  /**
   * オーダーを作成した時刻を更新する
   */
  nowCreated() {
    // createdAt を更新
    this._createdAt = new Date();
  }

  /**
   * お釣りを計算する
   * @returns お釣り
   */
  getCharge() {
    return this.received - this.billingAmount;
  }

  /**
   * メソッドを持たない Order オブジェクトに変換する
   * @returns Order オブジェクト
   */
  toOrder(): Order {
    return {
      id: this.id,
      orderId: this.orderId,
      createdAt: this.createdAt,
      readyAt: this.readyAt,
      servedAt: this.servedAt,
      items: this.items.map((item) => item.toItem()),
      total: this.total,
      comments: this.comments.map((comment) => comment.toComment()),
      billingAmount: this.billingAmount,
      received: this.received,
      discountOrderId: this.discountOrderId,
      discountOrderCups: this.discountOrderCups,
      DISCOUNT_PER_CUP: this.DISCOUNT_PER_CUP,
      discount: this.discount,
      estimateTime: this.estimateTime,
    };
  }

  /**
   * オーダーを複製する
   */
  clone(): WithId<OrderEntity>;
  clone(): OrderEntity;
  clone(): WithId<OrderEntity> | OrderEntity {
    return OrderEntity.fromOrder(this.toOrder());
  }
}
