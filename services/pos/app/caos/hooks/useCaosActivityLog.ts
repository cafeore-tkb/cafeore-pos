import { useEffect } from "react";
import { caosHumanLogSequence, caosLog } from "../utils/log";

/** DOM全体の座標ではなく、押されたカード・ボタン・設定項目を記録する。 */
export const useCaosActivityLog = () => {
  useEffect(() => {
    const interaction = (event: Event) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const control = event.target.closest(
        "button, a, input, select, textarea, [role='button'], [role='tab']",
      );
      const card = event.target.closest<HTMLElement>("[data-search-key]");
      const target = control ?? card;
      if (!target) return;
      // inputは1文字ずつ収集せず、確定した変更だけ。入力内容は記録しない。
      if (event.type === "click" && target.matches("input, select, textarea"))
        return;
      const label =
        target.getAttribute("aria-label") ??
        target.getAttribute("title") ??
        (control
          ? target.textContent?.trim().slice(0, 100)
          : card?.dataset.ticketLabel);
      if (!label && !card) return;
      const previousSequence = caosHumanLogSequence();
      const details = {
        component: card
          ? "OrderCard"
          : target.closest("[data-comment-dock]")
            ? "CommentDock"
            : target.closest("[role=dialog], dialog")
              ? "Dialog"
              : "Control",
        control: control
          ? (target.getAttribute("role") ?? target.tagName.toLowerCase())
          : "card",
        label: label || "注文カード",
        cardKey: card?.dataset.searchKey,
        orderLabel: card?.dataset.ticketLabel,
        dripper:
          target.closest<HTMLElement>("[data-bay-target]")?.dataset.bayTarget,
      };
      window.setTimeout(() => {
        // 専用ハンドラーが操作を記録した場合は、汎用ボタンのログを重ねない。
        if (caosHumanLogSequence() !== previousSequence) return;
        caosLog(
          event.type === "change" ? "component.changed" : "component.activated",
          details,
        );
      }, 0);
    };
    const error = (event: ErrorEvent) =>
      caosLog("page.error", {
        message: event.message,
        file: event.filename,
        line: event.lineno,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    const rejection = (event: PromiseRejectionEvent) =>
      caosLog("page.unhandled-rejection", {
        reason:
          event.reason instanceof Error
            ? event.reason.message
            : String(event.reason),
      });
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", rejection);
    document.addEventListener("click", interaction, true);
    document.addEventListener("change", interaction, true);
    return () => {
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", rejection);
      document.removeEventListener("click", interaction, true);
      document.removeEventListener("change", interaction, true);
    };
  }, []);
};
