import { describe, expect, test } from "vitest";
import { attachmentFileName, sha256Hex } from "./dataReset";

describe("[unit] sha256Hex", () => {
  test("16 進の小文字 64 文字（サーバーの hex.EncodeToString と同じ形）", async () => {
    const bytes = new TextEncoder().encode("abc");
    expect(await sha256Hex(bytes.buffer as ArrayBuffer)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("[unit] attachmentFileName", () => {
  test("サーバーが付けたファイル名を取る", () => {
    expect(
      attachmentFileName(
        'attachment; filename="cafeore-pos-backup-20261024-120000.json"',
      ),
    ).toBe("cafeore-pos-backup-20261024-120000.json");
  });

  test("無ければ null", () => {
    expect(attachmentFileName(null)).toBeNull();
    expect(attachmentFileName("attachment")).toBeNull();
  });
});
