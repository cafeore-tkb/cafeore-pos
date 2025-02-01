import { useEffect, useState } from "react";

/**
 * 一定間隔で現在時刻を更新するフック
 * @param interval 更新間隔
 * @returns 現在時刻
 */
export const useCurrentTime = (interval: number) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCurrentTime(new Date());
    }, interval);
    return () => clearInterval(intervalId);
  }, [interval]);

  return currentTime;
};
