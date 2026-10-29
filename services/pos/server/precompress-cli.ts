// node build/node/precompress-cli.cjs <ディレクトリ>（services/pos/Dockerfile が使う）
import { resolve } from "node:path";
import { precompressDirectory } from "./precompress";

const root = resolve(process.argv[2] ?? "build/client");
precompressDirectory(root).then(
  (count) => console.log(`${root} に圧縮版を ${count} 個作った`),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
