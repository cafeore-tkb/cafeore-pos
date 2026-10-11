// data/caosBrewTimes.ts
import useSWR from "swr";
import type { CaosBrewTimes } from "../lib/caos-board";
import { getCaosBrewTimes } from "../repositories/caos";

const CAOS_BREW_TIMES_KEY = "caos-brew-times";

// 「次へ」で終えるたびに変わるが配信はしていないので、開いている間は定期的に取り直す
const CAOS_BREW_TIMES_REFRESH_MS = 60 * 1000;

const NO_TIMES: CaosBrewTimes = [];

/** CaOS の抽出時間の実測（杯数ごと）。読めないあいだは空（初めの値を使う） */
export const useCaosBrewTimes = () => {
  const { data } = useSWR(CAOS_BREW_TIMES_KEY, getCaosBrewTimes, {
    refreshInterval: CAOS_BREW_TIMES_REFRESH_MS,
  });
  return data ?? NO_TIMES;
};
