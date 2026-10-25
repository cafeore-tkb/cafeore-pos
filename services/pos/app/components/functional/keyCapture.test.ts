import { describe, expect, test } from "vitest";
import {
  type CaptureKeyEvent,
  type KeyCapture,
  cancelHeldKeys,
  captureKeyDown,
  captureKeyUp,
  capturedKey,
  emptyKeyCapture,
} from "./keyCapture";

const down = (
  capture: KeyCapture,
  code: string,
  key: string,
  options: Partial<CaptureKeyEvent> = {},
): KeyCapture =>
  captureKeyDown(capture, {
    code,
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    repeat: false,
    ...options,
  });

const up = (capture: KeyCapture, code: string, key = ""): KeyCapture =>
  captureKeyUp(capture, { code, key });

describe("[unit] keyCapture", () => {
  test("1 つ押して離すと、そのキー", () => {
    let capture = down(emptyKeyCapture(), "KeyA", "a");
    expect(capturedKey(capture)).toBeNull();
    capture = up(capture, "KeyA");
    expect(capturedKey(capture)).toBe("a");
    expect(capture.error).toBeNull();
  });

  test("何も押していなければ null", () => {
    expect(capturedKey(emptyKeyCapture())).toBeNull();
  });

  test("Shift は数えず、Shift と押した記号はその記号", () => {
    let capture = down(emptyKeyCapture(), "ShiftLeft", "Shift");
    capture = down(capture, "Quote", "*");
    // Shift を先に離しても、離すときは位置（code）で探す
    capture = up(capture, "ShiftLeft");
    expect(capturedKey(capture)).toBeNull();
    capture = up(capture, "Quote", ":");
    expect(capturedKey(capture)).toBe("*");
  });

  test("押したまま次を押すと、押した順につないだ同時押し", () => {
    let capture = down(emptyKeyCapture(), "KeyS", "s");
    capture = down(capture, "KeyA", "a");
    capture = up(capture, "KeyS");
    expect(capturedKey(capture)).toBeNull();
    capture = up(capture, "KeyA");
    expect(capturedKey(capture)).toBe("s+a");
  });

  test("+ そのものも同時押しに入る", () => {
    let capture = down(emptyKeyCapture(), "KeyA", "a");
    capture = down(capture, "Semicolon", "+");
    capture = up(up(capture, "KeyA"), "Semicolon");
    expect(capturedKey(capture)).toBe("a++");
  });

  test("途中で離して別のキーを押したら、最後に押したときに押していた組", () => {
    let capture = down(emptyKeyCapture(), "KeyA", "a");
    capture = down(capture, "KeyS", "s");
    capture = up(capture, "KeyS");
    capture = down(capture, "KeyD", "d");
    capture = up(up(capture, "KeyA"), "KeyD");
    expect(capturedKey(capture)).toBe("a+d");
  });

  test("別の位置の同じキーは 1 つと見る", () => {
    let capture = down(emptyKeyCapture(), "Digit1", "1");
    capture = down(capture, "Numpad1", "1");
    capture = up(up(capture, "Digit1"), "Numpad1");
    expect(capturedKey(capture)).toBe("1");
  });

  test("押しっぱなしの繰り返しと、押していないキーを離したのは何もしない", () => {
    let capture = down(emptyKeyCapture(), "KeyA", "a");
    capture = down(capture, "KeyA", "a", { repeat: true });
    // 登録を始める前に押していた Enter を離した
    capture = up(capture, "Enter");
    expect(capturedKey(capture)).toBeNull();
    capture = up(capture, "KeyA");
    expect(capturedKey(capture)).toBe("a");
  });

  test("全部離してから押したら押し直し", () => {
    let capture = down(emptyKeyCapture(), "KeyC", "c", { altKey: true });
    capture = up(capture, "KeyC");
    expect(capture.error).not.toBeNull();
    capture = down(capture, "KeyB", "b");
    capture = up(capture, "KeyB");
    expect(capturedKey(capture)).toBe("b");
    expect(capture.error).toBeNull();
  });

  test("Alt・Ctrl・⌘ と一緒に押したキーと日本語入力中のキーは、レジで使えないので理由を出す", () => {
    for (const options of [
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { isComposing: true },
    ]) {
      const capture = up(down(emptyKeyCapture(), "KeyA", "a", options), "KeyA");
      expect(capturedKey(capture)).toBe("a");
      expect(capture.error).not.toBeNull();
    }
    const ime = up(down(emptyKeyCapture(), "KeyA", "Process"), "KeyA");
    expect(ime.error).not.toBeNull();
  });

  test("同時押しの途中で Alt と押したキーがあれば、組ごと使えない", () => {
    let capture = down(emptyKeyCapture(), "KeyA", "a");
    capture = down(capture, "KeyS", "s", { altKey: true });
    capture = up(up(capture, "KeyA"), "KeyS");
    expect(capture.error).not.toBeNull();
  });

  test("⌘ を離したら全部離したことにする（macOS は ⌘ を押している間 keyup が来ない）", () => {
    let capture = down(emptyKeyCapture(), "KeyA", "a", { metaKey: true });
    capture = up(capture, "MetaLeft", "Meta");
    expect(capturedKey(capture)).toBe("a");
  });

  test("押している途中でほかのウィンドウに移ったら押し直し。押し終えていればそのまま", () => {
    const pressing = down(emptyKeyCapture(), "KeyA", "a");
    expect(cancelHeldKeys(pressing)).toEqual(emptyKeyCapture());
    const done = up(pressing, "KeyA");
    expect(cancelHeldKeys(done)).toBe(done);
  });
});
