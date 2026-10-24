// web のサーバーの入口。`pnpm run build:server` で build/web-server.mjs に束ね、Dockerfile がそれを動かす。
//
// env:
//   - PORT … 待つポート。Cloud Run が入れる（既定 8080）
//   - CALL_VOICE_BUCKET … 呼び出しの音声を溜める GCS のバケット（Terraform が入れる）。無ければ溜めない
//   - ELEVENLABS_API_KEY … 呼び出しの音声を作る ElevenLabs の鍵（Terraform が Secret Manager から入れる）。
//     無ければ溜めていない片は作れず、呼び出し画面はチャイムだけになる
//
// 手元では `pnpm run build && pnpm run build:server` のあと `node build/web-server.mjs`。

import { fileURLToPath } from "node:url";
import type { CallVoiceEnv } from "../worker/call-voice";
import { createWebServer } from "./app";
import { gcsBucket } from "./gcs";
import { loadStaticFiles } from "./static";

/** SIGTERM のあと、これだけ待っても終わらないリクエストは切る（Cloud Run は 10 秒後に止める） */
const SHUTDOWN_TIMEOUT_MS = 8_000;

const port = Number(process.env.PORT) || 8080;
// 束ねた build/web-server.mjs の隣の client/（Dockerfile も同じ並びにコピーする）
const root = fileURLToPath(new URL("./client/", import.meta.url));

const bucket = process.env.CALL_VOICE_BUCKET || undefined;
const env: CallVoiceEnv = {
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || undefined,
  CALL_VOICES: bucket ? gcsBucket(bucket) : undefined,
};
if (!bucket) {
  console.warn("web: CALL_VOICE_BUCKET が無いので、呼び出しの音声を溜めない");
}
if (!env.ELEVENLABS_API_KEY) {
  console.warn(
    "web: ELEVENLABS_API_KEY が無いので、溜めていない呼び出しの音声は作れない",
  );
}

const files = await loadStaticFiles(root);
const server = createWebServer({ files, env });

server.listen(port, () => {
  console.log(`web: ${port} で待っている（${files.size} 個のファイル）`);
});

const shutdown = (signal: string) => {
  console.log(`web: ${signal} を受けたので閉じる`);
  // 新しい接続を受けず、走っているリクエストが終わったら抜ける（待っている keep-alive の接続は閉じる）
  server.close((error) => {
    process.exit(error ? 1 : 0);
  });
  setTimeout(() => {
    console.warn("web: 終わらないリクエストを切って閉じる");
    server.closeAllConnections();
    process.exit(0);
  }, SHUTDOWN_TIMEOUT_MS).unref();
};
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
