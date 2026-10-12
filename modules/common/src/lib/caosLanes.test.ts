import { describe, expect, test } from "vitest";
import { type CaosCard, assignWrites } from "./caos-board";
import {
  type CaosLanes,
  emptyCaosLanes,
  laneChangeWarnings,
  queuedSeniorOnlyCards,
  seniorOnlyBlock,
  seniorOnlyMergeBlock,
  todaysCaosLanes,
} from "./caosLanes";

const DAY = "2026-11-03";

const lanes = (
  ...people: [dripper: number, name: string, senior: boolean][]
): CaosLanes => ({
  day: DAY,
  lanes: emptyCaosLanes(DAY).lanes.map((lane) => {
    const p = people.find(([d]) => d === lane.dripper);
    return p
      ? { ...lane, name: p[1], senior: p[2], updated_at: "2026-11-03T02:00Z" }
      : lane;
  }),
});

let seq = 0;
const card = (init: Partial<CaosCard>): CaosCard =>
  ({
    key: `card-${++seq}`,
    dripId: `drip-${seq}`,
    status: "queued",
    dripper: null,
    dripperPosition: seq,
    startedAt: null,
    finishedAt: null,
    cups: [],
    orderNo: seq,
    nominatedDripper: null,
    seniorOnly: false,
    ...init,
  }) as CaosCard;

