// CaOS（ドリップ管制、services/caos）のビルドを POS の配信物の /master-sheet に置く。
// POS の Worker が静的アセットとして一緒に配るので、CaOS 用の Worker は持たない。
// CaOS は base を /master-sheet/ にしてビルドしてある（services/caos/vite.config.ts）。
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../../caos/build", import.meta.url));
const to = fileURLToPath(
  new URL("../build/client/master-sheet", import.meta.url),
);

if (!existsSync(`${from}/index.html`)) {
  console.error(`CaOS のビルドが見つからない: ${from}`);
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`CaOS を ${to} に置いた`);
