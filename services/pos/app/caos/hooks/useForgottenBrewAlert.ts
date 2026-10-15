import { useEffect, useRef } from "react";
import type { Lane } from "../logic/lanes";
import { laneStatus } from "../logic/queue";
import { soundManager } from "../utils/audio";

/**
 * 予定を大きく過ぎた抽出（入れ忘れ・「次へ」の押し忘れかもしれない。logic/queue の laneStatus の forgotten）が出たら、
 * 1 枚につき 1 回だけ音で知らせる（鳴らすかはヘッダーの音の切り替え。soundManager.enabled）。点滅は列の番号（DripperIndicator）
 */
export const useForgottenBrewAlert = (
  lanes: readonly Lane[],
  nowMs: number,
) => {
  const alerted = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const forgotten = new Set(
      lanes.flatMap((lane) =>
        lane.brewing && laneStatus(lane, nowMs).forgotten
          ? [lane.brewing.key]
          : [],
      ),
    );
    if ([...forgotten].some((key) => !alerted.current.has(key)))
      soundManager.playAlert();
    alerted.current = forgotten;
  }, [lanes, nowMs]);
};
