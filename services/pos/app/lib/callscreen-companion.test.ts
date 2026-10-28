import { describe, expect, test } from "vitest";
import {
  companionFeatures,
  parseCompanionRequest,
  parseHostState,
} from "./callscreen-companion";

const SOURCE = "cafeore:callscreen-companion";

const item = {
  id: "cm-1",
  name: "a.mp4",
  kind: "video",
  type: "video/mp4",
  url: "blob:https://pos.example/1",
};

describe("[unit] 呼び出し画面の小窓とのやりとり", () => {
  test("小窓からの頼みを読む", () => {
    const file = new File([new Uint8Array([1])], "a.mp4", {
      type: "video/mp4",
    });
    expect(parseCompanionRequest({ source: SOURCE, type: "hello" })).toEqual({
      type: "hello",
    });
    expect(
      parseCompanionRequest({ source: SOURCE, type: "add", files: [file] }),
    ).toEqual({ type: "add", files: [file] });
    expect(
      parseCompanionRequest({
        source: SOURCE,
        type: "move",
        id: "cm-1",
        delta: 1,
      }),
    ).toEqual({ type: "move", id: "cm-1", delta: 1 });
    expect(
      parseCompanionRequest({
        source: SOURCE,
        type: "image-seconds",
        seconds: 8,
      }),
    ).toEqual({ type: "image-seconds", seconds: 8 });
    expect(parseCompanionRequest({ source: SOURCE, type: "stop" })).toEqual({
      type: "stop",
    });
  });

  test("印の無いもの・形の違うものは読まない", () => {
    expect(parseCompanionRequest({ type: "clear" })).toBe(null);
    expect(parseCompanionRequest("clear")).toBe(null);
    expect(parseCompanionRequest({ source: SOURCE, type: "reload" })).toBe(
      null,
    );
    expect(
      parseCompanionRequest({ source: SOURCE, type: "add", files: ["a.mp4"] }),
    ).toBe(null);
    expect(
      parseCompanionRequest({
        source: SOURCE,
        type: "move",
        id: "cm-1",
        delta: 2,
      }),
    ).toBe(null);
    expect(parseCompanionRequest({ source: SOURCE, type: "remove" })).toBe(
      null,
    );
  });

  test("元のタブから届いた今の並びを読む", () => {
    expect(
      parseHostState({
        source: SOURCE,
        type: "state",
        playlist: { items: [item], imageSeconds: 10 },
        screenName: "TV",
      }),
    ).toEqual({
      type: "state",
      playlist: { items: [item], imageSeconds: 10 },
      screenName: "TV",
    });
  });

  test("並びの形が違えば読まない", () => {
    const state = (playlist: unknown) => ({
      source: SOURCE,
      type: "state",
      playlist,
      screenName: "TV",
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

  test("小窓はその画面の使える広さいっぱいに開く", () => {
    expect(
      companionFeatures({
        availLeft: -1440,
        availTop: 25,
        availWidth: 1440,
        availHeight: 875,
      }),
    ).toBe("left=-1440,top=25,width=1440,height=875");
  });
});
