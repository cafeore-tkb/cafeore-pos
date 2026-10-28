import { describe, expect, test } from "vitest";
import {
  parseDisplayMessage,
  parseHostState,
  windowFeatures,
} from "./callscreen-window";

const SOURCE = "cafeore:callscreen-window";

const item = {
  id: "cm-1",
  name: "a.mp4",
  kind: "video",
  type: "video/mp4",
  url: "blob:https://pos.example/1",
};

describe("[unit] 呼び出し画面の窓とのやりとり", () => {
  test("窓からの知らせを読む", () => {
    expect(
      parseDisplayMessage({ source: SOURCE, type: "hello", soundReady: false }),
    ).toEqual({ type: "hello", soundReady: false });
    expect(parseDisplayMessage({ source: SOURCE, type: "bye" })).toEqual({
      type: "bye",
    });
  });

  test("印の無いもの・形の違う知らせは読まない", () => {
    expect(parseDisplayMessage({ type: "bye" })).toBe(null);
    expect(parseDisplayMessage("bye")).toBe(null);
    expect(parseDisplayMessage({ source: SOURCE, type: "hello" })).toBe(null);
    expect(parseDisplayMessage({ source: SOURCE, type: "state" })).toBe(null);
  });

  test("設定の画面から届いた今の並びを読む", () => {
    expect(
      parseHostState({
        source: SOURCE,
        type: "state",
        playlist: { items: [item], imageSeconds: 10 },
      }),
    ).toEqual({
      type: "state",
      playlist: { items: [item], imageSeconds: 10 },
    });
  });

  test("並びの形が違えば読まない", () => {
    const state = (playlist: unknown) => ({
      source: SOURCE,
      type: "state",
      playlist,
    });
    expect(parseHostState(state({ items: [item] }))).toBe(null);
    expect(
      parseHostState(
        state({ items: [{ ...item, kind: "audio" }], imageSeconds: 10 }),
      ),
    ).toBe(null);
    expect(
      parseHostState({
        ...state({ items: [], imageSeconds: 10 }),
        source: "x",
      }),
    ).toBe(null);
  });

  test("窓はその画面の使える広さいっぱいに開く", () => {
    expect(
      windowFeatures({
        availLeft: 1440,
        availTop: 0,
        availWidth: 1920,
        availHeight: 1080,
      }),
    ).toBe("left=1440,top=0,width=1920,height=1080");
  });
});
