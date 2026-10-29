// 画面の静的ファイルの圧縮版（.br・.gz）を、ビルドのときに横に作っておく
// （Cloud Run のイメージを作るときだけ。services/pos/Dockerfile）。
// 返すときに選ぶのは server/static-files.ts。
//
// その場で圧縮するより、一度だけ最高の圧縮率で作っておく方が小さく、CPU も使わない。
// Workers の build/client には作らない（Cloudflare が自分で圧縮する）。

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { constants, brotliCompress, gzip } from "node:zlib";

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** 圧縮する拡張子。画像・動画・音声・woff/woff2 は既に圧縮されているので除く */
export const COMPRESSIBLE =
  /\.(?:js|mjs|css|html|svg|json|txt|xml|ico|map|webmanifest|wasm)$/;
/** これより小さいものは圧縮しても得にならない */
const MIN_SIZE = 1024;
/** 元の 9 割より小さくならなければ置かない */
const MAX_RATIO = 0.9;

/** root の下の圧縮できるファイルの横に .br・.gz を作る。作ったファイルの数を返す */
export const precompressDirectory = async (root: string): Promise<number> => {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && COMPRESSIBLE.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));

  const written = await Promise.all(
    files.map(async (file) => {
      const data = await readFile(file);
      if (data.byteLength < MIN_SIZE) return 0;
      const [br, gz] = await Promise.all([
        brotli(data, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
            [constants.BROTLI_PARAM_SIZE_HINT]: data.byteLength,
          },
        }),
        gzipAsync(data, { level: constants.Z_BEST_COMPRESSION }),
      ]);
      let count = 0;
      for (const [suffix, compressed] of [
        [".br", br],
        [".gz", gz],
      ] as const) {
        if (compressed.byteLength < data.byteLength * MAX_RATIO) {
          await writeFile(file + suffix, compressed);
          count++;
        }
      }
      return count;
    }),
  );
  return written.reduce((sum, count) => sum + count, 0);
};
