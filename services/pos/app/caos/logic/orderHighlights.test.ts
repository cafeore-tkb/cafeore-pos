import {
  type CaosCard,
  type CaosOrderInput,
  type Cup,
  buildCaosCards,
} from "@cafeore/common";
import { describe, expect, test } from "vitest";
import {
  ORDER_HIGHLIGHT_COLORS,
  cardOrders,
  highlightFrame,
  highlightParts,
  labelOrders,
  outsideHighlights,
  selectHighlights,
} from "./orderHighlights";

const item = {
  id: "blend",
  name: "ブレンド",
  abbr: "ブ",
  item_type: { name: "hot", makes_cup: true, needs_brew: true },
} as Cup["item"];
const order = (id: string, no: number, drips: string[]): CaosOrderInput => ({
  id,
  orderId: no,
  createdAt: new Date("2026-10-20T09:00:00+09:00"),
  menus: [],
  cups: drips.map((dripId, index) => ({
    id: `${id}-cup-${index}`,
    orderMenuId: "",
    item,
    dripper: 1,
    dripperPosition: index,
    dripId,
    brewStartedAt: null,
    brewFinishedAt: null,
    readyAt: null,
    servedAt: null,
    emergencies: [],
  })),
});
const cards = buildCaosCards([
  order("a", 12, ["ab", "a"]),
  order("b", 13, ["ab", "bc", "b"]),
  order("c", 14, ["bc"]),
]);
const get = (key: string) =>
  cards.find((card) => card.dripId === key) as CaosCard;
const selected = selectHighlights(cardOrders(get("ab")), []);

describe("[unit] 注文ハイライト", () => {
  test("統合の番号順に2色を割り当て、片方に絞っても対応色を保つ", () => {
    expect(selected).toEqual([
      { id: "a", no: 12, color: ORDER_HIGHLIGHT_COLORS[0] },
      { id: "b", no: 13, color: ORDER_HIGHLIGHT_COLORS[1] },
    ]);
    expect(selectHighlights([{ id: "b", no: 13 }], selected)).toEqual([
      selected[1],
    ]);
    expect(selectHighlights(cardOrders(get("ab")), [selected[1]])).toEqual(
      selected,
    );
  });

  test("別の統合を経由して無関係な注文へ連鎖しない。対象の半分だけ着色する", () => {
    expect(highlightParts(get("bc"), selected)).toEqual([
      { id: "b", no: 13, color: ORDER_HIGHLIGHT_COLORS[1] },
      { id: "c", no: 14, color: null },
    ]);
    expect(highlightFrame(get("bc"), selected)).toBe(
      "linear-gradient(90deg, #A16207 0%, #A16207 50%, transparent 50%, transparent 100%)",
    );
    expect(highlightFrame(get("ab"), selected)).toContain(
      "#C2410C 50%, #A16207 50%",
    );
    expect(highlightFrame(get("a"), [selected[1]])).toBeNull();
  });

  test("表示番号が同じ別注文を強調せず、曖昧な文字検索を推測しない", () => {
    const otherDay = buildCaosCards([order("other-day", 12, ["other"])])[0];
    expect(highlightFrame(otherDay, selected)).toBeNull();
    expect(labelOrders([...cards, otherDay], "#012")).toEqual([]);
    expect(labelOrders([...cards, otherDay], "#012", "a")).toEqual([
      { id: "a", no: 12 },
    ]);
    expect(labelOrders(cards, "#012+#013")).toEqual([
      { id: "a", no: 12 },
      { id: "b", no: 13 },
    ]);
  });

  test("移動・統合解除でキーや並びが変わっても、同じ注文IDなら色を維持する", () => {
    const moved = { ...get("b"), key: "moved", dripper: 4 };
    expect(highlightParts(moved, selected)[0].color).toBe(
      ORDER_HIGHLIGHT_COLORS[1],
    );
    const split = {
      ...get("ab"),
      key: "split",
      cups: get("ab").cups.filter((cup) => cup.orderId === "b"),
    };
    expect(highlightFrame(split, selected)).toBe(
      "linear-gradient(90deg, #A16207 0%, #A16207 100%)",
    );
    // カップが盤面から消えた場合も、選択自体を削除する処理はない。
    expect(selected).toHaveLength(2);
  });

  test("画面外の杯数は対象注文だけを数え、部分的に見えるカードを除く", () => {
    const result = outsideHighlights(
      [
        { card: get("ab"), left: 0, right: 100 },
        { card: get("b"), left: 190, right: 240 },
        { card: get("bc"), left: 400, right: 500 },
      ],
      "b",
      { left: 200, right: 400 },
    );
    expect(result).toEqual({
      left: { count: 1, key: get("ab").key },
      right: { count: 1, key: get("bc").key },
    });
  });

  test("同じカードの重複で杯数を増やさず、最も近い画面外のカードへ案内する", () => {
    const result = outsideHighlights(
      [
        { card: get("bc"), left: 900, right: 1000 },
        { card: get("b"), left: 500, right: 600 },
        { card: get("b"), left: 500, right: 600 },
      ],
      "b",
      { left: 100, right: 400 },
    );
    expect(result.right).toEqual({ count: 2, key: get("b").key });
    expect(result.left).toEqual({ count: 0, key: null });
  });

  test("同じ注文2杯の統合は1色。対象なしでは枠を追加しない", () => {
    const same = buildCaosCards([
      order("same", 20, ["same-drip", "same-drip"]),
    ])[0];
    const selection = selectHighlights(cardOrders(same), []);
    expect(selection).toHaveLength(1);
    expect(
      outsideHighlights([{ card: same, left: 500, right: 600 }], "same", {
        left: 0,
        right: 400,
      }).right.count,
    ).toBe(2);
    expect(highlightFrame(same, [])).toBeNull();
  });
});
