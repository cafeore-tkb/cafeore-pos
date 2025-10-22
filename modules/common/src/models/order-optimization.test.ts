import { OrderEntity } from "./order";
import { ITEM_MASTER } from "../data/items";
import { ItemEntity } from "./item";
import { generateSimpleRecommendation } from "./recommendation";
import { describe, it, expect } from "vitest";

describe("[unit] コーヒー注文分割最適化アルゴリズム", () => {
  // テスト用のヘルパー関数
  const createTestOrder = (items: Array<{ key: string; count: number }>) => {
    const order = OrderEntity.createNew({ orderId: 1 });
    const orderItems = items.flatMap(({ key, count }) => 
      Array(count).fill(null).map(() => ItemEntity.fromItem({ 
        ...ITEM_MASTER[key as keyof typeof ITEM_MASTER], 
        assignee: null 
      }))
    );
    order.items = orderItems;
    return order;
  };

  const getRecommendationSummary = (recommendation: Array<Array<{ id: string; name: string; count: number }>>) => {
    return recommendation.map(order => 
      order.map(item => `${item.name}×${item.count}`).join(" + ")
    );
  };

  describe("ケース1: 基本", () => {
    // 基本的な分割パターンのテスト
    // 縁ブレンド2杯、珈琲・俺ブレンド5杯、ライチ1杯、トートセット3個の組み合わせ
    // 縁ブレンド系(2杯+3杯=5杯)、珈琲・俺ブレンド5杯、ライチ1杯 = 3種類
    // 期待: 3種類以上なので分割が必要
    it("A=2, B=5, C=1, tote=3 の場合、分割が必要", () => {
      const order = createTestOrder([
        { key: "-", count: 2 },  // A: 縁ブレンド
        { key: "^", count: 5 },  // B: 珈琲・俺ブレンド
        { key: "/", count: 1 },  // C: ライチ
        { key: "@", count: 3 },  // tote: トートセット（縁ブレンドとして扱う）
      ]);

      const result = order.shouldSplitOrder();
      expect(result).toBe(true); // 3種類以上なので分割が必要
    });
  });

  describe("ケース2: 同種大量", () => {
    // 同じ種類のコーヒーが大量にある場合のテスト
    // 縁ブレンド7杯の組み合わせ
    // 期待: 1種類で7杯なので分割が必要（5杯以上）
    it("A=7 の場合、分割が必要", () => {
      const order = createTestOrder([
        { key: "-", count: 7 },  // A: 縁ブレンド
      ]);

      const result = order.shouldSplitOrder();
      expect(result).toBe(true); // 1種類で7杯なので分割が必要
    });
  });

  describe("ケース3: トートのみ", () => {
    // トートセットのみの注文のテスト
    // トートセット5個の組み合わせ（縁ブレンドとして扱う）
    // 期待: 1種類で5杯なので分割が必要（5杯以上）
    it("tote=5 の場合、分割が必要", () => {
      const order = createTestOrder([
        { key: "@", count: 5 },  // tote: トートセット（縁ブレンドとして扱う）
      ]);

      const result = order.shouldSplitOrder();
      expect(result).toBe(true); // 1種類で5杯なので分割が必要
    });
  });

  describe("ケース4: 多種類少量", () => {
    // 複数の種類のコーヒーが少量ずつある場合のテスト
    // 6種類のコーヒーが各1杯ずつの組み合わせ
    // 期待: 6種類なので分割が必要（3種類以上）
    it("A=1, B=1, C=1, D=1, E=1, F=1 の場合、分割が必要", () => {
      const order = createTestOrder([
        { key: "-", count: 1 },  // A: 縁ブレンド
        { key: "^", count: 1 },  // B: 珈琲・俺ブレンド
        { key: "/", count: 1 },  // C: ライチ
        { key: "#", count: 1 },  // D: ブルマン
        { key: ";", count: 1 },  // E: キリマンジャロ
        { key: ":", count: 1 },  // F: ピンクブルボン
      ]);

      const result = order.shouldSplitOrder();
      expect(result).toBe(true); // 6種類なので分割が必要
    });
  });

  describe("新しいロジックのテスト", () => {
    // 1種類のコーヒーのテスト
    it("1種類で4杯以下の場合は分割不要", () => {
      const order = createTestOrder([
        { key: "-", count: 4 },  // A: 縁ブレンド
      ]);

      const result = order.shouldSplitOrder();
      expect(result).toBe(false); // 1種類で4杯以下なので分割不要
    });

    it("1種類で5杯以上の場合は分割必要", () => {
      const order = createTestOrder([
        { key: "-", count: 5 },  // A: 縁ブレンド
      ]);

      const result = order.shouldSplitOrder();
      expect(result).toBe(true); // 1種類で5杯以上なので分割必要
    });

    // 2種類のコーヒーのテスト
    it("2種類で各2杯以下の場合は分割不要", () => {
      const order = createTestOrder([
        { key: "-", count: 2 },  // A: 縁ブレンド
        { key: "^", count: 2 },  // B: 珈琲・俺ブレンド
      ]);

      const result = order.shouldSplitOrder();
      expect(result).toBe(false); // 2種類で各2杯以下なので分割不要
    });

    it("2種類で片方が3杯以上の場合は分割必要", () => {
      const order = createTestOrder([
        { key: "-", count: 2 },  // A: 縁ブレンド
        { key: "^", count: 3 },  // B: 珈琲・俺ブレンド
      ]);

      const result = order.shouldSplitOrder();
      expect(result).toBe(true); // 2種類で片方が3杯以上なので分割必要
    });

    // トートセットを含むテスト
    it("トートセット2個と縁ブレンド2個の場合は分割不要", () => {
      const order = createTestOrder([
        { key: "@", count: 2 },  // tote: トートセット（縁ブレンドとして扱う）
        { key: "-", count: 2 },  // A: 縁ブレンド
      ]);

      const result = order.shouldSplitOrder();
      expect(result).toBe(false); // 1種類（縁ブレンド）で4杯なので分割不要
    });

    it("トートセット3個と縁ブレンド2個の場合は分割必要", () => {
      const order = createTestOrder([
        { key: "@", count: 3 },  // tote: トートセット（縁ブレンドとして扱う）
        { key: "-", count: 2 },  // A: 縁ブレンド
      ]);

      const result = order.shouldSplitOrder();
      expect(result).toBe(true); // 1種類（縁ブレンド）で5杯なので分割必要
    });

    it("トートセット2個と珈琲・俺ブレンド2個の場合は分割不要", () => {
      const order = createTestOrder([
        { key: "@", count: 2 },  // tote: トートセット（縁ブレンドとして扱う）
        { key: "^", count: 2 },  // B: 珈琲・俺ブレンド
      ]);

      const result = order.shouldSplitOrder();
      expect(result).toBe(false); // 2種類で各2杯以下なので分割不要
    });

    it("トートセット3個と珈琲・俺ブレンド2個の場合は分割必要", () => {
      const order = createTestOrder([
        { key: "@", count: 3 },  // tote: トートセット（縁ブレンドとして扱う）
        { key: "^", count: 2 },  // B: 珈琲・俺ブレンド
      ]);

      const result = order.shouldSplitOrder();
      expect(result).toBe(true); // 2種類で片方（縁ブレンド）が3杯以上なので分割必要
    });
  });

  describe("制約条件の検証", () => {
    // 1注文あたり最大4杯の制約をテスト
    // 大量のコーヒーを注文した場合、各注文が4杯以下になることを確認
    it("各注文は最大4杯まで", () => {
      const order = createTestOrder([
        { key: "-", count: 10 },  // 大量の縁ブレンド
      ]);

      const result = order.shouldSplitOrder();
      expect(result).toBe(true);
      
      const recommendation = generateSimpleRecommendation(order.items);
      recommendation.forEach(order => {
        const totalCups = order.reduce((sum, item) => sum + item.count, 0);
        expect(totalCups).toBeLessThanOrEqual(4);
      });
    });

    // 1注文あたり最大2種類の制約をテスト
    // 複数種類のコーヒーを注文した場合、各注文が2種類以下になることを確認
    it("各注文は最大2種類まで", () => {
      const order = createTestOrder([
        { key: "-", count: 1 },  // A: 縁ブレンド
        { key: "^", count: 1 },  // B: 珈琲・俺ブレンド
        { key: "/", count: 1 },  // C: ライチ
        { key: "#", count: 1 },  // D: ブルマン
        { key: ";", count: 1 },  // E: キリマンジャロ
        { key: ":", count: 1 },  // F: ピンクブルボン
      ]);

      const result = order.shouldSplitOrder();
      expect(result).toBe(true);
      
      const recommendation = generateSimpleRecommendation(order.items);
      recommendation.forEach(order => {
        const uniqueTypes = new Set(order.map(item => item.id)).size;
        expect(uniqueTypes).toBeLessThanOrEqual(2);
      });
    });

    // トートセットの優先配置をテスト
    // トートセットと他のコーヒーが混在する場合、トートセットが最初の注文に配置されることを確認
    it("トートセットが優先的に配置される", () => {
      const order = createTestOrder([
        { key: "@", count: 2 },  // tote: トートセット
        { key: "-", count: 3 },  // A: 縁ブレンド
        { key: "^", count: 2 },  // B: 珈琲・俺ブレンド
      ]);

      const result = order.shouldSplitOrder();
      expect(result).toBe(true);
      
      const recommendation = generateSimpleRecommendation(order.items);
      // 最初の注文にトートセットが含まれることを確認
      const firstOrder = recommendation[0];
      const hasToteSet = firstOrder.some(item => item.id === ITEM_MASTER["@"].id);
      expect(hasToteSet).toBe(true);
    });
  });

  describe("理論的最小注文数の検証", () => {
    // 理論的最小注文数の計算と実際の分割結果の比較テスト
    // 総杯数を4で割った値（切り上げ）が理論的最小注文数
    // 実際の分割結果が理論的最小値以上であることを確認
    it("総杯数から理論的最小注文数を計算", () => {
      const testCases = [
        { items: [{ key: "-", count: 2 }, { key: "^", count: 5 }, { key: "/", count: 1 }, { key: "@", count: 3 }], expectedMin: 3 },
        { items: [{ key: "-", count: 7 }], expectedMin: 2 },
        { items: [{ key: "@", count: 5 }], expectedMin: 2 },
        { items: [{ key: "-", count: 1 }, { key: "^", count: 1 }, { key: "/", count: 1 }, { key: "#", count: 1 }, { key: ";", count: 1 }, { key: ":", count: 1 }], expectedMin: 2 },
      ];

      testCases.forEach(({ items, expectedMin }) => {
        const order = createTestOrder(items);
        const result = order.shouldSplitOrder();
        
        if (result) {
          const recommendation = generateSimpleRecommendation(order.items);
          const actualOrders = recommendation.length;
          console.log(`理論的最小: ${expectedMin}, 実際: ${actualOrders}`);
          // 実際の注文数は理論的最小値以上であることを確認
          expect(actualOrders).toBeGreaterThanOrEqual(expectedMin);
        }
      });
    });
  });
});
