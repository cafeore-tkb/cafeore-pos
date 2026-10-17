import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  CM_IMAGE_SECONDS_DEFAULT,
  CM_IMAGE_SECONDS_MAX,
  CM_IMAGE_SECONDS_MIN,
  cmItemKind,
  cmPlaylist,
  getCmPlaylist,
} from "./callscreen-cm";

const file = (name: string, type: string) =>
  new File([new Uint8Array([1, 2, 3])], name, { type });

const names = () => getCmPlaylist().items.map((item) => item.name);

beforeEach(() => {
  cmPlaylist.clear();
  cmPlaylist.setImageSeconds(CM_IMAGE_SECONDS_DEFAULT);
});

describe("[unit] 呼び出し画面の CM の並び", () => {
  test("動画と画像だけを後ろに足し、それ以外は名前を返して足さない", () => {
    expect(cmItemKind(file("a.mp4", "video/mp4"))).toBe("video");
    expect(cmItemKind(file("b.png", "image/png"))).toBe("image");
    expect(cmItemKind(file("c.pdf", "application/pdf"))).toBe(null);

    const rejected = cmPlaylist.add([
      file("a.mp4", "video/mp4"),
      file("c.pdf", "application/pdf"),
      file("b.png", "image/png"),
    ]);
    expect(rejected).toEqual(["c.pdf"]);
    expect(names()).toEqual(["a.mp4", "b.png"]);
    expect(getCmPlaylist().items.map((item) => item.kind)).toEqual([
      "video",
      "image",
    ]);
  });

  test("上下に動かす。端からは動かない", () => {
    cmPlaylist.add([
      file("a.mp4", "video/mp4"),
      file("b.png", "image/png"),
      file("c.webm", "video/webm"),
    ]);
    const [a, , c] = getCmPlaylist().items;
    cmPlaylist.move(c.id, -1);
    expect(names()).toEqual(["a.mp4", "c.webm", "b.png"]);
    cmPlaylist.move(a.id, -1);
    expect(names()).toEqual(["a.mp4", "c.webm", "b.png"]);
    cmPlaylist.move(a.id, 1);
    expect(names()).toEqual(["c.webm", "a.mp4", "b.png"]);
  });

  test("外すと blob: の URL を解放する", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    cmPlaylist.add([file("a.mp4", "video/mp4"), file("b.png", "image/png")]);
    const [a] = getCmPlaylist().items;
    cmPlaylist.remove(a.id);
    expect(names()).toEqual(["b.png"]);
    expect(revoke).toHaveBeenCalledWith(a.url);
    cmPlaylist.clear();
    expect(names()).toEqual([]);
    expect(revoke).toHaveBeenCalledTimes(2);
    revoke.mockRestore();
  });

  test("画像の秒数は決まった幅に寄せ、数でなければ変えない", () => {
    cmPlaylist.setImageSeconds(1);
    expect(getCmPlaylist().imageSeconds).toBe(CM_IMAGE_SECONDS_MIN);
    cmPlaylist.setImageSeconds(9999);
    expect(getCmPlaylist().imageSeconds).toBe(CM_IMAGE_SECONDS_MAX);
    cmPlaylist.setImageSeconds(Number.NaN);
    expect(getCmPlaylist().imageSeconds).toBe(CM_IMAGE_SECONDS_MAX);
    cmPlaylist.setImageSeconds(15.4);
    expect(getCmPlaylist().imageSeconds).toBe(15);
  });
});
