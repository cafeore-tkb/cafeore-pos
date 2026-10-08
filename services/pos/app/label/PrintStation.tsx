import {
  claimPrintJob,
  completePrintJob,
  failPrintJob,
  printJobLabels,
} from "@cafeore/common";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import bell from "~/assets/bell.mp3";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";
import { usePrinter } from "./print-util";

// 印刷する端末（プリンターにつないだ端末）。
// 「この端末で印刷する」にした端末だけがプリンターにつなぎ、印刷キューから積んだ順に 1 件ずつ取って印刷し、済み・失敗にする。
// どの端末で印刷するかは端末ごとの設定（localStorage）。複数の端末で印刷にしても、サーバーが 1 件ずつ配るので同じ仕事を 2 台が取らない。
// 印刷キューの仕事は WebSocket の {"type":"print_jobs"} で届くので、待ちの仕事が届いたら取りに行く（念のため一定の間隔でも見に行く）。

const STATION_KEY = "cafeore.printStation";
const PRINTER_ID_KEY = "cafeore.printerId";

// 印刷キューの WebSocket が止まっていても取りこぼさないよう、この間隔でも待ちの仕事を見に行く
const POLL_INTERVAL_MS = 15_000;

export type PrinterConnection =
  | "init"
  | "connecting"
  | "connected"
  | "disconnected";

const readStation = (): boolean => {
  try {
    return window.localStorage.getItem(STATION_KEY) === "on";
  } catch {
    return false;
  }
};

const writeStation = (on: boolean) => {
  try {
    if (on) window.localStorage.setItem(STATION_KEY, "on");
    else window.localStorage.removeItem(STATION_KEY);
  } catch {
    // 保存できなくても、このタブの間は設定どおりに動く
  }
};

const randomId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `printer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

// localStorage が使えないときの、このタブの間だけの ID
let sessionPrinterId: string | null = null;

/** この端末の ID（印刷キューで、取った端末を見分ける） */
const printerIdOf = (): string => {
  try {
    const saved = window.localStorage.getItem(PRINTER_ID_KEY);
    if (saved) return saved;
    const id = randomId();
    window.localStorage.setItem(PRINTER_ID_KEY, id);
    return id;
  } catch {
    sessionPrinterId ??= randomId();
    return sessionPrinterId;
  }
};

type PrintStationValue = {
  /** この端末で印刷するか */
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  /** プリンターとの接続（印刷しない端末は null） */
  printerStatus: PrinterConnection | null;
  /** プリンターにつなぎ直す */
  reconnect: () => void;
  /** 印刷キューとのやりとりで最後に失敗した理由（うまくいったら消える） */
  lastError: string | null;
};

const PrintStationContext = createContext<PrintStationValue | null>(null);

export const PrintStationProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  // 初めの描画はサーバーの描画（HydrateFallback）とそろえて「印刷しない」にし、読み込んでから設定を反映する
  const [enabled, setEnabledState] = useState(false);
  const [printerStatus, setPrinterStatus] = useState<PrinterConnection | null>(
    null,
  );
  const [lastError, setLastError] = useState<string | null>(null);
  const reconnectRef = useRef<() => void>(() => {});

  useEffect(() => {
    setEnabledState(readStation());
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    writeStation(on);
    setEnabledState(on);
    if (!on) {
      setPrinterStatus(null);
      setLastError(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      enabled,
      setEnabled,
      printerStatus: enabled ? printerStatus : null,
      reconnect: () => reconnectRef.current(),
      lastError: enabled ? lastError : null,
    }),
    [enabled, setEnabled, printerStatus, lastError],
  );

  return (
    <PrintStationContext.Provider value={value}>
      {enabled && (
        <PrintWorker
          onStatus={setPrinterStatus}
          onError={setLastError}
          reconnectRef={reconnectRef}
        />
      )}
      {children}
    </PrintStationContext.Provider>
  );
};

export const usePrintStation = () => {
  const context = useContext(PrintStationContext);
  if (!context) {
    throw new Error("usePrintStation must be used within PrintStationProvider");
  }
  return context;
};

const playEmergencySound = () => {
  try {
    void new Audio(bell).play().catch(() => {});
  } catch {
    // 音が鳴らせなくても印刷は続ける
  }
};

/**
 * 印刷する端末の本体。プリンターにつなぎ、待ちの仕事があれば 1 件ずつ取って印刷する。
 * 「この端末で印刷する」にしている間だけ置く（印刷しない端末はプリンターにつながない）
 */
const PrintWorker = ({
  onStatus,
  onError,
  reconnectRef,
}: {
  onStatus: (status: PrinterConnection) => void;
  onError: (error: string | null) => void;
  reconnectRef: React.MutableRefObject<() => void>;
}) => {
  const printer = usePrinter();
  const { printJobs } = useOrdersWSContext();
  const status = printer.status as PrinterConnection;
  const printerId = useMemo(printerIdOf, []);

  // 最新の printer を drain から使う（描画のたびに作り直されるため）
  const printerRef = useRef(printer);
  printerRef.current = printer;
  reconnectRef.current = printer.connect;

  useEffect(() => {
    onStatus(status);
  }, [status, onStatus]);

  const running = useRef(false);
  const again = useRef(false);

  // 待ちの仕事が無くなるまで、1 件ずつ取って印刷する。同時には 1 つだけ動かす（動いている間の依頼は、終わってからもう一周）
  const drain = useCallback(async () => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        again.current = false;
        while (printerRef.current.status === "connected") {
          const claimed = await claimPrintJob(printerId);
          if (claimed.error !== undefined) {
            onError(claimed.error);
            return;
          }
          onError(null);
          if (claimed.result === null) break;
          const { job, order } = claimed.result;
          const labels = printJobLabels(job, order);
          if (!labels) {
            await failPrintJob(
              job.id,
              printerId,
              "シールを作れません（カップが見つかりません）",
            );
            continue;
          }
          try {
            await printerRef.current.printLabels(labels);
          } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            const failed = await failPrintJob(job.id, printerId, reason);
            if (failed.error !== undefined) onError(failed.error);
            continue;
          }
          if (job.kind === "emergency") playEmergencySound();
          const done = await completePrintJob(job.id, printerId);
          if (done.error !== undefined) onError(done.error);
        }
      } while (again.current);
    } finally {
      running.current = false;
    }
  }, [printerId, onError]);

  // 待ちの仕事が届いたら取りに行く
  const hasQueued = printJobs?.some((job) => job.status === "queued") ?? false;
  useEffect(() => {
    if (status === "connected" && hasQueued && printJobs) void drain();
  }, [status, hasQueued, printJobs, drain]);

  // 念のため一定の間隔でも見に行く（WebSocket が止まっている間に積まれた仕事）
  useEffect(() => {
    if (status !== "connected") return;
    void drain();
    const timer = setInterval(() => void drain(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [status, drain]);

  return null;
};
