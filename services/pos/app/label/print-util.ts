import type { LabelPrintRequestResult, OrderEntity } from "@cafeore/common";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { cancelLabelJob } from "./cancel-label";
import type { PrintJob } from "./document";
import type {
  CreateLabelPrinter,
  PrinterConnectionStatus,
} from "./infra/printer";
import { emergencyLabelJobs, orderLabelJob } from "./order-label";
import type { LabelGeometry } from "./paper";
import {
  addPendingPrint,
  cancelPendingPrint,
  isPrintSettled,
  readPendingPrints,
  removePendingPrint,
  subscribePendingPrints,
  withPendingPrintsLock,
} from "./pending-prints";
import {
  type RelayBackoff,
  canRelayNow,
  recordRelayResult,
} from "./print-relay";
import type { ReceiptPayment, ReceiptSplit } from "./receipt";
import {
  claimReceiptJob,
  formalReceiptJob,
  orderReceiptJob,
} from "./receipt-canvas";
import { type EmergencyStickers, emergencyStickers } from "./sticker";

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

/** 緊急で淹れ直したカップ 1 杯と、その淹れ直しの id（刷れなかったら、この id で残す） */
export type EmergencyPrint = {
  order: OrderEntity;
  cupId: string;
  emergencyId: string;
};

/**
 * シールのプリンター
 *
 * 注文から印刷データを作り（order-label）、プリンター（infra）に渡して刷る。
 * 使うプリンターは createPrinter で差し替えられる（Epson の ePOS なら infra/epos の eposPrinterAt）。
 * シールはラベル用のシールの大きさと向き（geometry。paper.ts の labelGeometry）に合わせる。カップのシールは印字幅に収め、
 * 緊急・キャンセルのシールはシール 1 枚分の画像に描く（sticker.ts）。向きが 180° なら、どれも回して刷る。
 *
 * 刷れなかったもの（プリンターが失敗を返した・つながらない・返事が来ない）は端末に残し（pending-prints）、
 * つながったとき・残っているあいだは一定の間隔で送り直す（つながっていなければ、つなぎ直す）。刷れたら消す。
 *
 * relay を渡すと（CaOS・マスターの緊急）、直接刷れなかったシールはすぐ relay でレジに頼み（代理印刷。print-relay）、
 * 頼めたら端末には残さない（刷るのは代理印刷のレジ）。頼めなかったら（API につながらない・断られた）端末に残し、
 * 送り直すたびに、直接刷れなければもう一度頼む（つながっていないあいだも頼み続ける。頼めないたびに間を延ばす。relayRetryDelay）。
 * 淹れ直しが消えていたら（gone。取り消した・注文の編集や削除で消えた）、そのシールは捨てる（刷らず、もう頼まない）。
 */
