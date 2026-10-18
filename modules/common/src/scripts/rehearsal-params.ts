// 過去の注文 JSON から、オペ練の注文生成器のパラメータを書き出す。
//
//   pnpm common rehearsal-params <出力.json> <注文.json>...
//
// 注文 JSON は `{ orders: [...] }`（トップの「オーダーデータ書き出し」の JSON と同じ形）。祭 4 日ぶんを渡す。
// 品目の種類（items[].type）で注文の組を数えるので、type の入った JSON を渡す。
// 例（sohosai-analysis のデータ）：
//
//   pnpm common rehearsal-params rehearsal-params.json \
//     ~/workspace/sohosai-analysis/2024/data/raw_day12.json \
//     ~/workspace/sohosai-analysis/2025/data/day12.json
//
// 2024 年祭は raw_day12.json を使う（day12.json は 1 件少なく、解析側の 1766 件と合わない）。
//
// **出力はコミットしない。** 注文間隔そのものが入っており、注文データをオープンにしない
// sohosai-analysis の方針に合わせる（.gitignore 済み）。
//
// 確かめるための要約を標準出力に出す。到着（層の境界・間隔）は sohosai-analysis の
// docs/python-track.md §12 の表と同じ数値になるはず。中身は種類で数えるので、向こうの
// 役割カテゴリの組の数とは合わない。

import * as fs from "node:fs";
import { type RawOrder, fitParams } from "../rehearsal/params";

/** 祭の開催日。練習・リハーサルは本番の代表性が無いので入れない */
const FESTIVAL_DATES = ["2024-11-03", "2024-11-04", "2025-11-02", "2025-11-03"];

const [output, ...inputs] = process.argv.slice(2);
if (!output || inputs.length === 0) {
  console.error("使い方: rehearsal-params <出力.json> <注文.json>...");
  process.exit(1);
}

const orders: RawOrder[] = inputs.flatMap(
  (path) =>
    (JSON.parse(fs.readFileSync(path, "utf-8")) as { orders: RawOrder[] })
      .orders,
);
const params = fitParams(orders, FESTIVAL_DATES);

const round = (x: number, digits: number) => Number(x.toFixed(digits));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const cv = (xs: number[]) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance =
    xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance) / mean;
};

console.log(
  `注文 ${params.source.orders} 件（${params.source.dates.join(", ")}）`,
);
console.log(
  `層の境界 [件/分]: ${params.edges.map((e) => round(e, 2)).join(" / ")}`,
);
console.table(
  params.gapsByStratum.map((gaps, stratum) => ({
    stratum,
    n: gaps.length,
    min_sec: round(Math.min(...gaps), 1),
    median_sec: round(median(gaps), 1),
    cv: round(cv(gaps), 3),
  })),
);
console.log(
  `注文の組 ${params.baskets.length} 種類（種類: ${[...new Set(params.items.map((i) => i.type))].join(", ")}）`,
);
console.table(
  params.days.map((day) => ({
    date: day.date,
    open: day.openAt,
    minutes: round(day.durationMin, 1),
    bins: day.binRates.length,
  })),
);

fs.writeFileSync(output, `${JSON.stringify(params)}\n`);
console.log(`書き出した: ${output}`);
