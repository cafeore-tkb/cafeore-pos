// POS の画面を Cloud Run で配るサーバー（本番だけ。PR のプレビューは今までどおり Workers）。
// esbuild で 1 つのファイルにまとめて（package.json の build:server）、services/pos/Dockerfile の
// イメージで動かす。中身は server/app.ts。
//
// 環境変数（Cloud Run のサービスに入れる）:
//   - PORT … 待ち受けるポート。Cloud Run が入れる。無ければ 8080
//   - CALL_VOICES_BUCKET … 呼び出しの音声を溜める GCS のバケットの名前。無ければ溜めずに毎回作る
//     （Worker の R2 が無いときと同じ）
//   - ELEVENLABS_API_KEY … 呼び出しの音声を作る ElevenLabs の鍵（Secret Manager から入れる）。
//     無ければ /call-voice は 503 を返し、呼び出し画面はチャイムだけになる（Worker と同じ）

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { Storage } from "@google-cloud/storage";
import type { CallVoiceEnv } from "../worker/call-voice";
import { createApp } from "./app";
import { gcsCallVoiceBucket } from "./gcs-bucket";

/** Cloud Run は SIGTERM から 10 秒で止める。その前に自分で終わる */
const SHUTDOWN_TIMEOUT_MS = 8_000;

const port = Number(process.env.PORT) || 8080;
// まとめたファイル（build/node/main.cjs）から見た build/client
const root = resolve(__dirname, "../client");
if (!existsSync(join(root, "index.html"))) {
  console.error(`${root} に index.html が無い。画面をビルドしてから起動する`);
  process.exit(1);
}

const bucketName = process.env.CALL_VOICES_BUCKET || undefined;
const callVoice: CallVoiceEnv = {
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || undefined,
  CALL_VOICES: bucketName
    ? gcsCallVoiceBucket(
        new Storage({
          // 1 回の読み書きの上限と、やり直しの上限（既定は 10 分までやり直す）。
          // 呼び出しの音声はそこまで待てないので短くする
          timeout: 10_000,
          retryOptions: { maxRetries: 2, totalTimeout: 20 },
        }).bucket(bucketName),
      )
    : undefined,
};
if (!bucketName) {
  console.warn(
    "CALL_VOICES_BUCKET が無いので、呼び出しの音声は溜めずに毎回 ElevenLabs で作る",
  );
}
if (!callVoice.ELEVENLABS_API_KEY) {
  console.warn(
    "ELEVENLABS_API_KEY が無いので、溜めていない呼び出しの音声は作れない（チャイムだけになる）",
  );
}

const server = createServer(createApp({ root, callVoice }));
server.listen(port, "0.0.0.0", () => {
  console.log(`${root} を :${port} で配る`);
});

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(
    `${signal} を受けた。受け付けを止め、処理中のリクエストが終わるのを待つ`,
  );
  // 新しい接続を断り、何もしていない keep-alive の接続を閉じる。処理中のものは終わるまで待つ
  server.close((error) => {
    if (error) console.error(error);
    process.exit(error ? 1 : 0);
  });
  server.closeIdleConnections();
  setTimeout(() => {
    console.error(`${SHUTDOWN_TIMEOUT_MS}ms 待っても終わらなかったので切る`);
    server.closeAllConnections();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