describe("[unit] CaOS のドリッパーの担当者", () => {
  test("今日の担当者だけを使う。届いていなければ・別の日なら担当者なし", () => {
    const today = todaysCaosLanes(lanes([1, "山田", true]), DAY);
    expect(today.map((l) => [l.dripper, l.name, l.senior])).toEqual([
      [1, "山田", true],
      [2, "", false],
      [3, "", false],
      [4, "", false],
      [5, "", false],
      [6, "", false],
    ]);
    expect(todaysCaosLanes(lanes([1, "山田", true]), "2026-11-04")[0]).toEqual({
      dripper: 1,
      name: "",
      senior: false,
      updated_at: null,
    });
    expect(todaysCaosLanes(null, DAY)).toHaveLength(6);
    // 名前の無い担当者は上級生にしない
    expect(todaysCaosLanes(lanes([2, "", true]), DAY)[1].senior).toBe(false);
  });

  test("上級生のみのカードは上級生のドリッパーにしか置けない（同じドリッパーの中は確かめない）", () => {
    const today = todaysCaosLanes(
      lanes([1, "山田", true], [2, "佐藤", false]),
      DAY,
    );
    const limited = card({ status: "unassigned", seniorOnly: true });
    expect(seniorOnlyBlock(limited, 1, today)).toBeNull();
    expect(seniorOnlyBlock(limited, 2, today)).toBe(
      "上級生のみのカードは上級生のドリッパーにしか置けません（2nd の担当者は上級生ではありません）",
    );
    expect(seniorOnlyBlock(limited, 3, today)).not.toBeNull();
    expect(
      seniorOnlyBlock(
        { seniorOnly: false, dripper: null, nominatedDripper: null },
        3,
        today,
      ),
    ).toBe(null);
    // 上級生でない人に替えたあとも、そのドリッパーの中では動かせる
    expect(
      seniorOnlyBlock(
        { seniorOnly: true, dripper: 2, nominatedDripper: null },
        2,
        today,
      ),
    ).toBe(null);
  });

  test("指名×上級生のみ：指名を優先し、指名のドリッパーの担当者が上級生でなくても置ける（ほかへは指名で断る）", () => {
    const nominated = card({
      status: "unassigned",
      seniorOnly: true,
      nominatedDripper: 2,
      cups: [
        { id: "cup-1", nominatedDripper: 2, nominee: "2nd" },
      ] as CaosCard["cups"],
      state: {
        dripper: null,
        dripperPosition: null,
        dripId: null,
        brewStartedAt: null,
        brewFinishedAt: null,
      },
    });
    // 指名で置けない理由（assignWrites）
    const nominationError = (dripper: number) => {
      const result = assignWrites([nominated], nominated, dripper, {
        newId: () => "new-drip",
      });
      return "error" in result ? result.error : null;
    };
    const placeable = (people: CaosLanes) =>
      [1, 2, 3, 4, 5, 6].filter(
        (d) =>
          !nominationError(d) &&
          !seniorOnlyBlock(nominated, d, todaysCaosLanes(people, DAY)),
      );
    // 2nd が上級生でも、上級生でなくても、担当者がいなくても 2nd にだけ置ける
    expect(placeable(lanes([1, "田中", true], [2, "山田", true]))).toEqual([2]);
    expect(placeable(lanes([1, "田中", true], [2, "佐藤", false]))).toEqual([
      2,
    ]);
    expect(placeable(lanes())).toEqual([2]);
    expect(nominationError(1)).toBe(
      "指名のあるカードは 2nd のドリッパーにしか置けません",
    );
  });

  test("統合：統合したあとのカードを into のドリッパーに置くとみる（指名はどちらかの指名）", () => {
    const today = todaysCaosLanes(lanes([2, "佐藤", false]), DAY);
    const limited = card({ status: "unassigned", seniorOnly: true });
    // 指名のカード（上級生でない 2nd）に入れれば、指名のあるカードなので置ける
    expect(
      seniorOnlyMergeBlock(
        limited,
        card({ dripper: 2, seniorOnly: true, nominatedDripper: 2 }),
        today,
      ),
    ).toBeNull();
    // 指名の無いカードどうしは、上級生でない 2nd には置けない
    expect(
      seniorOnlyMergeBlock(
        limited,
        card({ dripper: 2, seniorOnly: true }),
        today,
      ),
    ).toBe(
      "上級生のみのカードは上級生のドリッパーにしか置けません（2nd の担当者は上級生ではありません）",
    );
    // 未割当のカードに入れるのは置かないので確かめない
    expect(
      seniorOnlyMergeBlock(limited, card({ status: "unassigned" }), today),
    ).toBeNull();
  });

  test("交代の確認：上級生でない人にするドリッパーに指名の無い上級生のみのカードが待っていれば出す", () => {
    const cards = [
      card({ dripper: 1, seniorOnly: true }),
      card({ dripper: 1, seniorOnly: true }),
      card({ dripper: 1, seniorOnly: false }),
      // 抽出中・終わりは数えない
      card({ dripper: 1, seniorOnly: true, status: "brewing" }),
      card({ dripper: 1, seniorOnly: true, status: "done" }),
      card({ dripper: 2, seniorOnly: true }),
      // 指名のあるカードは担当者が上級生でなくても置けるので数えない
      card({ dripper: 1, seniorOnly: true, nominatedDripper: 1 }),
    ];
    expect(queuedSeniorOnlyCards(cards, 1)).toBe(2);
    expect(
      laneChangeWarnings(
        cards,
        [{ dripper: 1, name: "佐藤", senior: false }],
        true,
      ),
    ).toEqual([
      "このドリッパーに指名の無い上級生のみのカードが2枚あります（佐藤さんは上級生ではありません）",
    ]);
    expect(
      laneChangeWarnings(
        cards,
        [{ dripper: 1, name: "山田", senior: true }],
        true,
      ),
    ).toEqual([]);
    expect(
      laneChangeWarnings(
        cards,
        [{ dripper: 3, name: "", senior: false }],
        true,
      ),
    ).toEqual([]);
    // 入れ替えはドリッパーごとに 1 行。担当者なしになるときもそう書く
    expect(
      laneChangeWarnings(
        cards,
        [
          { dripper: 1, name: "", senior: false },
          { dripper: 2, name: "山田", senior: true },
        ],
        false,
      ),
    ).toEqual([
      "1st のドリッパーに指名の無い上級生のみのカードが2枚あります（担当者がいなくなります）",
    ]);
  });
});
