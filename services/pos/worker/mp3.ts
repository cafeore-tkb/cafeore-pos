// MP3 をつなぐ（呼び出しの音声は、別々に作った片をつないで 1 本にする。worker/call-voice.ts）。
//
// MP3 はフレームを並べただけのものなので、フレームをそのまま後ろにつなげば 1 本として流れる。
// ただし片ごとに付いている次のものは、つなぐと邪魔になるので落とす：
//   - 頭の ID3v2 タグ・尻の ID3v1 タグ（途中に挟まると、そこで雑音やつっかえが出ることがある）
//   - 最初のフレームの Xing / Info / VBRI ヘッダー（その片だけの長さとフレーム数が書いてあり、
//     先頭に残るとブラウザが 1 本目の長さで終わったとみなすことがある）

const ID3V1_SIZE = 128;

// MPEG Audio Layer III のビットレート（kbps）。[MPEG-1, MPEG-2/2.5] × インデックス
const BITRATES = [
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
];
// サンプリング周波数（Hz）。[MPEG-1, MPEG-2, MPEG-2.5] × インデックス
const SAMPLE_RATES = [
  [44100, 48000, 32000],
  [22050, 24000, 16000],
  [11025, 12000, 8000],
];

interface FrameHeader {
  /** フレームの長さ（バイト） */
  length: number;
  /** Xing / Info ヘッダーが始まる位置（フレームの頭から） */
  xingOffset: number;
}

/** bytes[at] から始まる MPEG Audio Layer III のフレームのヘッダー。フレームでなければ null */
export const readFrameHeader = (
  bytes: Uint8Array,
  at: number,
): FrameHeader | null => {
  if (at + 4 > bytes.length) return null;
  const b1 = bytes[at + 1];
  const b2 = bytes[at + 2];
  const b3 = bytes[at + 3];
  if (bytes[at] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const versionBits = (b1 >> 3) & 0b11; // 00: 2.5, 10: 2, 11: 1
  const layerBits = (b1 >> 1) & 0b11; // 01: Layer III
  if (versionBits === 0b01 || layerBits !== 0b01) return null;
  const mpeg1 = versionBits === 0b11;
  const bitrate = BITRATES[mpeg1 ? 0 : 1][(b2 >> 4) & 0x0f] * 1000;
  const rateIndex = (b2 >> 2) & 0b11;
  if (bitrate === 0 || rateIndex === 0b11) return null;
  const sampleRate =
    SAMPLE_RATES[mpeg1 ? 0 : versionBits === 0b10 ? 1 : 2][rateIndex];
  const padding = (b2 >> 1) & 1;
  const mono = b3 >> 6 === 0b11;
  const length =
    Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sampleRate) + padding;
  // ヘッダー（4 バイト）のあとのサイド情報の長さ
  const sideInfo = mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17;
  return { length, xingOffset: 4 + sideInfo };
};

const ascii = (bytes: Uint8Array, at: number, text: string) =>
  [...text].every((char, i) => bytes[at + i] === char.charCodeAt(0));

/** ID3v2 タグの長さ（頭に無ければ 0） */
const id3v2Length = (bytes: Uint8Array) => {
  if (bytes.length < 10 || !ascii(bytes, 0, "ID3")) return 0;
  // 長さは 7 ビットずつの 4 バイト（syncsafe）。フッターがあれば 10 バイト足す
  const size =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);
  const footer = (bytes[5] & 0x10) !== 0 ? 10 : 0;
  return Math.min(bytes.length, 10 + size + footer);
};

/**
 * フレームだけを取り出す（ID3 タグと、最初のフレームの Xing / Info / VBRI ヘッダーを落とす）
 */
export const mp3Frames = (data: ArrayBuffer): Uint8Array => {
  const bytes = new Uint8Array(data);
  let start = id3v2Length(bytes);
  let end = bytes.length;
  if (end - start >= ID3V1_SIZE && ascii(bytes, end - ID3V1_SIZE, "TAG")) {
    end -= ID3V1_SIZE;
  }
  const first = readFrameHeader(bytes, start);
  if (first && start + first.length <= end) {
    const xing = start + first.xingOffset;
    if (
      ascii(bytes, xing, "Xing") ||
      ascii(bytes, xing, "Info") ||
      ascii(bytes, start + 36, "VBRI")
    ) {
      start += first.length;
    }
  }
  return bytes.subarray(start, end);
};

/** 片をつないで 1 本の MP3 にする */
export const concatMp3 = (parts: readonly ArrayBuffer[]): ArrayBuffer => {
  const frames = parts.map(mp3Frames);
  const out = new Uint8Array(
    frames.reduce((total, part) => total + part.length, 0),
  );
  let at = 0;
  for (const part of frames) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
};
