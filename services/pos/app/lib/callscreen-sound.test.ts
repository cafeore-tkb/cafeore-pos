import { describe, expect, test } from "vitest";
import {
  CALL_SCREEN_SOUND_DEFAULT,
  ECHO_LEVEL_MAX,
  ECHO_LEVEL_MIN,
  parseCallScreenSound,
} from "./callscreen-sound";

describe("[unit] 呼び出し画面の音の設定", () => {
  test("覚えたものをそのまま読む", () => {
    expect(
      parseCallScreenSound({
        chime: false,
        voice: true,
        echo: false,
        echoLevel: 35,
      }),
    ).toEqual({ chime: false, voice: true, echo: false, echoLevel: 35 });
  });

  test("無い・形の違う項目は既定（鳴らす）のまま", () => {
    expect(parseCallScreenSound(null)).toEqual(CALL_SCREEN_SOUND_DEFAULT);
    expect(parseCallScreenSound("chime")).toEqual(CALL_SCREEN_SOUND_DEFAULT);
    expect(
      parseCallScreenSound({ chime: false, echo: "off", echoLevel: "30" }),
    ).toEqual({
      chime: false,
      voice: true,
      echo: true,
      echoLevel: CALL_SCREEN_SOUND_DEFAULT.echoLevel,
    });
  });

  test("エコーの強さは範囲の中の刻みに丸める", () => {
    const level = (echoLevel: unknown) =>
      parseCallScreenSound({ echoLevel }).echoLevel;
    expect(level(0)).toBe(ECHO_LEVEL_MIN);
    expect(level(500)).toBe(ECHO_LEVEL_MAX);
    expect(level(23)).toBe(25);
    expect(level(32)).toBe(30);
    expect(level(Number.NaN)).toBe(CALL_SCREEN_SOUND_DEFAULT.echoLevel);
  });
});
