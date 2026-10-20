import { useCallback, useLayoutEffect, useRef } from "react";
import { fittingCardLabels } from "../logic/cardPresentation";

/** 通常は2行に収め、必須札だけでも収まらない場合は折り返す。時計の更新では再計測しない。 */
export function useCardLayout() {
  const headlineRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const measured = useRef({ head: "", detail: "" });
  const measure = useCallback((force = false) => {
    const head = headlineRef.current;
    if (head) {
      const signature = `${head.clientWidth}:${head.textContent}:${head.dataset.numberSize}:${head.dataset.cupSize}`;
      if (force || measured.current.head !== signature) {
        measured.current.head = signature;
        head.dataset.fittedWidth = String(head.clientWidth);
        const number = Number(head.dataset.numberSize);
        const cups = Number(head.dataset.cupSize);
        const apply = (scale: number) => {
          head.style.setProperty("--caos-content-scale", String(scale));
          head.style.setProperty("--caos-number-size", `${number * scale}px`);
          head.style.setProperty("--caos-cup-size", `${cups * scale}px`);
        };
        const gap = Number.parseFloat(getComputedStyle(head).columnGap) || 0;
        const children = [...head.children] as HTMLElement[];
        const width = () =>
          children.reduce((sum, node) => sum + node.offsetWidth, 0) +
          gap * (children.length - 1);
        apply(1);
        const hashes = [
          ...head.querySelectorAll<HTMLElement>("[data-card-hash]"),
        ];
        for (const hash of hashes) hash.style.display = "inline";
        if (width() > head.clientWidth)
          for (const hash of hashes) hash.style.display = "none";
        if (width() > head.clientWidth) {
          let low = 0.35;
          let high = 1;
          for (let i = 0; i < 9; i++) {
            const scale = (low + high) / 2;
            apply(scale);
            if (width() <= head.clientWidth) low = scale;
            else high = scale;
          }
          apply(low);
          head.dataset.numberScale = low.toFixed(3);
        } else head.dataset.numberScale = "1";
      }
    }
    const detail = detailRef.current;
    if (!detail) return;
    const signature = `${detail.clientWidth}:${detail.className}:${detail.textContent}`;
    if (!force && measured.current.detail === signature) return;
    measured.current.detail = signature;
    detail.dataset.fittedWidth = String(detail.clientWidth);
    const product = detail.querySelector<HTMLElement>("[data-card-product]");
    if (!product) return;
    const labels = [
      ...detail.querySelectorAll<HTMLElement>("[data-card-label]"),
    ];
    for (const label of labels) label.style.display = "inline-flex";
    product.style.flex = "0 0 auto";
    product.style.width = "auto";
    const widths = labels.map((label) => {
      const long = label.querySelector<HTMLElement>("[data-label-long]");
      if (long) long.style.display = "inline";
      const width = label.offsetWidth;
      let compactWidth: number | undefined;
      if (long) {
        long.style.display = "none";
        compactWidth = label.offsetWidth;
        long.style.display = "inline";
      }
      return {
        key: label.dataset.cardLabel ?? "",
        width,
        compactWidth,
        priority: Number(label.dataset.priority),
      };
    });
    const gap = Number.parseFloat(getComputedStyle(detail).columnGap) || 0;
    const layout = fittingCardLabels(
      detail.clientWidth,
      Math.max(product.scrollWidth, product.offsetWidth) + 1,
      widths,
      gap,
    );
    product.style.flex = "0 1 auto";
    product.style.width = `${layout.productWidth}px`;
    // 必須札だけでも収まらない幅では、状態を隠す代わりに折り返す。
    detail.style.flexWrap = layout.wrapRequired ? "wrap" : "nowrap";
    for (const label of labels) {
      const key = label.dataset.cardLabel ?? "";
      label.style.display = layout.visible.has(key) ? "inline-flex" : "none";
      const long = label.querySelector<HTMLElement>("[data-label-long]");
      if (long)
        long.style.display = layout.compact.has(key) ? "none" : "inline";
    }
  }, []);
  useLayoutEffect(() => {
    measure();
  });
  useLayoutEffect(() => {
    let frame = 0;
    let stopped = false;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!stopped) measure();
      });
    };
    const fontsChanged = () => {
      measured.current = { head: "", detail: "" };
      schedule();
    };
    const observer = new ResizeObserver(schedule);
    if (headlineRef.current) observer.observe(headlineRef.current);
    if (detailRef.current) observer.observe(detailRef.current);
    void document.fonts.ready.then(() => {
      if (!stopped) fontsChanged();
    });
    document.fonts.addEventListener("loadingdone", fontsChanged);
    return () => {
      stopped = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.fonts.removeEventListener("loadingdone", fontsChanged);
    };
  }, [measure]);
  return { headlineRef, detailRef };
}
