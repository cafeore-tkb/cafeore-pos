import { useEffect, useRef } from "react";

/**
 * focus が true に変化した際に ref が指す DOM にフォーカスを当てる
 * @param focus フォーカスを当てるかどうか
 * @returns
 */
const useFocusRef = <T extends HTMLElement>(focus: boolean) => {
  const DOMRef = useRef<T>(null);

  /**
   * OK
   */
  useEffect(() => {
    if (focus) {
      DOMRef.current?.focus();
    }
  }, [focus]);

  return DOMRef;
};

export { useFocusRef };
