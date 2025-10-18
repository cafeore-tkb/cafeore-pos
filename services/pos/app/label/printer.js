import { useEffect, useRef, useState } from "react";

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
    const ePosDev = new window.epson.ePOSDevice();
    ePosDeviceRef.current = ePosDev;

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
      prn.addText("領収書 ");
      prn.addTextSize(1, 1);
      prn.addText("No.");
      prn.addTextSize(2, 2);
      prn.addText(`${orderId.toString().padEnd(3, " ")}`);
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
  const print = () => {
    const prn = printerRef.current;
    if (!prn) {
      setStatus("disconnected");
      console.error("Printer not connected");
      return;
    }

    prn.send();
  };

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
    print,
  };

  return printer;
};
