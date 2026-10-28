import type { CaosBrewModel, CaosCard } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import { predictedBrewSeconds } from "./brewPrediction";
import type { Lane } from "./lanes";
import { liberoLanes } from "./libero";
import { earlyNext, laneStatus, laneTimes, nextAvailableBays } from "./queue";

const started = new Date("2026-10-28T01:00:00Z");
const card = (key: string, active = false): CaosCard => ({
  key,
  dripId: key,
  status: active ? "brewing" : "queued",
  dripper: 1,
  dripperPosition: 1,
  startedAt: active ? started : null,
  finishedAt: null,
  cups: [{ item: { item_type: { iced_brew: false } } }] as CaosCard["cups"],
  orderNo: 1,
  nominatedDripper: null,
  seniorOnly: false,
  emergency: false,
  state: {
    dripper: 1,
    dripperPosition: 1,
    dripId: key,
    brewStartedAt: active ? started : null,
    brewFinishedAt: null,
  },
});
const estimate = (seconds: number) => ({
  seconds,
  standard_seconds: seconds,
  coefficient: 1,
  standard_samples: 4,
  person_samples: 0,
});
const model: CaosBrewModel = {
  version: "brew-v1",
  updated_at: started.toISOString(),
  standards: { hot1: estimate(250) },
  lanes: [
    {
      dripper: 1,
      name: "山田",
      grade: "B2",
      estimates: { hot1: estimate(200) },
    },
  ],
  active: [
    {
      drip_id: "a",
      started_at: started.toISOString(),
      finished_at: null,
      dripper: 1,
      kind: "hot1",
      name: "山田",
      grade: "B2",
      predicted_seconds: 180,
      standard_seconds: 200,
      coefficient: 0.9,
      standard_samples: 4,
      person_samples: 5,
      actual_seconds: null,
      excluded_reason: "",
      person_excluded_reason: "",
      model_version: "brew-v1",
    },
  ],
};
const person = { name: "山田", grade: "B2" };

describe("[unit] shared brew prediction", () => {
  test("抽出中は開始時予測、待機は最新の本人予測、交代の応答待ちは店舗基準を使う", () => {
    expect(predictedBrewSeconds(model, card("a", true), 1, person)).toBe(180);
    expect(predictedBrewSeconds(model, card("b"), 1, person)).toBe(200);
    expect(
      predictedBrewSeconds(model, card("b"), 1, { name: "佐藤", grade: "B1" }),
    ).toBe(250);
    expect(predictedBrewSeconds(undefined, card("b"), 1, person)).toBe(300);
    expect(
      predictedBrewSeconds(
        { ...model, standards: { hot1: estimate(Number.NaN) }, lanes: [] },
        card("b"),
        1,
        person,
      ),
    ).toBe(300);
  });
  test("タイムライン・残り・NEXT・リベロで同じ値を使い、待機間に15秒を足さない", () => {
    const lane: Lane = {
      id: 1,
      brewing: card("a", true),
      queued: [card("b")],
      done: [],
      predictBrew: (c, id) => predictedBrewSeconds(model, c, id, person),
    };
    const now = started.getTime() + 60_000;
    expect(laneStatus(lane, now).remainingSec).toBe(120);
    const times = laneTimes(lane, now);
    expect(times[0].endMs).toBe(started.getTime() + 180_000);
    expect(times[1].startMs).toBe(times[0].endMs);
    expect(times[1].endMs - times[1].startMs).toBe(200_000);
    expect(nextAvailableBays([lane], now)[0].seconds).toBe(320);
    expect(liberoLanes([lane], now)[0].brew?.plannedSec).toBe(180);
    expect(liberoLanes([lane], now)[0].brew?.progress).toBeCloseTo(1 / 3);
    // 警告は学習した180秒の半分でなく、従来300秒の半分を使う。
    expect(earlyNext(lane, started.getTime() + 100_000)).not.toBeNull();
  });
});
