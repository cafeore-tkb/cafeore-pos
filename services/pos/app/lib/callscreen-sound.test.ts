import { describe, expect, test } from "vitest";
import {
  CALL_SCREEN_SOUND_DEFAULT,
  parseCallScreenSound,
} from "./callscreen-sound";

describe("[unit] 呼び出し画面の音の設定", () => {
  test("覚えたものをそのまま読む", () => {
    expect(
      parseCallScreenSound({ chime: false, voice: true, echo: false }),
    ).toEqual({ chime: false, voice: true, echo: false });
  });

  test("無い・形の違う項目は既定（鳴らす）のまま", () => {
    expect(parseCallScreenSound(null)).toEqual(CALL_SCREEN_SOUND_DEFAULT);
    expect(parseCallScreenSound("chime")).toEqual(CALL_SCREEN_SOUND_DEFAULT);
    expect(parseCallScreenSound({ chime: false, echo: "off" })).toEqual({
      chime: false,
      voice: true,
      echo: true,
    });
  });
});
