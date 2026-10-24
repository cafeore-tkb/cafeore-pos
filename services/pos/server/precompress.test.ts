import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { precompressDirectory } from "./precompress";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pos-precompress-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const exists = (path: string) =>
  readFile(path).then(
    () => true,
    () => false,
  );

describe("[unit] 静的ファイルの圧縮版", () => {
  test("文字のファイルの横に .br・.gz を作る。小さいものと、圧縮済みの形式は作らない", async () => {
    const js = `export const text = ${JSON.stringify("POS ".repeat(1000))};`;
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "assets", "app-abc.js"), js);
    await writeFile(join(root, "index.html"), "<!doctype html>");
    await writeFile(join(root, "assets", "font.woff2"), "x".repeat(5000));

    const count = await precompressDirectory(root);

    expect(count).toBe(2);
    const br = await readFile(join(root, "assets", "app-abc.js.br"));
    const gz = await readFile(join(root, "assets", "app-abc.js.gz"));
    expect(brotliDecompressSync(br).toString()).toBe(js);
    expect(gunzipSync(gz).toString()).toBe(js);
    expect(await exists(join(root, "index.html.br"))).toBe(false);
    expect(await exists(join(root, "assets", "font.woff2.br"))).toBe(false);
  });

  test("もう一度走らせても、圧縮版をさらに圧縮しない", async () => {
    await writeFile(join(root, "app.css"), "body{color:red}".repeat(200));
    expect(await precompressDirectory(root)).toBe(2);
    expect(await precompressDirectory(root)).toBe(2);
    expect(await exists(join(root, "app.css.br.br"))).toBe(false);
  });
});
