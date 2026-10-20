import { type CaosCard, type Cup, buildCaosCards } from "@cafeore/common";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { OrderHighlightsContext } from "./useOrderHighlights";
import { useUnassignedPick } from "./useUnassignedPick";

vi.mock("./useCardDrag", () => ({
  useCardDrag: () => ({}),
  useAnyCardDragging: () => false,
}));
vi.mock("./useOutsidePress", () => ({ useOutsidePress: () => {} }));
vi.mock("./useCaosStateLog", () => ({ useCaosStateLog: () => {} }));

const cards = buildCaosCards([
  {
    id: "internal-order-id",
    orderId: 12,
    createdAt: new Date("2026-10-20T09:00:00+09:00"),
    menus: [],
    cups: [
      {
        id: "cup",
        orderMenuId: "",
        dripper: null,
        dripperPosition: null,
        dripId: null,
        brewStartedAt: null,
        brewFinishedAt: null,
        readyAt: null,
        servedAt: null,
        emergencies: [],
        item: {
          id: "blend",
          name: "ブレンド",
          abbr: "ブ",
          item_type: { name: "hot", makes_cup: true, needs_brew: true },
        } as Cup["item"],
      },
    ],
  },
]);
// 未割当カードの入口を直接呼び、OrderCard のクリック捕捉に依存しないことを確認する。
const card = cards[0] as CaosCard;

function renderPick(withHighlight: boolean, withSelection = true) {
  const selectCard = vi.fn();
  const selectOrder = vi.fn();
  const clear = vi.fn();
  let pick!: ReturnType<typeof useUnassignedPick>;
  function Harness() {
    pick = useUnassignedPick({
      orders: [card],
      onSelectOrder: withSelection ? selectOrder : undefined,
      onAssignToBay: vi.fn(),
    });
    return null;
  }
  renderToStaticMarkup(
    createElement(
      OrderHighlightsContext.Provider,
      {
        value: withHighlight
          ? {
              orders: [],
              selectCard,
              selectLabel: vi.fn(),
              clear,
              revealCard: vi.fn(),
            }
          : null,
      },
      createElement(Harness),
    ),
  );
  return { pick, selectCard, selectOrder, clear };
}

describe("[unit] 未割当の操作選択と注文強調", () => {
  test("カード側のクリック捕捉がなくても、操作選択とIDによる強調を行う", () => {
    const { pick, selectCard, selectOrder, clear } = renderPick(true);
    pick.tap(card);
    expect(selectOrder).toHaveBeenCalledWith("#012");
    expect(selectCard).toHaveBeenCalledExactlyOnceWith(card);
    expect(clear).not.toHaveBeenCalled();
  });

  test("キューでは従来の操作選択を維持する", () => {
    const { pick, selectCard, selectOrder } = renderPick(false);
    pick.tap(card);
    expect(selectOrder).toHaveBeenCalledWith("#012");
    expect(selectCard).not.toHaveBeenCalled();
  });

  test("閲覧画面は選択コールバックを省略できる", () => {
    const { pick, selectOrder } = renderPick(false, false);
    expect(() => pick.tap(card)).not.toThrow();
    expect(selectOrder).not.toHaveBeenCalled();
  });
});