export const usePrinter = (
  createPrinter: CreateLabelPrinter,
  geometry: LabelGeometry,
  onActivity?: (event: string, details: Record<string, unknown>) => void,
  relay?: (id: string, job: PrintJob) => Promise<LabelPrintRequestResult>,
) => {
  const { status, print, reconnect } = useConnectedPrinter(createPrinter);
  // 描くたびに作り直す geometry ではなく値で持つ（大きさ・向きが変わったときだけ、下の関数を作り直す）
  const { width, height, margin, rotate180 } = geometry;
  const pendingCount = useSyncExternalStore(
    subscribePendingPrints,
    countPendingPrints,
    () => 0,
  );
  const relayBackoff = useRef<RelayBackoff>(new Map());

  /**
   * 直接刷れなかったシールをレジに頼む（relay があるときだけ。取り消した緊急のシール・頼めなかった後で間をあけているシールは頼まない）。
   * 頼んだ結果を返す（頼まなかったら null）。gone なら、そのシールは端末から捨てる
   */
  const handOver = useCallback(
    async (job: PrintJob, id: string) => {
      if (relay === undefined || isPrintSettled(id)) return null;
      if (!canRelayNow(relayBackoff.current, id, Date.now())) return null;
      const result = await relay(id, job);
      recordRelayResult(relayBackoff.current, id, result, Date.now());
      if (result === "gone") cancelPendingPrint(id);
      return result;
    },
    [relay],
  );

  const printJob = useCallback(
    async (job: PrintJob, pendingId?: string) => {
      if (pendingId && isPrintSettled(pendingId)) return;
      onActivity?.("printer.print.requested", { emergencyId: pendingId });
      const printed = await print(job);
      if (printed) {
        if (pendingId) removePendingPrint(pendingId);
        onActivity?.("printer.print.succeeded", { emergencyId: pendingId });
        return;
      }
      const id = pendingId ?? crypto.randomUUID();
      const relayed = await handOver(job, id);
      if (relayed === "requested") {
        removePendingPrint(id);
        onActivity?.("printer.print.relayed", { emergencyId: pendingId });
        return;
      }
      if (relayed === "gone") {
        onActivity?.("printer.print.discarded", { emergencyId: pendingId });
        return;
      }
      onActivity?.("printer.print.queued", { emergencyId: pendingId });
      addPendingPrint(job, id);
    },
    [print, handOver, onActivity],
  );

  // 残りを古い順に送り、刷れたもの・レジに頼めたものを消す（刷れなかったものは残して次を送る。1 件のせいで後ろが刷れなくならないように）。
  // direct が false（プリンターにつながっていない）なら、プリンターには送らずレジに頼むだけ
  // （つながっていないプリンターに送ると、つなぎかけのものまで切れたことになるので）
  const sending = useRef(false);
  const sendPending = useCallback(
    async (direct: boolean) => {
      if (sending.current) return;
      sending.current = true;
      try {
        await withPendingPrintsLock(async () => {
          for (const pending of readPendingPrints()) {
            if (isPrintSettled(pending.id)) {
              removePendingPrint(pending.id);
              continue;
            }
            // 前のシールを送っている間に消えた（取り消した緊急の）ものは送らない
            if (!readPendingPrints().some((p) => p.id === pending.id)) continue;
            onActivity?.("printer.resend.requested", { pendingId: pending.id });
            const printed = direct && (await print(pending.job));
            const relayed = printed
              ? null
              : await handOver(pending.job, pending.id);
            onActivity?.(
              printed
                ? "printer.resend.succeeded"
                : relayed === "requested"
                  ? "printer.resend.relayed"
                  : relayed === "gone"
                    ? "printer.resend.discarded"
                    : "printer.resend.pending",
              { pendingId: pending.id },
            );
            // gone は handOver が捨てている
            if (printed || relayed === "requested")
              removePendingPrint(pending.id);
          }
        });
      } finally {
        sending.current = false;
      }
    },
    [print, handOver, onActivity],
  );

  /** 残りを送り直す。つながっていなければ、つなぎ直す（つながったら送る）。relay があれば、つながるのを待たずにレジに頼む */
  const resend = useCallback(() => {
    if (status === "connected") void sendPending(true);
    else {
      if (relay) void sendPending(false);
      if (status === "disconnected") reconnect();
    }
  }, [status, relay, sendPending, reconnect]);

  /** 「もう一度刷る」。人が押したので、頼めなかった後で間をあけているシールも、すぐ頼み直す */
  const retry = useCallback(() => {
    relayBackoff.current.clear();
    resend();
  }, [resend]);

  // つながったらすぐ送る（開き直したときの残りも）。あとは残っているあいだ一定の間隔で
  useEffect(() => {
    if (status === "connected") void sendPending(true);
  }, [status, sendPending]);

  useRetryInterval(pendingCount > 0, resend);

  /** 注文のシールを刷る。刷るシールが無い（抽出が要るものが無い）注文は、紙を送るだけになるので送らない */
  const printOrderLabel = useCallback(
    async (order: OrderEntity) => {
      const job = orderLabelJob(order, { width, height, rotate180 });
      if (job.labels.length > 0) await printJob(job);
    },
    [printJob, width, height, rotate180],
  );

  /**
   * 一度に緊急で淹れ直したカップのシールを、1 杯につき 1 枚、緊急のシールで挟んで刷る
   * （最初の杯の前に「ここから」、最後の杯の後ろに「ここまで」。order-label の emergencyLabelJobs）。
   * 1 杯ずつ送り、刷れなければその淹れ直しの id で残す（取り消したら removePendingPrint で消す）。
   * 緊急のシールの画像を描けなければ（canvas が使えないなど）、どの杯も刷らずに記録だけ残す
   */
  const printEmergencyLabels = useCallback(
    async (cups: readonly EmergencyPrint[]) => {
      let stickers: EmergencyStickers;
      try {
        stickers = await emergencyStickers({
          width,
          height,
          margin,
          rotate180,
        });
      } catch (error) {
        console.error("緊急のシールを描けませんでした", error);
        for (const { emergencyId } of cups)
          onActivity?.("printer.print.failed", { emergencyId });
        return;
      }
      const jobs = emergencyLabelJobs(
        cups,
        { width, height, rotate180 },
        stickers,
      );
      // 待たずに続けて頼む。printJob はプリンターに送るまでは待たずに進むので、この順に刷られる
      await Promise.all(
        jobs.map(({ cup, job }) => printJob(job, cup.emergencyId)),
      );
    },
    [printJob, onActivity, width, height, margin, rotate180],
  );

  /**
   * キャンセルした注文のシールを刷る（カップのシールを刷らない注文には刷らない）。
   * 端末には残さず、刷れなくても送り直さない（過去の注文から刷り直す）。
   * 刷れたら（刷るシールが無ければ）true
   */
  const printCancelLabel = useCallback(
    async (order: OrderEntity) => {
      try {
        const job = await cancelLabelJob(order, {
          width,
          height,
          margin,
          rotate180,
        });
        return job === null || (await print(job));
      } catch (error) {
        console.error("キャンセルのシールを印刷できませんでした", error);
        return false;
      }
    },
    [print, width, height, margin, rotate180],
  );

  return {
    status,
    pendingCount,
    retry,
    /** 印刷データをそのまま刷る（刷れなくても残さない・頼まない）。刷れたら true（代理印刷で使う） */
    print,
    printOrderLabel,
    printEmergencyLabels,
    printCancelLabel,
  };
};

