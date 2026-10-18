const actions = new Set([
  "component.activated",
  "component.changed",
  "card.action",
  "comment.mark.clicked",
  "comment.notice.clicked",
  "comment.notices.dismissed",
  "search.performed",
  "search.submitted",
  "search.opened-from-comment",
  "sound.changed",
  "printer.retry",
  "outbox.retry",
  "outbox.discard",
  "confirmation.confirmed",
  "notice.dismissed",
  "device-setting.changed",
  "water.changed",
  "practice.reset",
  "practice.started",
  "practice.running.changed",
  "practice.speed.changed",
  "practice.import.cleared",
  "shift-feed.key.saved",
  "shift-feed.key.cleared",
  "shift-feed.reload",
  "operation.requested",
  "lanes.operation.requested",
  "practice.operation.requested",
  "comment.stamp.requested",
  "emergency.add.requested",
  "emergency.cancel.requested",
  "practice.import.requested",
  "inventory.requested",
]);

/** 状態監視・通信結果・座標イベントを送信キューへ入れない。 */
export const isHumanCaosLog = (
  event: string,
  details: Record<string, unknown>,
) =>
  actions.has(event) ||
  (event === "practice.finished" && details.source === "manual") ||
  (event.startsWith("board.") && event.endsWith(".requested")) ||
  event.startsWith("gesture.");

/** 業務の送信・保存の結果と接続障害。毎秒の状態や盤面全体の複製は記録しない。 */
export const isSystemCaosLog = (event: string) =>
  [
    "connection.changed",
    "operation.accepted",
    "operation.rejected",
    "page.error",
    "page.unhandled-rejection",
    "outbox.enqueued",
    "outbox.send",
    "outbox.response",
    "outbox.error",
    "outbox.sent",
    "outbox.rejected",
    "outbox.storage-failed",
    "comment.notice.received",
  ].includes(event) ||
  /\.(succeeded|failed|rejected)$/.test(event) ||
  event.startsWith("emergency.api.") ||
  event.startsWith("printer.print.") ||
  event.startsWith("printer.resend.");
