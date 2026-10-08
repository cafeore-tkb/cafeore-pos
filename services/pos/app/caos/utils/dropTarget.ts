import { isLaneId } from "./lanes";

// ドラッグで落とした先。bayId はドリッパー（列）、beforeTicketUid はその列の待機のカード（その前に入れる）。
// beforeTicketUid が無ければ、その列の待機の最後へ。
export interface DropTarget {
  bayId: number;
  beforeTicketUid?: string;
  /** 前に入れるカードの表示（注文番号） */
  beforeLabel?: string;
}

/**
 * 指の下にある待機のカード（TicketCard の data-queued-ticket）と、その列（data-bay-target）。
 * 動かしているカード自身（exceptUid）は飛ばす。待機のカードの上でなければ undefined。
 */
export const queuedTicketAt = (
  clientX: number,
  clientY: number,
  exceptUid?: string,
): DropTarget | undefined => {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const ticket = element.closest<HTMLElement>("[data-queued-ticket]");
    const uid = ticket?.dataset.queuedTicket;
    if (!ticket || !uid || uid === exceptUid) continue;
    const lane =
      ticket.parentElement?.closest<HTMLElement>("[data-bay-target]");
    const bayId = Number(lane?.dataset.bayTarget);
    if (isLaneId(bayId))
      return {
        bayId,
        beforeTicketUid: uid,
        beforeLabel: ticket.dataset.ticketLabel,
      };
  }
  return undefined;
};

/** 落とす先の表示（「→ 3」・「→ 3 #012 の前」） */
export const dropTargetLabel = ({ bayId, beforeLabel }: DropTarget) =>
  beforeLabel ? `→ ${bayId} ${beforeLabel} の前` : `→ ${bayId}`;
