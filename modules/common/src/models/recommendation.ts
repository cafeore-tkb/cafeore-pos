import { ITEM_MASTER } from "../data/items";
import type { WithId } from "../lib/typeguard";
import { ItemEntity } from "./item";

export type RecommendationItem = {
  id: string;
  name: string;
  count: number;
};

export type RecommendationOrder = RecommendationItem[];

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
export class OrderRecommendationGenerator {
  /**
   * 注文分割の推奨案を生成する
   * @param items 注文アイテムの配列
   * @returns 分割推奨案の配列
   */
  static generateSimpleRecommendation(items: WithId<ItemEntity>[]): RecommendationOrder[] {
    const yushoId = ITEM_MASTER["-"].id;
    const toteSetsId = ITEM_MASTER["@"].id;
    
    const coffeeCups = items.filter(
      (item) => item.type !== "milk" && item.type !== "others",
    );
    const toteSets = items.filter((item) => item.id === toteSetsId);
    
    // コーヒーを種類ごとにカウント
    const coffeeCounts = new Map<string, number>();
    coffeeCups.forEach(item => {
      coffeeCounts.set(item.id, (coffeeCounts.get(item.id) || 0) + 1);
    });
    
    const toteSetsCount = toteSets.length;
    const othersItems = items.filter(item => 
      (item.type === "others" || item.type === "milk") && item.id !== toteSetsId
    );
    
    const getItemInfo = (id: string): RecommendationItem => {
      const item = Object.values(ITEM_MASTER).find(item => item.id === id);
      return { id, name: item?.name || id, count: 0 };
    };
    
    // 仕様書に基づく最適化アルゴリズム
    // 実際のコーヒーアイテムを動的に取得
    const coffeeItems = Object.values(ITEM_MASTER).filter(item => 
      item.type === "hot" || item.type === "ice" || item.type === "iceOre"
    );
    
    // コーヒーアイテムのIDリストを作成
    const coffeeIds = coffeeItems.map(item => item.id);
    
    // アイテム数をマップ形式で管理
    const itemsMap: Record<string, number> = {
      tote: toteSetsCount,
      ...Object.fromEntries(coffeeIds.map(id => [id, coffeeCounts.get(id) || 0]))
    };
    
    const orders: RecommendationOrder[] = [];
    
    // その他アイテムを最初の注文にまとめて追加し、コーヒーも4杯まで追加
    if (othersItems.length > 0) {
      const firstOrder: RecommendationOrder = [];
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
      if (itemsMap.tote > 0) {
        const addCount = Math.min(4, itemsMap.tote);
        firstOrder.push({ ...getItemInfo(toteSetsId), count: addCount });
        itemsMap.tote -= addCount;
        totalCups += addCount;
        typeCount = 1;
        
        // トートが4杯未満なら他の種類を1つ追加可能
        if (addCount < 4) {
          for (const coffeeId of coffeeIds) {
            if (itemsMap[coffeeId] > 0) {
              const addCount2 = Math.min(2, 4 - totalCups, itemsMap[coffeeId]);
              firstOrder.push({ ...getItemInfo(coffeeId), count: addCount2 });
              itemsMap[coffeeId] -= addCount2;
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
          if (itemsMap[coffeeId] > 0) {
            let addCount = Math.min(4, itemsMap[coffeeId]);
            
            // 2種類目の追加を検討して、制約に合うように調整
            if (addCount < 4) {
              for (const coffeeId2 of coffeeIds) {
                if (itemsMap[coffeeId2] > 0 && coffeeId2 !== coffeeId) {
                  const maxForSecondType = Math.min(2, itemsMap[coffeeId2]);
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
            itemsMap[coffeeId] -= addCount;
            totalCups += addCount;
            typeCount = 1;
            
            // 4杯未満なら2種類目を追加可能
            if (addCount < 4) {
              for (const coffeeId2 of coffeeIds) {
                if (itemsMap[coffeeId2] > 0 && coffeeId2 !== coffeeId) {
                  const maxForSecondType = Math.min(2, itemsMap[coffeeId2]);
                  const addCount2 = Math.min(maxForSecondType, 4 - totalCups);
                  
                  if (addCount2 > 0) {
                    firstOrder.push({ ...getItemInfo(coffeeId2), count: addCount2 });
                    itemsMap[coffeeId2] -= addCount2;
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
    while (this.hasRemainingItems(itemsMap)) {
      const currentOrder: RecommendationOrder = [];
      let totalCups = 0;
      let typeCount = 0;
      
      // ステップ1: トートを優先的に詰める
      if (itemsMap.tote > 0) {
        // まずトートだけで4杯まで詰める
        const addCount = Math.min(4, itemsMap.tote);
        currentOrder.push({ ...getItemInfo(toteSetsId), count: addCount });
        itemsMap.tote -= addCount;
        totalCups += addCount;
        typeCount = 1;
        
        // トートが4杯未満なら他の種類を1つ追加可能
        if (addCount < 4) {
          for (const coffeeId of coffeeIds) {
            if (itemsMap[coffeeId] > 0) {
              // 残り容量まで追加（最大2杯）
              const addCount2 = Math.min(2, 4 - totalCups, itemsMap[coffeeId]);
              currentOrder.push({ ...getItemInfo(coffeeId), count: addCount2 });
              itemsMap[coffeeId] -= addCount2;
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
          if (itemsMap[coffeeId] > 0) {
            // 2種類の組み合わせを考慮して最初の種類の数を決定
            let addCount = Math.min(4, itemsMap[coffeeId]);
            
            // 2種類目の追加を検討して、制約に合うように調整
            if (addCount < 4) {
              for (const coffeeId2 of coffeeIds) {
                if (itemsMap[coffeeId2] > 0 && coffeeId2 !== coffeeId) {
                  // 異なる種類の場合、各2杯ずつまでの制約を適用
                  const maxForSecondType = Math.min(2, itemsMap[coffeeId2]);
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
            itemsMap[coffeeId] -= addCount;
            totalCups += addCount;
            typeCount = 1;
            
            // 4杯未満なら2種類目を追加可能（各2杯ずつまで）
            if (addCount < 4) {
              for (const coffeeId2 of coffeeIds) {
                if (itemsMap[coffeeId2] > 0 && coffeeId2 !== coffeeId) {
                  // 異なる種類の場合、各2杯ずつまでの制約を適用
                  const maxForSecondType = Math.min(2, itemsMap[coffeeId2]);
                  const addCount2 = Math.min(maxForSecondType, 4 - totalCups);
                  
                  if (addCount2 > 0) {
                    currentOrder.push({ ...getItemInfo(coffeeId2), count: addCount2 });
                    itemsMap[coffeeId2] -= addCount2;
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
  private static hasRemainingItems(items: Record<string, number>): boolean {
    return Object.values(items).some(count => count > 0);
  }
}
