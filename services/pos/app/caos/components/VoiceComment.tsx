import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFloatingWindow } from "./FloatingWindows";

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
  onstart: (() => void) | null;
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
  const [phase, setPhase] = useState<
    "idle" | "starting" | "listening" | "stopping"
  >("idle");
  const listening = phase === "listening";
  const voiceBusy = phase !== "idle";
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const floating = useFloatingWindow(
    `音声コメント ${orderId.slice(0, 6)}`,
    open,
  );
  const panelRef = useRef<HTMLDivElement | null>(null);
  const micRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognition = useRef<Recognition | null>(null);
  const stop = () => {
    const active = recognition.current;
    recognition.current = null;
    if (active) {
      active.onstart = null;
      active.onresult = null;
      active.onerror = null;
      active.onend = null;
      active.abort();
    }
    setPhase("idle");
  };
  useEffect(
    () => () => {
      const active = recognition.current;
      if (active) {
        active.onstart = null;
        active.onresult = null;
        active.onerror = null;
        active.onend = null;
        active.abort();
      }
    },
    [],
  );

  useEffect(() => {
    if (!open || floating.hidden) return;
    let typingAtPress = false;
    const rememberTyping = () => {
      typingAtPress = document.activeElement === inputRef.current;
    };
    const closeOutside = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-popup-tray]"))
        return;
      if (
        !(target instanceof Node) ||
        panelRef.current?.contains(target) ||
        micRef.current?.contains(target)
      )
        return;
      // 録音中・送信中はほかの盤面操作を止めず、クリックをそのまま通す。
      if (voiceBusy || sending) return;
      // 入力中の最初のタップではキーボードだけを閉じ、下書きとパネルは残す。
      if (typingAtPress || document.activeElement === inputRef.current)
        inputRef.current?.blur();
      else floating.hide();
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener("pointerdown", rememberTyping, true);
    document.addEventListener("click", closeOutside, true);
    return () => {
      document.removeEventListener("pointerdown", rememberTyping, true);
      document.removeEventListener("click", closeOutside, true);
    };
  }, [open, voiceBusy, sending, floating.hidden, floating.hide]);

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
    active.continuous = true;
    active.interimResults = true;
    const before = text.trim();
    let began = false;
    let receivedText = false;
    active.onstart = () => {
      if (recognition.current !== active) return;
      began = true;
      setPhase("listening");
    };
    active.onresult = (event) => {
      if (recognition.current !== active) return;
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join("");
      if (transcript.trim()) receivedText = true;
      setText([before, transcript.trim()].filter(Boolean).join(" "));
    };
    active.onerror = (event) => {
      if (recognition.current !== active) return;
      setMessage(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "音声入力が許可されていません。ブラウザのマイク許可と、iPadではSiriの設定を確認してください。文字入力も使えます。"
          : event.error === "audio-capture"
            ? "マイクを使えません。ほかの録音を止めて、もう一度試してください。文字入力も使えます。"
            : event.error === "network"
              ? "音声認識に接続できません。通信を確認するか、文字を入力してください。"
              : "音声を認識できませんでした。もう一度マイクを押すか、文字を入力してください。",
      );
      stop();
    };
    active.onend = () => {
      if (recognition.current !== active) return;
      recognition.current = null;
      setPhase("idle");
      if (!receivedText)
        setMessage(
          began
            ? "音声を取得できず終了しました。もう一度話すか、文字・キーボードの音声入力を使ってください。"
            : "音声入力が始まる前に終了しました。ブラウザのマイク許可と、iPadではSiriの設定を確認してください。文字・キーボードの音声入力も使えます。",
        );
    };
    try {
      setMessage("");
      setPhase("starting");
      active.start();
    } catch {
      stop();
      setMessage("音声入力を開始できませんでした。文字を入力してください。");
    }
  };
  const finish = () => {
    if (phase === "starting" || phase === "stopping") {
      stop();
      return;
    }
    const active = recognition.current;
    if (!active || phase !== "listening") return;
    setPhase("stopping");
    try {
      active.stop();
    } catch {
      stop();
    }
  };
  const buttonLabel =
    phase === "starting"
      ? "準備中"
      : phase === "stopping"
        ? "処理中"
        : listening
          ? "停止"
          : "音声入力";
  return (
    <>
      <button
        ref={micRef}
        type="button"
        aria-label={
          phase === "starting"
            ? "音声入力の開始を中止"
            : phase === "stopping"
              ? "音声入力の終了待機を中止"
              : voiceBusy
                ? "音声入力を停止"
                : "音声でコメントを入力"
        }
        aria-pressed={voiceBusy}
        title={phase === "starting" ? "音声入力の開始を中止" : buttonLabel}
        disabled={sending}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (voiceBusy) finish();
          else {
            floating.restore();
            start();
          }
        }}
        className={`flex h-12 min-w-14 flex-1 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-lg border px-1 active:ring-2 active:ring-slate-500 active:ring-offset-1 disabled:opacity-40 ${voiceBusy ? "border-red-600 bg-red-100 text-red-700" : "border-slate-300 bg-white text-slate-700 active:bg-slate-100"}`}
      >
        {listening ? (
          <Square
            aria-hidden="true"
            className="caos-voice-recording pointer-events-none h-6 w-6 fill-current"
          />
        ) : (
          <Mic aria-hidden="true" className="h-5 w-5" />
        )}
        <span className="pointer-events-none whitespace-nowrap font-bold text-[11px]">
          {buttonLabel}
        </span>
      </button>
      {open && (
        <div
          ref={(element) => {
            panelRef.current = element;
            floating.ref.current = element;
          }}
          style={floating.style}
          data-popup-hidden={floating.hidden}
          data-voice-panel
          data-voice-busy={voiceBusy || sending || undefined}
          className="grid w-full gap-2 rounded-lg border border-slate-300 bg-white p-2"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <header className="flex items-center gap-1">
            {floating.handle}
            <span className="flex-1 font-bold text-xs">音声コメント</span>
            <button
              type="button"
              onClick={floating.hide}
              aria-label="音声コメントを非表示"
              className="h-10 w-10"
            >
              ×
            </button>
          </header>
          {(voiceBusy || message) && (
            <div className="flex min-w-0 items-center gap-2">
              <output className="min-w-0 flex-1 text-[12px] text-slate-600">
                {phase === "starting"
                  ? "音声入力を準備中… マイクの許可を確認してください"
                  : phase === "stopping"
                    ? "音声を文字にしています…"
                    : listening
                      ? "聞き取り中… 止めてから編集・送信できます"
                      : message}
              </output>
              {!voiceBusy && message && (
                <button
                  type="button"
                  onClick={() => inputRef.current?.focus()}
                  className="min-h-12 shrink-0 touch-manipulation rounded-lg border border-slate-400 px-3 font-bold text-slate-700 text-sm"
                >
                  キーボードで入力
                </button>
              )}
              {voiceBusy && (
                <button
                  type="button"
                  onClick={finish}
                  className="flex min-h-12 min-w-24 shrink-0 touch-manipulation items-center justify-center gap-1 rounded-lg border border-red-600 bg-red-100 px-3 font-bold text-red-700 text-sm"
                >
                  <Square aria-hidden="true" className="h-4 w-4 fill-current" />
                  {phase === "starting"
                    ? "開始を中止"
                    : phase === "stopping"
                      ? "待機を中止"
                      : "録音を停止"}
                </button>
              )}
            </div>
          )}
          <div className="flex min-w-0 items-stretch gap-2">
            <textarea
              ref={inputRef}
              aria-label="送信するコメント"
              value={text}
              disabled={voiceBusy || sending}
              onChange={(event) => setText(event.target.value)}
              rows={2}
              placeholder="コメントを入力"
              className="min-w-0 flex-1 resize-y rounded border border-slate-300 p-2 text-[16px] text-slate-950 disabled:bg-slate-100"
            />
            <button
              type="button"
              disabled={voiceBusy || sending || !text.trim()}
              onClick={async () => {
                if (await send(orderId, text.trim())) {
                  setText("");
                  setMessage("");
                  setOpen(false);
                }
              }}
              className="min-h-10 w-16 shrink-0 rounded bg-slate-900 px-2 font-bold text-sm text-white disabled:opacity-40"
            >
              {sending ? "送信中" : "送信"}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
