import { useEffect, useState } from "react";
import { createCaosStateLog } from "../utils/log";

/** 再描画やStrictModeで同じ状態を重複保存しない。呼び出し側で記録する項目を選ぶ。 */
export const useCaosStateLog = (event: string, details: unknown) => {
  const [log] = useState(() => createCaosStateLog());
  const snapshot = JSON.stringify(details);
  useEffect(() => {
    log(event, JSON.parse(snapshot));
  }, [event, snapshot, log]);
};
