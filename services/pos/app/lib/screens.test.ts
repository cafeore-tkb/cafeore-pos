import { describe, expect, test } from "vitest";
import { pickCompanionScreen, pickTargetScreen, screenName } from "./screens";

const screen = (label: string, isInternal: boolean) => ({ label, isInternal });

describe("[unit] 呼び出し画面を出す先の画面", () => {
  const laptop = screen("内蔵ディスプレイ", true);
  const tv = screen("TV", false);
  const monitor = screen("モニター", false);

  test("このウィンドウの無い画面のうち、本体に付いていないもの（外部ディスプレイ）を選ぶ", () => {
    expect(pickTargetScreen([laptop, tv], laptop)).toBe(tv);
    expect(pickTargetScreen([tv, laptop, monitor], tv)).toBe(monitor);
  });

  test("ほかの画面が本体のものだけならそれを、ほかに無ければこのウィンドウの画面を選ぶ", () => {
    expect(pickTargetScreen([laptop, tv], tv)).toBe(laptop);
    expect(pickTargetScreen([laptop], laptop)).toBe(laptop);
  });

  test("小窓は出す先と別の画面に開く。このウィンドウの画面が出す先でなければそこ", () => {
    expect(pickCompanionScreen([laptop, tv], tv, laptop)).toBe(laptop);
    expect(pickCompanionScreen([laptop, tv, monitor], tv, monitor)).toBe(
      monitor,
    );
    expect(pickCompanionScreen([laptop, tv], tv, tv)).toBe(laptop);
  });

  test("画面が 1 つなら小窓は開かない", () => {
    expect(pickCompanionScreen([laptop], laptop, laptop)).toBe(null);
  });

  test("名前が無ければ並びの番号で呼ぶ", () => {
    expect(screenName({ label: "DELL U2720Q" }, 0)).toBe("DELL U2720Q");
    expect(screenName({ label: " " }, 1)).toBe("ディスプレイ 2");
  });
});
