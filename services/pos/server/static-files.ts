// 画面の静的ファイル（build/client）を返す（Cloud Run のサーバー。server/main.ts）。
//
// ファイルを返すのは send（Express の serve-static の中身）に任せる。Range（Safari の動画は
// Range で取りに来て、206 が返らないと流れない）、If-None-Match / If-Modified-Since の 304、
// If-Range、HEAD、パスの .. や %2e%2e での抜け出し、ドットファイルを、長く使われてきた実装で
// 正しく扱える。sirv も比べたが、Range の解釈が雑（bytes=-500 や bytes=0-0 を取り違える）だった。
//
// ## 無いパスの扱い（SPA のフォールバック）
//
// Workers（wrangler.jsonc の not_found_handling: "single-page-application"）は、run_worker_first を
// 配列で書いていると Sec-Fetch-Mode を見ずに、無いパスにはすべて index.html を 200 で返す。
// ここでもおおむね同じにするが、次のものだけは 404 にする（shouldFallbackToIndex）。
//
//   - /assets/ の下。Vite がハッシュ付きの名前で出すところで、無いのはデプロイで消えた古いもの。
//     index.html を返すと、JS として読まれて分かりにくい壊れ方をする
//   - 画面を開くリクエスト（Sec-Fetch-Mode: navigate か Accept に text/html）でなく、最後の部分に
//     . があるもの（/apple-touch-icon.png など、ブラウザが勝手に取りに来るファイル）
//
// ## 圧縮
//
// Cloudflare は自分で圧縮して返していた。GCP の LB の圧縮（バックエンドの compressionMode）には
// 頼らず、ビルドのときに .br・.gz を作っておき（server/precompress.ts）、Accept-Encoding に
// 合わせてそちらを返す。JS・CSS は合わせて 3MB ほどあり、圧縮すると 4 分の 1 ほどになる。

import { readdirSync } from "node:fs";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "node:http";
import { extname, join, relative, sep } from "node:path";
import mime from "mime-types";
import send from "send";

/** Vite がハッシュ付きの名前で出すところ（build.assetsDir の既定）。中身が変われば名前が変わる */
const HASHED_PREFIX = "/assets/";

/** ハッシュ付きのものは 1 年持たせる。それ以外（index.html など）は毎回確かめさせる */
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
export const REVALIDATE_CACHE = "no-cache";

/** 前もって作った圧縮版。好む順（Brotli の方が小さい） */
const ENCODINGS = [
  { encoding: "br", suffix: ".br" },
  { encoding: "gzip", suffix: ".gz" },
] as const;
type Encoding = (typeof ENCODINGS)[number]["encoding"];

/** Accept-Encoding がその形式を受け取ると言っているか（q=0 は断り） */
export const acceptsEncoding = (
  header: string | undefined,
  encoding: string,
): boolean =>
  (header ?? "").split(",").some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (name.trim() !== encoding) return false;
    const q = params
      .map((param) => param.trim())
      .find((p) => p.startsWith("q="));
    return q === undefined || Number(q.slice(2)) > 0;
  });

/** 無いパスに index.html を返すか（上の「無いパスの扱い」） */
export const shouldFallbackToIndex = (
  pathname: string,
  headers: IncomingHttpHeaders,
): boolean => {
  if (pathname.startsWith(HASHED_PREFIX)) return false;
  const isNavigation =
    headers["sec-fetch-mode"] === "navigate" ||
    (headers.accept ?? "").includes("text/html");
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return isNavigation || !lastSegment.includes(".");
};

/** root の中で、圧縮版（.br・.gz）が並べてあるファイル。鍵は URL のパス（/assets/x.js） */
const findPrecompressed = (root: string) => {
  const files = new Set(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map(
        (entry) =>
          `/${relative(root, join(entry.parentPath, entry.name)).split(sep).join("/")}`,
      ),
  );
  const found = new Map<string, Encoding[]>();
  for (const file of files) {
    const encodings = ENCODINGS.filter(({ suffix }) =>
      files.has(file + suffix),
    ).map(({ encoding }) => encoding);
    if (encodings.length > 0) found.set(file, encodings);
  }
  return found;
};

const decodePath = (pathname: string) => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
};

export const sendText = (
  res: ServerResponse,
  status: number,
  text: string,
  headers: Record<string, string> = {},
) => {
  if (res.headersSent) {
    // ファイルを送っている途中で読めなくなった。もう直せないので切る
    res.destroy();
    return;
  }
  for (const name of res.getHeaderNames()) res.removeHeader(name);
  const body = Buffer.from(`${text}\n`);
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": body.byteLength,
    "cache-control": "no-store",
    ...headers,
  });
  res.end(body);
};

/**
 * build/client を返すハンドラー。GET・HEAD だけを渡すこと。
 * ファイルの一覧（圧縮版があるか）は起動したときに一度だけ読む。中身はイメージに焼いてあり変わらない
 */
export const createStaticFiles = (root: string) => {
  const precompressed = findPrecompressed(root);

  const serveFile = (
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    onNotFound: () => void,
  ) => {
    const decoded = decodePath(pathname);
    const variants = (decoded && precompressed.get(decoded)) || [];
    const encoding = variants.find((candidate) =>
      acceptsEncoding(req.headers["accept-encoding"], candidate),
    );
    const suffix = ENCODINGS.find((e) => e.encoding === encoding)?.suffix ?? "";

    send(req, pathname + suffix, {
      root,
      // ディレクトリの一覧も index.html も出さない（/ は呼ぶ側で /index.html にする）
      index: false,
      dotfiles: "ignore",
      etag: true,
      lastModified: true,
      // Cache-Control は下の headers で決める
      cacheControl: false,
    })
      .on("headers", (response: ServerResponse) => {
        response.setHeader(
          "Cache-Control",
          pathname.startsWith(HASHED_PREFIX)
            ? IMMUTABLE_CACHE
            : REVALIDATE_CACHE,
        );
        if (variants.length > 0) {
          // 同じ URL でも Accept-Encoding で中身が変わることを、途中のキャッシュに伝える
          response.setHeader("Vary", "Accept-Encoding");
        }
        if (encoding) {
          // send は .br の拡張子から型を決めてしまうので、元のファイルの型を先に入れる
          response.setHeader("Content-Encoding", encoding);
          response.setHeader(
            "Content-Type",
            mime.contentType(extname(pathname)) || "application/octet-stream",
          );
        }
      })
      .on("directory", () => onNotFound())
      .on(
        "error",
        (error: { status?: number; headers?: Record<string, string> }) => {
          if (error.status === 404) {
            onNotFound();
            return;
          }
          // 403（.. で抜け出そうとした）・412・416（Range が範囲外。Content-Range を付ける）など
          const status = error.status ?? 500;
          if (status >= 500)
            console.error("static: ファイルを返せなかった", error);
          sendText(res, status, `${status}`, error.headers);
        },
      )
      .pipe(res);
  };

  return (req: IncomingMessage, res: ServerResponse, pathname: string) => {
    const target = pathname === "/" ? "/index.html" : pathname;
    serveFile(req, res, target, () => {
      if (!shouldFallbackToIndex(pathname, req.headers)) {
        sendText(res, 404, "Not Found");
        return;
      }
      serveFile(req, res, "/index.html", () => {
        console.error("static: index.html が無い", { root });
        sendText(res, 500, "index.html is missing");
      });
    });
  };
};
