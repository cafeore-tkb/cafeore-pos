import { describe, expect, test } from "vitest";
import { concatMp3, mp3Frames, readFrameHeader } from "./mp3";

// MPEG-1 Layer III・128kbps・44.1kHz・ステレオ・パディングなしのフレームのヘッダー（長さ 417 バイト）
const HEADER = [0xff, 0xfb, 0x90, 0x00];
const FRAME_LENGTH = 417;

const frame = (fill: number) => {
  const bytes = new Uint8Array(FRAME_LENGTH).fill(fill);
  bytes.set(HEADER, 0);
  return bytes;
};

// LAME などが最初のフレームに入れる Info ヘッダー（サイド情報 32 バイトの後ろ）
const infoFrame = () => {
  const bytes = frame(0);
  bytes.set(
    [..."Info"].map((c) => c.charCodeAt(0)),
    4 + 32,
  );
  return bytes;
};

const id3v2 = (bodyLength: number) => {
  const bytes = new Uint8Array(10 + bodyLength).fill(0x20);
  bytes.set([0x49, 0x44, 0x33, 0x04, 0x00, 0x00], 0);
  // 長さは syncsafe（7 ビットずつ）
  bytes.set(
    [
      (bodyLength >> 21) & 0x7f,
      (bodyLength >> 14) & 0x7f,
      (bodyLength >> 7) & 0x7f,
      bodyLength & 0x7f,
    ],
    6,
  );
  return bytes;
};

const id3v1 = () => {
  const bytes = new Uint8Array(128).fill(0x20);
  bytes.set([0x54, 0x41, 0x47], 0);
  return bytes;
};

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
};

describe("[unit] MP3 をつなぐ", () => {
  test("フレームの長さとサイド情報の位置を読む", () => {
    expect(readFrameHeader(frame(1), 0)).toEqual({
      length: FRAME_LENGTH,
      xingOffset: 36,
    });
    expect(readFrameHeader(new Uint8Array([0x49, 0x44, 0x33, 0]), 0)).toBe(
      null,
    );
  });

  test("ID3 タグと最初の Info フレームを落とし、音のフレームだけを残す", () => {
    const data = join(id3v2(300), infoFrame(), frame(1), frame(2), id3v1());
    expect(mp3Frames(data)).toEqual(new Uint8Array(join(frame(1), frame(2))));
  });

  test("タグも Info も無ければそのまま", () => {
    const data = join(frame(1), frame(2));
    expect(mp3Frames(data)).toEqual(new Uint8Array(data));
  });

  test("片のフレームを順につなぐ", () => {
    const a = join(id3v2(20), infoFrame(), frame(1));
    const b = join(id3v2(40), infoFrame(), frame(2), frame(3));
    expect(new Uint8Array(concatMp3([a, b]))).toEqual(
      new Uint8Array(join(frame(1), frame(2), frame(3))),
    );
  });
});
