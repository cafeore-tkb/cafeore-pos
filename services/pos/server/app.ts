// POS の画面を返す web のサーバー（Cloud Run の cafeore-pos-web）。Workers の worker/index.ts と assets に当たる。
//
//   - `/call-voice/*` … 呼び出しの音声（worker/call-voice.ts の handleCallVoice をそのまま使う。溜めるのは GCS。server/gcs.ts）
//   - `/session-check` … 204 を返すだけ。画面がログインのセッションを確かめる（useOnlineStatus）。
//     LB の IAP の内側にあり、セッションが切れていれば IAP が 401 を返すので、ここには来ない
//   - それ以外 … build/client の静的ファイルと、SPA のフォールバック（server/static.ts）
//
// `/api/*`・`/status`・`/health` は、LB が api（Cloud Run の cafeore-pos-prod）へ回すので、ここには来ない前提。
// 来たら LB の設定の間違いなので、中継も index.html も返さずに 404 にして気づけるようにする。
//
// 依存は足さず、node:http で書いている。経路はこれだけで、静的ファイルはキャッシュとフォールバックの決まりを
// 自分で書く必要があり、handleCallVoice に渡す Request（GET だけで本文が無い）と返ってきた Response の
// 詰め替えも数行で済むため。Request・Response・fetch・crypto.subtle は Node 22 にそのままある。

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { type CallVoiceEnv, handleCallVoice } from "../worker/call-voice";
import { type StaticFiles, resolveStaticFile, sendStaticFile } from "./static";

export interface WebServerOptions {
  files: StaticFiles;
  env: CallVoiceEnv;
}

const CALL_VOICE_PREFIX = "/call-voice/";
const SESSION_CHECK_PATH = "/session-check";
// LB が api に回すもの（infra の LB の経路と揃える）
const API_PATH = /^\/(?:api(?:\/|$)|status$|health$)/;

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-length", Buffer.byteLength(text));
  res.end(text);
};

const methodNotAllowed = (res: ServerResponse) => {
  res.setHeader("allow", "GET, HEAD");
  sendJson(res, 405, { error: "GET と HEAD だけを受け付けます" });
};

/** Web の Response を Node の応答に詰め替える */
const sendResponse = async (
  req: IncomingMessage,
  res: ServerResponse,
  response: Response,
) => {
  const body = Buffer.from(await response.arrayBuffer());
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.setHeader("content-length", body.length);
  res.end(req.method === "HEAD" ? undefined : body);
};

/**
 * handleCallVoice を走らせ、ctx.waitUntil に渡されたもの（GCS に溜めるところ）が**終わってから**返す。
 *
 * Workers は応答を返した後も waitUntil の分を走らせてくれるが、Cloud Run（リクエストごとの課金）は
 * 応答を返すと CPU をほとんど止めるので、返した後に溜めようとすると終わらないことがある。
 * 溜めていない片を作ったときだけ、溜める分だけ応答が遅れる（溜めるのにも上限がある。server/gcs.ts）。
 */
export const callVoice = async (request: Request, env: CallVoiceEnv) => {
  const pending: Promise<unknown>[] = [];
  const response = await handleCallVoice(request, env, {
    waitUntil: (promise) => {
      pending.push(promise);
    },
  });
  // call-voice.ts の側で失敗はログに残してあるので、ここでは待つだけ
  await Promise.allSettled(pending);
  return response;
};

const handle = async (
  req: IncomingMessage,
  res: ServerResponse,
  { files, env }: WebServerOptions,
) => {
  // Host は使わない（見るのはパスとクエリだけ）
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname.startsWith(CALL_VOICE_PREFIX)) {
    let request: Request;
    try {
      request = new Request(url, { method: req.method });
    } catch {
      // Request にできないメソッド（TRACE など）
      return methodNotAllowed(res);
    }
    return sendResponse(req, res, await callVoice(request, env));
  }

  if (url.pathname === SESSION_CHECK_PATH) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return methodNotAllowed(res);
    }
    res.statusCode = 204;
    res.setHeader("cache-control", "no-store");
    res.end();
    return;
  }

  if (API_PATH.test(url.pathname)) {
    return sendJson(res, 404, {
      error: "このサーバーは API を中継しない（LB の経路を確かめる）",
    });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return methodNotAllowed(res);
  }
  const found = resolveStaticFile(files, url.pathname);
  if (!found) {
    res.statusCode = 404;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    // デプロイの途中で消えたアセットなど。直ったときにすぐ取り直せるよう、覚えさせない
    res.setHeader("cache-control", "no-store");
    res.end("Not Found");
    return;
  }
  return sendStaticFile(req, res, found.path, found.file);
};

export const createWebServer = (options: WebServerOptions) =>
  http.createServer((req, res) => {
    handle(req, res, options).catch((error) => {
      console.error("web: 応答を返せなかった", req.method, req.url, error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "サーバーで失敗しました" });
      } else {
        res.destroy();
      }
    });
  });
