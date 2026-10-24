// build/client（react-router build の出力）を返す。Workers の assets の代わり（wrangler.jsonc）。
//
// ## どのファイルを返すか
//
// 起動したときに build/client の中を一度だけ見て、ファイルの一覧（URL のパス → ファイル）を作り、
// **一覧にあるものだけを返す。** リクエストのパスからファイルのパスを組み立てないので、
// `..` や `%2F` を混ぜても build/client の外は読めない（パストラバーサルを防ぐ）。
// 名前が . で始まるもの（.env など）は一覧に入れない。中身はイメージに焼いてあり、動いている間は変わらない。
//
// ## SPA のフォールバック
//
// Workers の not_found_handling: single-page-application に当たる。一覧に無いパスは
//
//   - `/assets/` の下か、最後の段に拡張子がある（`/favicon.png`・`/assets/x-1a2b.js` など）… 404
//   - それ以外（`/cashier`・`/products` など、画面の URL）… index.html
//
// Workers は無いパスにはどれも index.html を返していたが、ファイルを取りに来たものに HTML を 200 で返すと、
// 古い画面がデプロイで消えたアセットを読んだときに HTML を JS として読んで分かりにくい壊れ方をし、
// `/assets/` の下なら下のとおり 1 年キャッシュされてしまう。画面の URL に `.` を含むものは今は無い
// （app/routes）。足すときはここを見直すこと。
//
// ## キャッシュ
//
//   - index.html（フォールバックも）… no-cache。開くたびに ETag で確かめ、デプロイしたら次に開いたときに新しい画面になる
//   - `/assets/` … ファイル名に中身のハッシュが付いていて、中身が変わると名前も変わるので、1 年 immutable。
//     public ではなく private にしている。IAP の内側のもので、JS にはログインした人にだけ見せる値
//     （VITE_WEBHOOK_URL など）も入っているため。前に共有のキャッシュ（CDN）は置いていない
//   - それ以外（public/ の favicon.ico・epos-2.27.0.js・images/ など。名前が変わらない）… no-cache
//
// ETag は中身のハッシュ。ファイルの時刻や大きさから作ると、ビルドが違っても同じ値になりえて、
// 古い index.html が 304 で残り続けるおそれがあるため。初めて返すときに計算して覚えておく。
//
// ## 圧縮
//
// Cloud Run は圧縮しない（LB で圧縮するかは infra の設定次第）ので、ここで br か gzip にする。
// JS と CSS で 2.7 MB ほどあり、br で 3 割ほどになる。テキストのものだけを、初めて返すときに圧縮して覚えておく
// （どれも 1 MB 足らずで、合わせても数 MB）。woff2・画像・音声・動画は元から圧縮されているので、そのまま返す。
// br の強さは 5。JS と CSS を全部圧縮しても 0.1 秒ほどで、9 にしても 2% ほどしか小さくならず、7 倍ほど掛かる。
//
// 動画（public/callscreen-cm.mp4 など）は Safari が Range で取りに来て、206 を返さないと流さないので、
// 圧縮しないものには Range（bytes=a-b の 1 つだけ）にも応える。

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import zlib from "node:zlib";

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

export const INDEX_HTML = "/index.html";
const ASSETS_PREFIX = "/assets/";

const CACHE_INDEX = "no-cache";
const CACHE_ASSET = "private, max-age=31536000, immutable";
const CACHE_OTHER = "no-cache";

/** これより小さいものは圧縮しても得が無い */
const COMPRESS_MIN_BYTES = 1024;
/** これより大きいものは圧縮して覚えておかない（メモリを使いすぎないため。今は該当するものが無い） */
const COMPRESS_MAX_BYTES = 8 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
};

const COMPRESSIBLE =
  /^(?:text\/|application\/(?:json|manifest\+json|xml)|image\/svg\+xml|image\/x-icon)/;

type Encoding = "br" | "gzip";

interface StaticFile {
  /** ディスク上のパス */
  file: string;
  size: number;
  contentType: string;
  compressible: boolean;
  etag?: Promise<string>;
  compressed: Map<Encoding, Promise<Buffer>>;
}

export type StaticFiles = Map<string, StaticFile>;

/** build/client の中のファイルの一覧（URL のパス → ファイル）。index.html が無ければ起動させない */
export const loadStaticFiles = async (root: string): Promise<StaticFiles> => {
  const files: StaticFiles = new Map();
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    // シンボリックリンクは追わない（build/client には無い）
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    const segments = path.relative(root, full).split(path.sep);
    if (segments.some((segment) => segment.startsWith("."))) continue;
    const contentType =
      CONTENT_TYPES[path.extname(entry.name).toLowerCase()] ??
      "application/octet-stream";
    const { size } = await stat(full);
    files.set(`/${segments.join("/")}`, {
      file: full,
      size,
      contentType,
      compressible: COMPRESSIBLE.test(contentType),
      compressed: new Map(),
    });
  }
  if (!files.has(INDEX_HTML)) {
    throw new Error(
      `${root} に index.html が無い（pnpm run build を先に走らせる）`,
    );
  }
  return files;
};

/** 一覧に無いパスのうち、ファイルを取りに来たとみなして 404 にするもの（上の「SPA のフォールバック」） */
export const looksLikeFile = (pathname: string) =>
  pathname.startsWith(ASSETS_PREFIX) ||
  /\.[A-Za-z0-9]+$/.test(pathname.slice(pathname.lastIndexOf("/") + 1));

