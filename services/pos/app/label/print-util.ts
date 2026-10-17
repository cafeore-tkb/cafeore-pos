import type { OrderEntity } from "@cafeore/common";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PrintJob } from "./document";
import { createEposPrinter } from "./infra/epos";
import type {
  CreateLabelPrinter,
  PrinterConnectionStatus,
} from "./infra/printer";
import { cancelLabelJob, cupLabelJob, orderLabelJob } from "./order-label";
import {
  addPendingPrint,
  readPendingPrints,
  removePendingPrint,
  subscribePendingPrints,
  withPendingPrintsLock,
} from "./pending-prints";
import type { ReceiptPayment, ReceiptSplit } from "./receipt";
import { formalReceiptJob, orderReceiptJob } from "./receipt-canvas";

/**
 * プリンターにつないでおき、印刷データを刷る
 *
 * createPrinter が変わったら（IP アドレスを変えたときなど）、前のプリンターを切ってつなぎ直す。
 * 呼ぶ側は、同じプリンターの間は同じ createPrinter を渡す（useMemo などで）。
 */
const useConnectedPrinter = (createPrinter: CreateLabelPrinter) => {
  const [status, setStatus] = useState<"init" | PrinterConnectionStatus>(
    "init",
  );
  const printer = useMemo(() => createPrinter(setStatus), [createPrinter]);

  useEffect(() => {
    printer.connect();
    return () => printer.disconnect();
  }, [printer]);

  const print = useCallback((job: PrintJob) => printer.print(job), [printer]);
  const reconnect = useCallback(() => {
    printer.disconnect();
    printer.connect();
  }, [printer]);

  return { status, print, reconnect };
};

/** 刷れなかったシールを送り直す・つながらないプリンターにつなぎ直す間隔（ミリ秒） */
const RETRY_INTERVAL_MS = 10_000;

/** active のあいだ、一定の間隔で retry を呼ぶ */
const useRetryInterval = (active: boolean, retry: () => void) => {
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(retry, RETRY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, retry]);
};

const countPendingPrints = () => readPendingPrints().length;

/**
 * シールのプリンター
 *
 * 注文から印刷データを作り（order-label）、プリンター（infra）に渡して刷る。
 * 使うプリンターは createPrinter で差し替えられる（既定は Epson の ePOS）。
 *
 * 刷れなかったもの（プリンターが失敗を返した・つながらない・返事が来ない）は端末に残し（pending-prints）、
 * つながったとき・残っているあいだは一定の間隔で送り直す（つながっていなければ、つなぎ直す）。刷れたら消す。
 */
export const usePrinter = (
  createPrinter: CreateLabelPrinter = createEposPrinter,
) => {
  const { status, print, reconnect } = useConnectedPrinter(createPrinter);
  const pendingCount = useSyncExternalStore(
    subscribePendingPrints,
    countPendingPrints,
    () => 0,
  );

  const printJob = useCallback(
    async (job: PrintJob, pendingId?: string) => {
      if (!(await print(job))) addPendingPrint(job, pendingId);
    },
    [print],
  );

  // 残りを古い順に送り、刷れたものを消す（刷れなかったものは残して次を送る。1 件のせいで後ろが刷れなくならないように）
  const sending = useRef(false);
  const sendPending = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      await withPendingPrintsLock(async () => {
        for (const pending of readPendingPrints()) {
          // 前のシールを送っている間に消えた（取り消した緊急の）ものは送らない
          if (!readPendingPrints().some((p) => p.id === pending.id)) continue;
          if (await print(pending.job)) removePendingPrint(pending.id);
        }
      });
    } finally {
      sending.current = false;
    }
  }, [print]);

  /** 残りを送り直す。つながっていなければ、つなぎ直す（つながったら送る） */
  const retry = useCallback(() => {
    if (status === "connected") void sendPending();
    else if (status === "disconnected") reconnect();
  }, [status, sendPending, reconnect]);

  // つながったらすぐ送る（開き直したときの残りも）。あとは残っているあいだ一定の間隔で
  useEffect(() => {
    if (status === "connected") void sendPending();
  }, [status, sendPending]);

  useRetryInterval(pendingCount > 0, retry);

  const printOrderLabel = useCallback(
    (order: OrderEntity) => printJob(orderLabelJob(order)),
    [printJob],
  );

  /** 先に刷ったシールを使わないよう、取り消しのシールを刷る */
  const printCancelLabel = useCallback(
    (order: OrderEntity) => printJob(cancelLabelJob(order)),
    [printJob],
  );

  /** 緊急で入れ直したカップのシールを 1 枚刷る。刷れなければ入れ直しの id で残す（取り消したら removePendingPrint で消す） */
  const printCupLabel = useCallback(
    async (order: OrderEntity, cupId: string, emergencyId: string) => {
      const job = cupLabelJob(order, cupId);
      if (job) await printJob(job, emergencyId);
    },
    [printJob],
  );

  return {
    status,
    pendingCount,
    retry,
    printOrderLabel,
    printCancelLabel,
    printCupLabel,
  };
};

/**
 * レシートと領収書のプリンター
 *
 * 刷れなくても会計は止めないので、どちらも例外は投げず、プリンターに送れたかを返す。
 * 画像を描くのを待つので結果は Promise。描くのに時間がかかっても、頼まれた順に刷る。
 * つながっていなければ、シールのプリンターと同じ間隔でつなぎ直す（刷れなかったものは送り直さない）。
 */
export const useReceiptPrinter = (createPrinter: CreateLabelPrinter) => {
  const { status, print, reconnect } = useConnectedPrinter(createPrinter);
  useRetryInterval(status === "disconnected", reconnect);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * 印刷データはすぐ作り始め、刷るのは頼まれた順にする
   *
   * buildJob は async 関数を渡す（同期で投げない）。作れなくても会計の流れに例外は出さない。
   */
  const printSafely = useCallback(
    (buildJob: () => Promise<PrintJob>) => {
      const job = buildJob();
      // 刷る番が来る前に失敗しても未処理の reject にしない（下の try で拾う）
      job.catch(() => {});
      const printed = queue.current.then(async () => {
        try {
          return print(await job);
        } catch (error) {
          console.error("レシート用のプリンターで印刷できませんでした", error);
          return false;
        }
      });
      queue.current = printed;
      return printed;
    },
    [print],
  );

  /** 会計のたびに刷るレシート */
  const printReceipt = useCallback(
    (order: OrderEntity, payment: ReceiptPayment, split?: ReceiptSplit) =>
      printSafely(() => orderReceiptJob(order, payment, split)),
    [printSafely],
  );

  /**
   * 求められたときだけ刷る領収書
   *
   * お客さんに渡すものの後に、同じ中身の店舗控を続けて刷る（1 枚ずつ切る）。どちらも送れたら true
   */
  const printFormalReceipt = useCallback(
    async (order: OrderEntity) => {
      const printed = await Promise.all([
        printSafely(() => formalReceiptJob(order)),
        printSafely(() => formalReceiptJob(order, { storeCopy: true })),
      ]);
      return printed.every(Boolean);
    },
    [printSafely],
  );

  return { status, printReceipt, printFormalReceipt };
};
