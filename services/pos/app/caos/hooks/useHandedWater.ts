import type { Lane } from "../logic/lanes";
import { caosLog } from "../utils/log";
import { useDeviceSetting } from "./useDeviceSetting";

// リベロビューの「お湯を渡した」印。この端末にだけ覚え（DB には書かない）、ドリッパーごとに、渡した抽出中のカードの key（dripId）を持つ。
// 抽出が替わったら（「次へ」で別のカードになったら）key が合わなくなるので、印は外れる。

export const useHandedWater = () => {
  const [marks, setMarks] = useDeviceSetting<Record<string, string>>(
    "caos-libero-handed",
    {},
  );
  const handed = (lane: Lane) =>
    lane.brewing !== undefined && marks[lane.id] === lane.brewing.key;
  return {
    handed,
    /** 印を付ける・外す（もう一度押したら戻す） */
    toggle: (lane: Lane) => {
      if (!lane.brewing) return;
      caosLog("water.changed", {
        dripper: lane.id,
        cardKey: lane.brewing.key,
        handed: !handed(lane),
      });
      const { [lane.id]: _, ...rest } = marks;
      setMarks(handed(lane) ? rest : { ...rest, [lane.id]: lane.brewing.key });
    },
  };
};
