import { describe, expect, test } from "vitest";
import {
  type RasterImage,
  packImage,
  rotateImage180,
  unpackImage,
} from "./document";

/** "#" を黒、"." を白にした白黒の画像 */
const imageOf = (rows: string[]): RasterImage => {
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * rows.length * 4).fill(255);
  rows.forEach((row, y) => {
    Array.from(row).forEach((dot, x) => {
      if (dot === "#")
        data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
    });
  });
  return { width, height: rows.length, data };
};

describe("[unit] packImage / unpackImage", () => {
  test("1 ドット 1 ビット（上の桁が左、1 が黒）に詰め、行の端は 8 ドットにそろえ、戻すと同じ画像になる", () => {
    const image = imageOf(["#........#", ".#.#.#.#.."]);

    const packed = packImage(image);

    // 1 行 2 バイト：10000000 01000000 / 01010101 00000000
    expect(packed).toEqual({
      width: 10,
      height: 2,
      bits: btoa(String.fromCharCode(0x80, 0x40, 0x55, 0x00)),
    });
    expect(unpackImage(packed)).toEqual(image);
  });

  test("下の白い行は送らない。黒い所が無ければ 1 行だけにする", () => {
    expect(packImage(imageOf(["#.", "..", ".."])).height).toBe(1);
    expect(packImage(imageOf(["..", ".#", ".."])).height).toBe(2);
    expect(packImage(imageOf(["..", ".."]))).toEqual({
      width: 2,
      height: 1,
      bits: btoa(String.fromCharCode(0)),
    });
  });

  test("360 × 232 ドットのシールは 14 KB ほどの文字にする（代理印刷の上限 64 KiB に収まる）", () => {
    const image = imageOf(Array(232).fill("#".repeat(360)));
    expect(packImage(image).bits.length).toBe(13920);
  });
});

describe("[unit] rotateImage180", () => {
  test("上下と左右を入れ替える（シールの真ん中を中心に 180° 回す）", () => {
    expect(rotateImage180(imageOf(["##...", "#...."]))).toEqual(
      imageOf(["....#", "...##"]),
    );
  });

  test("2 回回すと元に戻る", () => {
    const image = imageOf(["#..#.", ".##..", "....#"]);
    expect(rotateImage180(rotateImage180(image))).toEqual(image);
  });
});
