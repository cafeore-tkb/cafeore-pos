import { useEffect } from "react";

/**
 * 上下キーで数値を増減させないEffect
 */
const usePreventNumberKeyUpDown = () => {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        // 上下キーで数値を増減させない
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", handler);
    };
  }, []);
};

export { usePreventNumberKeyUpDown };
