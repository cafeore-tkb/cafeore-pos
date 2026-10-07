import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const POS_API_DEFAULT_BASE_URL =
  "https://cafeore-pos-git-czojooivca-an.a.run.app";

export default defineConfig(() => {
  return {
    base: process.env.VITE_BASE_PATH || "/",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    // ほかのサービスと同じく build/ に出す（git と biome の対象外）
    build: { outDir: "build" },
    server: {
      // 開発中は cafeore-pos の API へ同じ origin から中継する。API は FRONTEND_ORIGINS に無い
      // origin を WebSocket でも 403 で弾くので、中継時に Origin を外して localhost からつなげるようにする。
      proxy: {
        "/cafeore-pos-api": {
          target:
            process.env.VITE_CAFEORE_API_BASE_URL || POS_API_DEFAULT_BASE_URL,
          changeOrigin: true,
          ws: true,
          rewrite: (requestPath) =>
            requestPath.replace(/^\/cafeore-pos-api/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => proxyReq.removeHeader("origin"));
            proxy.on("proxyReqWs", (proxyReq) =>
              proxyReq.removeHeader("origin"),
            );
          },
        },
      },
    },
  };
});
