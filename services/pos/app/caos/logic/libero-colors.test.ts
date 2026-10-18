import type { CaosCard } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import {
  brewIntensity,
  justStarted,
  liberoColor,
  liberoCupCounts,
} from "./libero-colors";

const card = (...iced: boolean[]) =>
  ({
    cups: iced.map((ice) => ({ item: { item_type: { iced_brew: ice } } })),
  }) as unknown as CaosCard;
const luminance = (hex: string) => {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const contrast = (a: string, b: string) => {
  const light = luminance(a);
  const dark = luminance(b);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
};

describe("[unit] リベロの背景と開始直後の名前", () => {
  test("先頭の種別にかかわらず全カップの内訳を数える", () => {
    expect(liberoCupCounts(card(false, false))).toEqual({ hot: 2, iced: 0 });
    expect(liberoCupCounts(card(true, true))).toEqual({ hot: 0, iced: 2 });
    expect(liberoCupCounts(card(true, false))).toEqual({ hot: 1, iced: 1 });
    expect(liberoColor(card(true, false), 0.7)).toEqual(
      liberoColor(card(false, true), 0.7),
    );
  });
  test("単色は1面、混在は杯数比の2面になり、backgroundImageを使わない", () => {
    expect(liberoColor(card(false, false), 1).parts).toEqual([
      { kind: "hot", count: 2, fraction: 1, backgroundColor: "#b91c1c" },
    ]);
    expect(liberoColor(card(true), 1).parts).toEqual([
      { kind: "iced", count: 1, fraction: 1, backgroundColor: "#1d4ed8" },
    ]);
    const mixed = liberoColor(card(true, false), 1);
    expect(mixed.parts.map((part) => part.fraction)).toEqual([0.5, 0.5]);
    expect(
      liberoColor(card(false, true, false), 0.4).parts.map(
        (part) => part.fraction,
      ),
    ).toEqual([2 / 3, 1 / 3]);
    for (const palette of [
      mixed,
      liberoColor(card(false), 0.5),
      liberoColor(card(true), 0.5),
    ]) {
      expect(palette).not.toHaveProperty("backgroundImage");
      for (const part of palette.parts)
        expect(part).not.toHaveProperty("backgroundImage");
      expect(
        palette.parts.reduce((sum, part) => sum + part.fraction, 0),
      ).toBeCloseTo(1);
    }
  });
  test("白から濃色まで、単色の文字と混在の白い文字面は4.5:1以上のコントラスト", () => {
    for (let i = 0; i <= 100; i++) {
      for (const source of [card(false), card(true), card(false, true)]) {
        const palette = liberoColor(source, i / 100);
        // 混在は背景のアニメーション途中も不変の白い下地。片方の色で判定しない。
        const surface = palette.textStyle.backgroundColor;
        for (const part of palette.parts)
          expect(
            contrast(palette.textStyle.color, surface ?? part.backgroundColor),
          ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  test("濃さを範囲内に収め、終了間際ほど速く濃くする", () => {
    expect(liberoColor(card(false), -1)).toEqual(liberoColor(card(false), 0));
    expect(liberoColor(card(true), 2)).toEqual(liberoColor(card(true), 1));
    expect(brewIntensity(0)).toBe(0);
    expect(brewIntensity(1)).toBe(1);
    expect(brewIntensity(1) - brewIntensity(0.9)).toBeGreaterThan(
      brewIntensity(0.1) - brewIntensity(0),
    );
  });
  test("赤い名前は開始から1分未満だけ。空き・60秒ちょうどは対象外", () => {
    expect(justStarted(undefined)).toBe(false);
    expect(justStarted(-1)).toBe(false);
    expect(justStarted(0)).toBe(true);
    expect(justStarted(59)).toBe(true);
    expect(justStarted(60)).toBe(false);
    expect(justStarted(61)).toBe(false);
  });
});
