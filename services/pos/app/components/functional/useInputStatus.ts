import { useCallback, useMemo, useState } from "react";

const InputStatusList = [
  "items",
  "discount",
  "description",
  "received",
  "submit",
] as const;

const inputLen = InputStatusList.length;

const narrowInLen = (idx: number) => Math.min(Math.max(idx, 0), inputLen - 1);

/**
 * CashierV2 のドメイン固有のフック
 *
 * 入力ステータスを管理する
 */
const useInputStatus = () => {
  const [idx, setIdx] = useState(0);

  const proceedStatus = useCallback(() => {
    setIdx((prev) => narrowInLen(prev + 1));
  }, []);

  const previousStatus = useCallback(() => {
    setIdx((prev) => narrowInLen(prev - 1));
  }, []);

  const inputStatus = useMemo(() => InputStatusList[idx], [idx]);

  const resetStatus = useCallback(() => {
    setIdx(0);
  }, []);

  const setInputStatus = useCallback(
    (status: (typeof InputStatusList)[number]) => {
      setIdx(InputStatusList.indexOf(status));
    },
    [],
  );

  return {
    inputStatus,
    proceedStatus,
    previousStatus,
    resetStatus,
    setInputStatus,
  };
};

export { useInputStatus };
