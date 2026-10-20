import { type Cup, buildCaosCards } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import {
  cardNomination,
  cardNumberParts,
  fittingCardLabels,
} from "./cardPresentation";

const labels = [
  { key: "lane", width: 60, compactWidth: 28, priority: 0 },
  { key: "senior", width: 66, compactWidth: 20, priority: 2 },
  { key: "emergency", width: 48, priority: 3 },
];

describe("[unit] カードのラベル優先順位", () => {
  test("余裕があれば指名・上級生の文字と緊急札をすべて残す", () => {
    const fit = fittingCardLabels(270, 48, labels, 4);
    expect([...fit.visible]).toEqual(["lane", "senior", "emergency"]);
    expect([...fit.compact]).toEqual([]);
  });
  test("レーンと上級生アイコンを残し、入らない緊急札を省略する", () => {
    const fit = fittingCardLabels(154, 48, labels, 4);
    expect([...fit.visible]).toEqual(["lane", "senior"]);
    expect([...fit.compact]).toEqual(["senior"]);
  });
  test("さらに狭ければ指名の接頭語を省略し、2ndと★を残す", () => {
    const fit = fittingCardLabels(120, 48, labels, 4);
    expect([...fit.visible]).toEqual(["lane", "senior"]);
    expect([...fit.compact]).toEqual(["lane", "senior"]);
  });
  test("長い自由記述の札は途中切れにせず省略する", () => {
    const fit = fittingCardLabels(
      180,
      48,
      [
        { key: "name", width: 200, priority: 1 },
        ...labels.filter((l) => l.key !== "lane"),
      ],
      4,
    );
    expect(fit.visible.has("name")).toBe(false);
    expect(fit.visible.has("senior")).toBe(true);
  });
  test("商品名が長くても短いレーン名の幅を先に確保する", () => {
    const fit = fittingCardLabels(120, 300, labels, 4);
    expect(fit.productWidth).toBe(88);
    expect([...fit.visible]).toEqual(["lane"]);
    expect(fit.compact.has("lane")).toBe(true);
  });
});

const item = {
  id: "blend",
  name: "ブレンド",
  abbr: "ブ",
  item_type: { name: "blend", makes_cup: true, needs_brew: true },
} as Cup["item"];
const state = {
  dripId: "mixed",
  dripper: 2,
  dripperPosition: 1,
  brewStartedAt: null,
  brewFinishedAt: null,
};
const [mixed] = buildCaosCards([
  {
    id: "a",
    orderId: 1000,
    createdAt: new Date("2026-10-20T09:00:00+09:00"),
    menus: [],
    cups: [
      {
        id: "cup",
        orderMenuId: "",
        item,
        readyAt: null,
        servedAt: null,
        ...state,
        emergencies: [
          {
            id: "emergency",
            createdAt: new Date("2026-10-20T10:00:00+09:00"),
            reason: "こぼした",
            ...state,
          },
        ],
      },
    ],
  },
]);

describe("[unit] カードの番号と指名", () => {
  test("同一注文の1000番でも緊急と通常を別の番号要素にする", () => {
    expect(cardNumberParts(mixed)).toEqual([
      { id: "a", no: 1000, emergency: true },
      { id: "a", no: 1000, emergency: false },
    ]);
  });
  test("レーンと自由記述を区別し、レーンを番号順に表示する", () => {
    const nomination = cardNomination({
      ...mixed,
      cups: mixed.cups.map((cup, i) => ({
        ...cup,
        nominatedDripper: i ? null : 2,
        nominee: i ? "山田太郎" : "2nd",
      })),
    });
    expect(nomination).toEqual({ lane: "2nd", text: "山田太郎" });
  });
});
