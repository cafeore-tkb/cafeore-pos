// Cloud Run の画面のサーバーの中身（起動は server/main.ts）。Workers の worker/index.ts と
// wrangler.jsonc の assets にあたる。
//
//   - /api/*・/status・/health … LB の URL マップが API の Cloud Run に直接送るので、ここには
//     来ないはず。来たら JSON の 404 を返す（index.html を返すと、画面が API の応答として読んで
//     分かりにくい壊れ方をする）。Worker のように中継はしない
//   - /call-voice/* … 呼び出し画面の音声。Worker と同じ worker/call-voice.ts で作る
//   - /auth/me … ログインしている相手（IAP がログインさせた Google アカウントのメール）。トップページに出す
//   - それ以外 … build/client の静的ファイル（server/static-files.ts）

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type CallVoiceContext,
  type CallVoiceEnv,
  handleCallVoice,
} from "../worker/call-voice";
import { createStaticFiles, sendText } from "./static-files";

// worker/index.ts の API_PATH・CALL_VOICE_PREFIX と揃える（/api は末尾の / が無くても API とみなす）
const API_PATH = /^\/(?:api(?:\/|$)|status$|health$)/;
const CALL_VOICE_PREFIX = "/call-voice/";
// worker/index.ts の LOGIN_USER_PATH と揃える
const LOGIN_USER_PATH = "/auth/me";

// IAP が後ろに渡すヘッダー。値は「accounts.google.com:<メール>」の形（名前空間が前に付く）。
//
// 署名は無い。api は相手を決めるのに使わず、署名のある JWT（X-Goog-IAP-JWT-Assertion）を
// 確かめる（api/internal/auth/iap.go）。ここは画面に出すだけで、誰に何を許すかには使わないので、
// JWT を確かめずにこちらを読む（確かめるには、画面の backend service の aud を infra から渡すことになる）。
// このサービスの ingress は内部と LB だけ（infra の gcp/pos_web.tf）なので、インターネットからは
// IAP を通ってきたものしか来ない。
const IAP_USER_EMAIL_HEADER = "x-goog-authenticated-user-email";

/** IAP が付けてきたメールから名前空間を外す。無ければ null */
export const loginUserEmail = (
  value: string | string[] | undefined,
): string | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  const email = raw?.replace(/^[^:@]*:/, "").trim();
  return email || null;
};

/** 溜めるのを待つ上限。GCS が詰まっても、呼び出しの音声はこれだけ待てば返る */
const WAIT_UNTIL_TIMEOUT_MS = 10_000;

export interface AppOptions {
  /** build/client */
  root: string;
  callVoice: CallVoiceEnv;
  waitUntilTimeoutMs?: number;
}

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": data.byteLength,
    "cache-control": "no-store",
  });
  res.end(data);
};

/** 待つものがすべて終わるか、timeoutMs が経つまで待つ */
const settle = async (pending: Promise<unknown>[], timeoutMs: number) => {
  if (pending.length === 0) return;
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), timeoutMs);
  });
  const done = Promise.allSettled(pending).then(() => false);
  if (await Promise.race([done, timedOut])) {
    console.error(
      `call-voice: ${timeoutMs}ms 待っても溜め終わらなかったので、待たずに返す`,
    );
  }
  clearTimeout(timer);
};

const serveCallVoice = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: AppOptions,
) => {
  // Worker の ctx.waitUntil の代わり。Cloud Run（リクエスト単位の課金）は応答を返し終えると
  // CPU を絞るので、Worker のように返した後で溜めると、溜め終わらないまま止まることがある。
  // なので溜め終わるのを待ってから返す。待つのは溜めていなかったとき（ElevenLabs で作ったとき）だけ。
  //
  // 本文を先に送ってから待つ形にはしない。Content-Length の分を送り終えた時点で、Cloud Run から
  // 見れば応答は終わっているので、やはり CPU を絞られうる。
  const pending: Promise<unknown>[] = [];
  const ctx: CallVoiceContext = {
    waitUntil: (promise) => {
      pending.push(promise);
    },
  };
  // handleCallVoice が見るのは URL（パスとクエリ）とメソッドだけ。本文もヘッダーも渡さない
  // （GET だけを受け付ける）。URL のホストは使われないので固定にしてある
  const request = new Request(url, { method: req.method });
  const response = await handleCallVoice(request, options.callVoice, ctx);
  await settle(pending, options.waitUntilTimeoutMs ?? WAIT_UNTIL_TIMEOUT_MS);

  const body = Buffer.from(await response.arrayBuffer());
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  headers["content-length"] = String(body.byteLength);
  res.writeHead(response.status, headers);
  res.end(req.method === "HEAD" ? undefined : body);
};

export const createApp = (options: AppOptions) => {
  const serveStatic = createStaticFiles(options.root);

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const target = req.url ?? "/";
    // Cloud Run から来るのは /path?query の形だけ。http://host/path などは受けない
    if (!target.startsWith("/")) {
      sendText(res, 400, "Bad Request");
      return;
    }
    // 文字列でつなぐ（//host/path を別のホストとして読ませない）
    let url: URL;
    try {
      url = new URL(`http://localhost${target}`);
    } catch {
      sendText(res, 400, "Bad Request");
      return;
    }

    if (API_PATH.test(url.pathname)) {
      console.warn(
        "この経路は API の Cloud Run に行くはず。LB の URL マップを確かめる",
        {
          method: req.method,
          path: url.pathname,
        },
      );
      sendJson(res, 404, {
        error: `${url.pathname} は API が受け持つ。画面のサーバーには来ないはず`,
      });
      return;
    }

    if (url.pathname.startsWith(CALL_VOICE_PREFIX)) {
      await serveCallVoice(req, res, url, options);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendText(res, 405, "Method Not Allowed", { allow: "GET, HEAD" });
      return;
    }

    if (url.pathname === LOGIN_USER_PATH) {
      sendJson(res, 200, {
        email: loginUserEmail(req.headers[IAP_USER_EMAIL_HEADER]),
      });
      return;
    }

    serveStatic(req, res, url.pathname);
  };

  return (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((error) => {
      console.error("リクエストを処理できなかった", error);
      if (res.headersSent) {
        res.destroy();
      } else {
        sendJson(res, 500, { error: "Internal Server Error" });
      }
    });
  };
};
