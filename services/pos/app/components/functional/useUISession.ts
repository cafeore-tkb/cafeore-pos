import { useCallback, useMemo, useState } from "react";

type UISession = {
  date: Date;
  key: string;
};

/**
 * UI のセッションを管理するためのフック
 *
 * renewUISession を呼ぶことでセッションを更新できる
 *
 * UISession.key を DOM の key に指定することで、セッションが変更されたときに再描画される
 */
const useUISession = (): [UISession, () => void] => {
  const [date, setDate] = useState(new Date());

  const UISession = useMemo(() => {
    return {
      date,
      key: date.toJSON(),
    };
  }, [date]);

  const renewUISession = useCallback(() => {
    setDate(new Date());
  }, []);

  return [UISession, renewUISession];
};

export { useUISession };
