#!/usr/bin/env node
// CaOS の実データテストのデータを、private のリポジトリ cafeore-tkb/sohosai-analysis から取ってきて、
// 担当者名・指名・コメントを落として POS のビルドに入れる（services/pos/public/caos-practice/）。
//
//   node scripts/caos-practice-data/build.mjs      （POS の build の最初に呼ばれる。pnpm pos practice-data でも同じ）
//
// 取ってくるもの：sohosai-analysis の年のフォルダ（2024・2025・…）ごとの data/day*.json（raw_ の付かない、ダミーを除いたもの）。
// day12.json と day1.json・day2.json のように同じ注文が重なっても 1 件にまとめる。年のフォルダを足せば、そのまま入る。
//
// 読み方（上から順に、あるものを使う）：
//   1. SOHOSAI_ANALYSIS_DIR：手元の clone のパス（GitHub に問い合わせない）
//   2. SOHOSAI_ANALYSIS_TOKEN：sohosai-analysis を読めるトークン（CI では Actions の Secret）
//   3. gh auth token（手元で gh にログインしていれば）
// どれも無い・読めないときは、データを作らずに終わる（ビルドは止めない。画面の「実データテスト」は「データがありません」になる）。
// 前に作ったデータがあれば、そのまま残す。
//
// 出力（.gitignore 済み。コミットしない）：
//   services/pos/public/caos-practice/index.json   データの一覧（年ごと）
//   services/pos/public/caos-practice/<年>.json    その年の注文（normalize.mjs で決めた項目だけ）

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoPersonalFields, mergeYear } from "./normalize.mjs";

const REPO =
  process.env.SOHOSAI_ANALYSIS_REPO || "cafeore-tkb/sohosai-analysis";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "services/pos/public/caos-practice");

const YEAR_DIR = /^\d{4}$/;
const DAY_FILE = /^day\d+\.json$/;

const inGitHubActions = process.env.GITHUB_ACTIONS === "true";
const warn = (message) => {
  console.warn(inGitHubActions ? `::warning::${message}` : `警告：${message}`);
};

// ---------------------------------------------------------------- 読み方

/** 手元の clone から読む */
const localSource = (dir) => ({
  label: dir,
  listYears: async () =>
    readdirSync(dir).filter(
      (name) => YEAR_DIR.test(name) && statSync(join(dir, name)).isDirectory(),
    ),
  listDayFiles: async (year) => {
    const data = join(dir, year, "data");
    try {
      return readdirSync(data).filter((name) => DAY_FILE.test(name));
    } catch {
      return [];
    }
  },
  read: async (year, file) =>
    readFileSync(join(dir, year, "data", file), "utf-8"),
});

/** GitHub の API で読む（private なのでトークンが要る） */
const githubSource = (token) => {
  const api = async (path, accept = "application/vnd.github+json") => {
    const response = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${path}`,
      {
        headers: {
          Accept: accept,
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "cafeore-pos-caos-practice-data",
        },
      },
    );
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`${REPO}/${path} を読めません（${response.status}）`);
    return accept === "application/vnd.github.raw"
      ? response.text()
      : response.json();
  };
  return {
    label: `github.com/${REPO}`,
    listYears: async () => {
      const entries = await api("");
      if (entries === null)
        throw new Error(
          `${REPO} が見つかりません（トークンで読めないかもしれません）`,
        );
      return entries
        .filter((entry) => entry.type === "dir" && YEAR_DIR.test(entry.name))
        .map((entry) => entry.name);
    },
    listDayFiles: async (year) => {
      const entries = await api(`${year}/data`);
      return (entries ?? [])
        .filter((entry) => entry.type === "file" && DAY_FILE.test(entry.name))
        .map((entry) => entry.name);
    },
    read: async (year, file) =>
      (await api(`${year}/data/${file}`, "application/vnd.github.raw")) ?? "",
  };
};

const ghAuthToken = () => {
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

const pickSource = () => {
  if (process.env.SOHOSAI_ANALYSIS_DIR)
    return localSource(resolve(process.env.SOHOSAI_ANALYSIS_DIR));
  const token =
    process.env.SOHOSAI_ANALYSIS_TOKEN ||
    (inGitHubActions ? "" : ghAuthToken());
  return token ? githubSource(token) : null;
};

// ---------------------------------------------------------------- 作る

const build = async (source) => {
  const datasets = [];
  const files = new Map();
  for (const year of (await source.listYears()).sort()) {
    const dayFiles = (await source.listDayFiles(year)).sort();
    const jsons = [];
    const used = [];
    for (const file of dayFiles) {
      const body = (await source.read(year, file)).trim();
      // 空のファイル（2025/data/day1.json など）は飛ばす
      if (body === "") continue;
      try {
        jsons.push(JSON.parse(body));
        used.push(file);
      } catch {
        warn(`${year}/data/${file} は JSON として読めないので飛ばします`);
      }
    }
    const { orders, skipped } = mergeYear(jsons);
    if (skipped > 0)
      warn(
        `${year} 年の注文のうち ${skipped} 件は形が読めないので飛ばしました`,
      );
    if (orders.length === 0) continue;
    assertNoPersonalFields(orders);
    const file = `${year}.json`;
    files.set(file, { id: year, label: `${year}年 雙峰祭`, orders });
    datasets.push({
      id: year,
      label: `${year}年 雙峰祭`,
      file,
      source: `${REPO} ${year}/data/${used.join("・")}`,
      orders: orders.length,
      firstAt: orders[0].createdAt,
      lastAt: orders[orders.length - 1].createdAt,
    });
  }
  return { datasets: datasets.reverse(), files };
};

const write = ({ datasets, files }) => {
  // いったん別のフォルダに書いてから入れ替える（途中で失敗しても、前のデータが半端に残らない）
  const tmp = `${OUT}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const [file, dataset] of files) {
    writeFileSync(join(tmp, file), JSON.stringify(dataset));
  }
  writeFileSync(
    join(tmp, "index.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), datasets },
      null,
      2,
    ),
  );
  rmSync(OUT, { recursive: true, force: true });
  renameSync(tmp, OUT);
};

const main = async () => {
  const source = pickSource();
  if (!source) {
    warn(
      "sohosai-analysis を読む手段がないので、実データテストのデータは作りません（SOHOSAI_ANALYSIS_TOKEN・SOHOSAI_ANALYSIS_DIR・gh auth login のどれか）",
    );
    return;
  }
  try {
    const result = await build(source);
    if (result.datasets.length === 0) {
      warn(
        `${source.label} に注文のデータが見つからないので、実データテストのデータは作りません`,
      );
      return;
    }
    write(result);
    for (const dataset of result.datasets) {
      console.log(
        `実データテスト：${dataset.label} ${dataset.orders} 件（${dataset.source}）`,
      );
    }
  } catch (error) {
    warn(
      `実データテストのデータを作れませんでした：${error instanceof Error ? error.message : error}`,
    );
  }
};

await main();
