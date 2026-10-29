import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// ブラウザー制御の単体確認ではReact Routerの開発用ファイル監視を起動しない。
export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: /^react$/,
        replacement: fileURLToPath(
          new URL("./node_modules/react/index.js", import.meta.url),
        ),
      },
      {
        find: "~",
        replacement: fileURLToPath(new URL("./app", import.meta.url)),
      },
    ],
  },
  test: { environment: "node" },
});
