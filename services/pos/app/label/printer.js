import { useEffect, useRef, useState } from "react";

// 送ってからこの時間たっても印刷の結果が返らなければ、失敗とみなす
const PRINT_TIMEOUT_MS = 30_000;

/**
 * jsでしか書けない部分を書くフック
 * @returns {printer}
 */
export const useRawPrinter = () => {
  const [status, setStatus] = useState("init");
  const ePosDeviceRef = useRef();
  const printerRef = useRef();

  /**
   * BAD
   * https://ja.react.dev/learn/you-might-not-need-an-effect#initializing-the-application
   */
  useEffect(() => {
    if (status === "init") {
      connect();
    }
  }, [status]);

  const connect = () => {
    setStatus("connecting");
    if (!window.epson) {
      setStatus("disconnected");
      console.error("ePOSDevice not found");
      return;
    }
    const ePosDev = new window.epson.ePOSDevice();
    ePosDeviceRef.current = ePosDev;
    // 途中で切れたら未接続にする（印刷キューは、つながるまで仕事を取らない）
    ePosDev.ondisconnect = () => {
      printerRef.current = undefined;
      setStatus("disconnected");
    };

    ePosDev.connect("192.168.77.2", 8008, (data) => {
      if (data === "OK" || data === "SSL_CONNECT_OK") {
        ePosDev.createDevice(
          "local_printer",
          ePosDev.DEVICE_TYPE_PRINTER,
          { crypto: true, buffer: false },
          (devobj, retcode) => {
            if (retcode === "OK") {
              printerRef.current = devobj;
              setStatus("connected");
            } else {
              setStatus("disconnected");
              throw retcode;
            }
          },
        );
      } else {
        setStatus("disconnected");
        console.log(data);
      }
    });
  };

  /**
   *
   * @returns {void}
   */
  const init = () => {
    const prn = printerRef.current;
    if (!prn) {
      setStatus("disconnected");
      console.error("Printer not connected");
      return;
    }

    prn.addTextLang("ja");
    prn.addTextSize(2, 2);
  };

  /**
   *
   * @param {string} text
   * @param {[width:number, height:number]}
   * @returns {void}
   */
  const addLine = (text, [width, height]) => {
    const prn = printerRef.current;
    if (!prn) {
      setStatus("disconnected");
      console.error("Printer not connected");
      return;
    }

    prn.addTextSize(2, 2);
    prn.addText(" ");
    prn.addTextSize(width, height);
    prn.addText(`${text}\n`);
  };

  /**
   *
   * @param {number} orderId
   * @param {number || null} total
   * @returns {void}
   */
  const addHeader = (orderId, total) => {
    const prn = printerRef.current;
    if (!prn) {
      setStatus("disconnected");
      console.error("Printer not connected");
      return;
    }

    if (total !== null) {
      prn.addTextSize(1, 1);
      prn.addText(" ");
      prn.addTextSize(1, 2);
      prn.addText("明細 ");
      prn.addTextSize(1, 1);
      prn.addText("No.");
      prn.addTextSize(2, 2);
      prn.addText(`${orderId.toString().padStart(3, "0")}`);
      prn.addTextSize(1, 2);
      prn.addText(" ￥");
      prn.addTextSize(2, 2);
      prn.addText(`${total.toString()}-\n`);
    } else {
      prn.addTextSize(2, 2);
      prn.addText(" ");
      prn.addTextSize(1, 1);
      prn.addText("No.");
      prn.addTextSize(2, 2);
      prn.addText(`${orderId.toString()}\n`);
    }
  };

  /**
   *
   * @returns {void}
   */
  const addPageBegin = () => {
    const prn = printerRef.current;
    if (!prn) {
      setStatus("disconnected");
      console.error("Printer not connected");
      return;
    }
    prn.addPageBegin();
  };

  /**
   *
   * @returns {void}
   */
  const addPageEnd = () => {
    const prn = printerRef.current;
    if (!prn) {
      setStatus("disconnected");
      console.error("Printer not connected");
      return;
    }
    prn.addPageEnd();
  };

  /**
   *
   * @returns {void}
   */
  const addLogo = () => {
    const prn = printerRef.current;
    if (!prn) {
      setStatus("disconnected");
      console.error("Printer not connected");
      return;
    }
    prn.addLogo(32, 32);
  };

  /**
   *
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @returns {void}
   */
  const addPageArea = (x, y, w, h) => {
    const prn = printerRef.current;
    if (!prn) {
      setStatus("disconnected");
      console.error("Printer not connected");
      return;
    }
    prn.addPageArea(x, y, w, h);
  };

  /**
   *
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  const addPagePosition = (x, y) => {
    const prn = printerRef.current;
    if (!prn) {
      setStatus("disconnected");
      console.error("Printer not connected");
      return;
    }
    prn.addPagePosition(x, y);
  };

  /**
   * @param {number} line
   * @returns {void}
   * */
  const addFeed = (line) => {
    const prn = printerRef.current;
    if (!prn) {
      setStatus("disconnected");
      console.error("Printer not connected");
      return;
    }

    prn.addFeedLine(line);
  };

  /**
   *
   * @returns {void}
   */
  const feedNextTop = () => {
    const prn = printerRef.current;
    if (!prn) {
      setStatus("disconnected");
      console.error("Printer not connected");
      return;
    }
    prn.addFeedPosition(prn.FEED_NEXT_TOF);
  };

  /**
   *
   * @returns {void}
   */
  const feedCurrentTop = () => {
    const prn = printerRef.current;
    if (!prn) {
      setStatus("disconnected");
      console.error("Printer not connected");
      return;
    }
    prn.addFeedPosition(prn.FEED_CURRENT_TOF);
  };

  /**
   *
   * @returns {void}
   */
  const feedCut = () => {
    const prn = printerRef.current;
    if (!prn) {
      setStatus("disconnected");
      console.error("Printer not connected");
      return;
    }
    prn.addFeedPosition(prn.FEED_PEELING);
  };

  /**
   * ためた命令をプリンターへ送る。プリンターが印刷し終えたら解決し、印刷できなかったら理由を付けて失敗する
   * （印刷キューの済み・失敗に使う）。
   * @returns {Promise<void>}
   */
  const print = () =>
    new Promise((resolve, reject) => {
      const prn = printerRef.current;
      if (!prn) {
        setStatus("disconnected");
        reject(new Error("プリンターにつながっていません"));
        return;
      }
      const timer = setTimeout(() => {
        prn.onreceive = null;
        reject(new Error("プリンターから応答がありません"));
      }, PRINT_TIMEOUT_MS);
      prn.onreceive = (res) => {
        clearTimeout(timer);
        prn.onreceive = null;
        if (res?.success) {
          resolve();
        } else {
          reject(new Error(`印刷できませんでした（${res?.code ?? "不明"}）`));
        }
      };
      try {
        prn.send();
      } catch (e) {
        clearTimeout(timer);
        prn.onreceive = null;
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });

  const printer = {
    connect,
    /**
     * @type {"init"|"connecting"|"connected"|"disconnected"}
     */
    status,
    init,
    addLine,
    addHeader,
    addFeed,
    feedNextTop,
    feedCurrentTop,
    feedCut,
    addPageBegin,
    addPageEnd,
    addPageArea,
    addPagePosition,
    addLogo,
    print,
  };

  return printer;
};
