import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Web Speech API の標準名と Safari/Chrome の接頭辞付き実装の両方を扱う。
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

/** 5番目の操作。認識結果は確認してからマスターのコメントとして送る。 */
export const VoiceComment = ({
  orderId,
  sending,
  send,
}: {
  orderId: string;
  sending: boolean;
  send: (orderId: string, text: string) => Promise<boolean>;
}) => {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const stop = () => {
    const active = recognition.current;
    recognition.current = null;
    if (active) {
      active.onresult = null;
      active.onerror = null;
      active.onend = null;
      active.abort();
    }
    setListening(false);
  };
  useEffect(
    () => () => {
      const active = recognition.current;
      if (active) {
        active.onresult = null;
        active.onerror = null;
        active.onend = null;
        active.abort();
      }
    },
    [],
  );

  const start = () => {
    if (recognition.current || sending) return;
    setOpen(true);
    const speechWindow = window as SpeechWindow;
    const Constructor =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) {
      setMessage(
        "このブラウザでは音声入力に対応していません。文字を入力してください。",
      );
      return;
    }
    const active = new Constructor();
    recognition.current = active;
    active.lang = "ja-JP";
    active.continuous = false;
    active.interimResults = true;
    const before = text.trim();
    active.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join("");
      setText([before, transcript.trim()].filter(Boolean).join(" "));
    };
    active.onerror = (event) => {
      setMessage(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "マイクの使用を許可するか、文字を入力してください。"
          : "音声を認識できませんでした。もう一度マイクを押すか、文字を入力してください。",
      );
      stop();
    };
    active.onend = () => {
      recognition.current = null;
      setListening(false);
      setMessage((current) => current || "内容を確認して送信してください。");
    };
    try {
      setMessage("");
      setListening(true);
      active.start();
    } catch {
      stop();
      setMessage("音声入力を開始できませんでした。文字を入力してください。");
    }
  };
  return (
    <>
      <button
        type="button"
        aria-label={listening ? "音声入力を停止" : "音声でコメントを入力"}
        aria-pressed={listening}
        title={listening ? "音声入力を停止" : "音声入力"}
        disabled={sending}
        onClick={(event) => {
          event.stopPropagation();
          if (listening) recognition.current?.stop();
          else start();
        }}
        className={`flex h-12 min-w-10 flex-1 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-lg border px-1 disabled:opacity-40 ${listening ? "border-red-600 bg-red-100 text-red-700" : "border-slate-300 bg-white text-slate-700 active:bg-slate-100"}`}
      >
        {listening ? (
          <Square aria-hidden="true" className="h-5 w-5 fill-current" />
        ) : (
          <Mic aria-hidden="true" className="h-5 w-5" />
        )}
        <span className="font-bold text-[9px]">
          {listening ? "停止" : "音声入力"}
        </span>
      </button>
      {open && (
        <div
          className="grid w-full gap-2 rounded-lg border border-slate-300 bg-white p-2"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <output className="text-[12px] text-slate-600">
            {listening ? "聞き取り中… 話し終えたら停止してください" : message}
          </output>
          <textarea
            aria-label="送信するコメント"
            value={text}
            disabled={listening || sending}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            placeholder="コメントを入力"
            className="w-full resize-y rounded border border-slate-300 p-2 text-[16px] text-slate-950 disabled:bg-slate-100"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={sending}
              onClick={() => {
                stop();
                setOpen(false);
              }}
              className="min-h-10 rounded border border-slate-300 px-3 text-sm disabled:opacity-40"
            >
              閉じる
            </button>
            <button
              type="button"
              disabled={listening || sending || !text.trim()}
              onClick={async () => {
                if (await send(orderId, text.trim())) {
                  setText("");
                  setMessage("");
                  setOpen(false);
                }
              }}
              className="min-h-10 rounded bg-slate-900 px-3 font-bold text-sm text-white disabled:opacity-40"
            >
              {sending ? "送信中" : "送信"}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
