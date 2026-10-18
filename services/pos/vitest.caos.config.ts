import { defineConfig } from "vitest/config";

// ブラウザー制御の単体確認ではReact Routerの開発用ファイル監視を起動しない。
export default defineConfig({ test: { environment: "node" } });