/**
 * レシートと領収書のプリンター
 *
 * 刷れなくても会計は止めないので、どちらも例外は投げず、プリンターに送れたかを返す。
 * 画像を描くのを待つので結果は Promise。描くのに時間がかかっても、頼まれた順に刷る。
 * つながっていなければ、シールのプリンターと同じ間隔でつなぎ直す（刷れなかったものは送り直さない）。
 * レシート・領収書の画像は、プリンターの印字幅（width ドット。機種と用紙の種類・幅で決まる。paper.ts の receiptPrintableWidth）で描く。
 */
export const useReceiptPrinter = (
  createPrinter: CreateLabelPrinter,
  width: number,
) => {
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

  /** 会計のたびに刷るレシート。split（注文を何回かに分けて払う 1 回分）なら引換券番号は載せない */
  const printReceipt = useCallback(
    (order: OrderEntity, payment: ReceiptPayment, split?: ReceiptSplit) =>
      printSafely(() => orderReceiptJob(width, order, payment, split)),
    [printSafely, width],
  );

  /** 注文を何回かに分けて払ったとき、払い終えたら別に刷る引換券番号のレシート */
  const printClaimReceipt = useCallback(
    (order: OrderEntity) => printSafely(() => claimReceiptJob(width, order)),
    [printSafely, width],
  );

  /**
   * 求められたときだけ刷る領収書
   *
   * お客さんに渡すものの後に、同じ中身の店舗控を続けて刷る（1 枚ずつ切る）。どちらも送れたら true
   */
  const printFormalReceipt = useCallback(
    async (order: OrderEntity) => {
      const printed = await Promise.all([
        printSafely(() => formalReceiptJob(width, order)),
        printSafely(() => formalReceiptJob(width, order, { storeCopy: true })),
      ]);
      return printed.every(Boolean);
    },
    [printSafely, width],
  );

  return { status, printReceipt, printClaimReceipt, printFormalReceipt };
};