/** URL のパスに当たるファイル。無ければ SPA の index.html、ファイルらしいパスなら null */
export const resolveStaticFile = (
  files: StaticFiles,
  pathname: string,
): { path: string; file: StaticFile } | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // 壊れた %xx。一覧のどれにも当たらないので、パスの形だけで決める
    decoded = pathname;
  }
  const file = files.get(decoded);
  if (file) return { path: decoded, file };
  if (looksLikeFile(decoded)) return null;
  const index = files.get(INDEX_HTML);
  return index ? { path: INDEX_HTML, file: index } : null;
};

const cacheControlFor = (urlPath: string) => {
  if (urlPath === INDEX_HTML) return CACHE_INDEX;
  if (urlPath.startsWith(ASSETS_PREFIX)) return CACHE_ASSET;
  return CACHE_OTHER;
};

const etagOf = (file: StaticFile) => {
  file.etag ??= (async () => {
    const hash = createHash("sha256");
    await pipeline(createReadStream(file.file), hash);
    return `"${hash.digest("base64url").slice(0, 27)}"`;
  })();
  // 失敗したら覚えず、次に返すときにまた計算する
  file.etag.catch(() => {
    file.etag = undefined;
  });
  return file.etag;
};

const compressedOf = (file: StaticFile, encoding: Encoding) => {
  let body = file.compressed.get(encoding);
  if (!body) {
    body = readFile(file.file).then((raw) =>
      encoding === "br"
        ? brotli(raw, {
            params: {
              [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
              [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
            },
          })
        : gzip(raw),
    );
    file.compressed.set(encoding, body);
    body.catch(() => file.compressed.delete(encoding));
  }
  return body;
};

/** Accept-Encoding で受け付けているか（q=0 は受け付けない扱い） */
const accepts = (header: string | undefined, encoding: Encoding) =>
  (header ?? "").split(",").some((part) => {
    const [name, ...params] = part.split(";").map((s) => s.trim());
    if (name.toLowerCase() !== encoding) return false;
    const q = params.find((param) => param.startsWith("q="));
    return q === undefined || Number(q.slice(2)) > 0;
  });

const pickEncoding = (req: IncomingMessage, file: StaticFile) => {
  if (
    !file.compressible ||
    file.size < COMPRESS_MIN_BYTES ||
    file.size > COMPRESS_MAX_BYTES
  ) {
    return null;
  }
  const header = req.headers["accept-encoding"];
  if (accepts(header, "br")) return "br";
  if (accepts(header, "gzip")) return "gzip";
  return null;
};

/** If-None-Match に当たるか（W/ の有無は見ない） */
const matchesEtag = (header: string | undefined, etag: string) =>
  (header ?? "")
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);

/** Range: bytes=a-b（1 つだけ）。受け付けない形なら null（全部を返す）、範囲が外れていれば "unsatisfiable" */
export const parseRange = (
  header: string | undefined,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null => {
  const match = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, from, to] = match;
  if (from === "" && to === "") return null;
  if (from === "") {
    const suffix = Number(to);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(from);
  const end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
};

/** ファイルを返す（GET と HEAD） */
export const sendStaticFile = async (
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  file: StaticFile,
) => {
  const encoding = pickEncoding(req, file);
  const baseEtag = await etagOf(file);
  // 圧縮したものは別の中身なので、ETag も分ける
  const etag = encoding ? `${baseEtag.slice(0, -1)}-${encoding}"` : baseEtag;

  res.setHeader("content-type", file.contentType);
  res.setHeader("cache-control", cacheControlFor(urlPath));
  res.setHeader("etag", etag);
  res.setHeader("x-content-type-options", "nosniff");
  if (file.compressible) res.setHeader("vary", "accept-encoding");

  if (matchesEtag(req.headers["if-none-match"], etag)) {
    res.statusCode = 304;
    res.end();
    return;
  }

  if (encoding) {
    const body = await compressedOf(file, encoding);
    res.setHeader("content-encoding", encoding);
    res.setHeader("content-length", body.length);
    res.end(req.method === "HEAD" ? undefined : body);
    return;
  }

  res.setHeader("accept-ranges", "bytes");
  // If-Range が今の中身と違えば、範囲ではなく全部を返す
  const ifRange = req.headers["if-range"];
  const range =
    ifRange === undefined || ifRange === etag
      ? parseRange(req.headers.range, file.size)
      : null;
  if (range === "unsatisfiable") {
    res.statusCode = 416;
    res.setHeader("content-range", `bytes */${file.size}`);
    res.end();
    return;
  }
  const { start, end } = range ?? { start: 0, end: file.size - 1 };
  if (range) {
    res.statusCode = 206;
    res.setHeader("content-range", `bytes ${start}-${end}/${file.size}`);
  }
  res.setHeader("content-length", Math.max(0, end - start + 1));
  if (req.method === "HEAD" || file.size === 0) {
    res.end();
    return;
  }
  try {
    await pipeline(createReadStream(file.file, { start, end }), res);
  } catch (error) {
    // 受け取る側が途中で切った（動画を飛ばしたときなど）。よくあることなので失敗として扱わない
    if ((error as { code?: string }).code === "ERR_STREAM_PREMATURE_CLOSE") {
      return;
    }
    throw error;
  }
};
