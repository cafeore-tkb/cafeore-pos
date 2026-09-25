// lib/reconnectingWebSocket.ts

/**
 * - connecting: 初回の接続中
 * - open: 接続中
 * - closed: 切断中。close() するまでは裏で再接続を試み続ける
 *
 * 再接続の試行中も closed のままにする。
 * 試行のたびに connecting へ戻すと、レジのオフライン表示などがちらつくため。
 * 同じ理由で、復帰の合図でつなぎ直すときも status はそのままにし、つながらなかったときだけ closed にする。
 */
export type ReconnectingWebSocketStatus = "connecting" | "open" | "closed";

type ReconnectDelayOptions = {
  /** 0 以上 1 未満を返す乱数。テスト用 */
  random?: () => number;
};

// 1回目の待ち時間の上限 (ms)
const RECONNECT_BASE_DELAY_MS = 500;
// 待ち時間の上限 (ms)
const RECONNECT_MAX_DELAY_MS = 15_000;
// 応答のない相手につなぎに行ったとき、onclose を待たずに諦めるまでの時間
const CONNECT_TIMEOUT_MS = 10_000;
// これ以上隠れていたら、見えるようになったときに接続を作り直す。
// スリープ中にサーバーが切った接続は、FIN が届かないとブラウザ側では OPEN のまま残るため
const REOPEN_AFTER_HIDDEN_MS = 30_000;

/**
 * 連続 attempt 回目 (0 始まり) の失敗のあと、次の接続まで待つ時間 (ms) を返す
 *
 * RECONNECT_BASE_DELAY_MS から倍々に増やして RECONNECT_MAX_DELAY_MS で頭打ちにし、その半分〜全部の間でばらつかせる。
 * API の再起動直後に全端末が同じタイミングで一斉に接続しに行かないようにするため。
 */
export const getReconnectDelay = (
  attempt: number,
  { random = Math.random }: ReconnectDelayOptions = {},
): number => {
  const ceiling = Math.min(
    RECONNECT_MAX_DELAY_MS,
    RECONNECT_BASE_DELAY_MS * 2 ** Math.max(0, attempt),
  );
  return Math.round(ceiling / 2 + (ceiling / 2) * random());
};

type WebSocketLike = Pick<
  WebSocket,
  "close" | "onopen" | "onmessage" | "onerror" | "onclose"
>;

type Options = {
  url: string;
  onMessage: (event: MessageEvent) => void;
  onStatusChange: (status: ReconnectingWebSocketStatus) => void;
  /** テスト用。省略時はブラウザの WebSocket */
  createSocket?: (url: string) => WebSocketLike;
};

/**
 * 切れたら自動でつなぎ直す WebSocket を作る
 *
 * - onclose で指数バックオフ（ジッター付き）の再接続を予約する。つながらないまま 10 秒経った接続も諦めて同様にする
 * - ネットワーク復帰（online）とタブが見えるようになったとき（visibilitychange）は、待たずにすぐ試す
 * - online と、30 秒以上隠れていたあとの visibilitychange では、つながっているように見える接続も作り直す
 *   （スリープ中に切れたのに気づけていない接続を捨てるため）
 * - close() のあとは再接続しない
 *
 * サーバーは接続直後に現在の状態を送ってくるので、つなぎ直せば切れていた間の変更も反映される。
 */
export const createReconnectingWebSocket = ({
  url,
  onMessage,
  onStatusChange,
  createSocket = (url) => new WebSocket(url),
}: Options) => {
  let socket: WebSocketLike | null = null;
  let status: ReconnectingWebSocketStatus = "connecting";
  // 前回つながってから連続で失敗した回数
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  // 最後に隠れた時刻。見えている間は null
  let hiddenAt: number | null = null;

  const setStatus = (next: ReconnectingWebSocketStatus) => {
    if (status === next) return;
    status = next;
    onStatusChange(next);
  };

  const clearConnectTimer = () => {
    if (connectTimer !== null) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  };

  // socket を手放して次の接続を予約する
  const handleDisconnect = () => {
    clearConnectTimer();
    socket = null;
    if (disposed) return;
    setStatus("closed");
    scheduleReconnect();
  };

  const scheduleReconnect = () => {
    if (disposed || timer !== null) return;
    const delay = getReconnectDelay(attempt);
    attempt += 1;
    timer = setTimeout(() => {
      timer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (disposed || socket !== null) return;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    let ws: WebSocketLike;
    try {
      ws = createSocket(url);
    } catch (err) {
      console.error("Failed to create WebSocket:", err);
      setStatus("closed");
      scheduleReconnect();
      return;
    }
    socket = ws;
    connectTimer = setTimeout(() => {
      if (socket !== ws) return;
      handleDisconnect();
      ws.close();
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (socket !== ws) return;
      clearConnectTimer();
      attempt = 0;
      setStatus("open");
    };
    ws.onmessage = (e) => {
      if (socket !== ws) return;
      onMessage(e);
    };
    // onerror のあとには必ず onclose が来るので、再接続は onclose だけで扱う
    ws.onerror = () => {};
    ws.onclose = () => {
      if (socket !== ws) return;
      handleDisconnect();
    };
  };

  // バックオフの待ち時間中でも、復帰の合図があればすぐつなぎに行く
  const reconnectNow = () => {
    if (socket !== null) return;
    connect();
  };
  // 今の socket を捨ててつなぎ直す。古い socket のイベントは socket !== ws で無視される
  const reopen = () => {
    if (disposed) return;
    const old = socket;
    if (old !== null) {
      clearConnectTimer();
      socket = null;
      old.close();
    }
    connect();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState !== "visible") {
      hiddenAt ??= Date.now();
      return;
    }
    const hiddenFor = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    if (hiddenFor >= REOPEN_AFTER_HIDDEN_MS) {
      reopen();
    } else {
      reconnectNow();
    }
  };

  const hasWindow = typeof window !== "undefined";
  const hasDocument = typeof document !== "undefined";
  if (hasWindow) window.addEventListener("online", reopen);
  if (hasDocument) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  connect();

  return {
    close: () => {
      disposed = true;
      clearConnectTimer();
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (hasWindow) window.removeEventListener("online", reopen);
      if (hasDocument) {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
      socket?.close();
      socket = null;
    },
  };
};
