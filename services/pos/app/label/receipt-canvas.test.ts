import { describe, expect, test } from "vitest";
import { binarize, fitText } from "./receipt-canvas";

describe("[unit] binarize", () => {
  test("しきい値より暗いところを黒、ほかを白にし、透明は白い紙とみなす", () => {
    const image = {
      width: 4,
      height: 1,
      data: new Uint8ClampedArray([
        // 濃い灰色・薄い灰色・真っ黒の透明・半透明の黒
        60, 60, 60, 255, 200, 200, 200, 255, 0, 0, 0, 0, 0, 0, 0, 200,
      ]),
    };

    binarize(image, 128);

    expect([...image.data]).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]);
  });
});

describe("[unit] fitText", () => {
  // 1 文字 10 の幅として測る
  const measure = (text: string) => Array.from(text).length * 10;

  test("入れば切らない", () => {
    expect(fitText("ブレンド", 40, measure)).toBe("ブレンド");
  });

  test("入らなければ後ろを切って「…」を付ける", () => {
    expect(fitText("アイスコーヒー", 40, measure)).toBe("アイス…");
  });
});
