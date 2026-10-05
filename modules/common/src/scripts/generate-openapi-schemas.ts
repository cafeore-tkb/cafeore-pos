import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

// openapi.yaml の components.schemas を JSON にする。
// 一括取り込みはこれを ajv に渡して検証するので、ルールは openapi.yaml にだけ書く。

const openapiPath = fileURLToPath(
  new URL("../../../../openapi/openapi.yaml", import.meta.url),
);
const outPath = fileURLToPath(
  new URL("../types/openapi-schemas.json", import.meta.url),
);

export const readOpenapiSchemas = (): Record<string, unknown> =>
  parse(readFileSync(openapiPath, "utf-8")).components.schemas;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(outPath, `${JSON.stringify(readOpenapiSchemas(), null, 2)}\n`);
  console.log(`${outPath} を書き出しました`);
}
