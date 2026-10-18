import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { caosLog } from "../utils/log";
import {
  type MasterSheetTabState,
  createMasterSheetTabSession,
} from "../utils/master-sheet-tab";

/** 同一オリジン・ブラウザの操作タブを1つに限定する。保存領域の空き容量には依存しない。 */
export const useMasterSheetTab = () => {
  const [state, setState] = useState<MasterSheetTabState>("checking");
  const session = useRef<ReturnType<typeof createMasterSheetTabSession> | null>(
    null,
  );
  const retry = useCallback(() => session.current?.retry(), []);

  useEffect(() => {
    const current = createMasterSheetTabSession({
      onState: setState,
      onPageHide: () => flushSync(() => setState("checking")),
      log: caosLog,
    });
    session.current = current;
    return () => {
      session.current = null;
      current.stop();
    };
  }, []);

  return { state, retry };
};
