import { describe, expect, test } from "vitest";
import { pickTargetScreen, screenName } from "./screens";

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

  test("名前が無ければ並びの番号で呼ぶ", () => {
    expect(screenName({ label: "DELL U2720Q" }, 0)).toBe("DELL U2720Q");
    expect(screenName({ label: " " }, 1)).toBe("ディスプレイ 2");
  });
});
