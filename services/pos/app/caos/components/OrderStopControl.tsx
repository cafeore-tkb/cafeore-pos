import {
  type MasterState,
  getMasterState,
  responseToMasterState,
  updateMasterStatus,
} from "@cafeore/common";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";
import { useOutsidePress } from "../hooks/useOutsidePress";

// DBのマイクロ秒も比較する。Date.parseだけでは同じミリ秒内の更新を並べられない。
const version = (state: MasterState | null) => {
  if (!state) return 0n;
  const ms = Date.parse(state.createdAt);
  if (!Number.isFinite(ms)) return 0n;
  const fraction = state.createdAt.match(/\.(\d+)/)?.[1] ?? "";
  return (
    BigInt(Math.floor(ms / 1000)) * 1_000_000_000n +
    BigInt(fraction.padEnd(9, "0").slice(0, 9))
  );
};

/** 受付停止を全画面へ知らせる。注文の送信・盤面の抽出操作はロックしない。 */
export const OrderStopControl = () => {
  const { masterState, status } = useOrdersWSContext();
  const [current, setCurrent] = useState<MasterState | null | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<MasterState | null>();
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const latest = useRef(current);
  latest.current = current;
  const accept = (state: MasterState | null) =>
    setCurrent((before) =>
      before === undefined || version(state) >= version(before)
        ? state
        : before,
    );

  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    return () => {
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, []);
  useEffect(() => {
    if (masterState)
      setCurrent((before) =>
        before === undefined || version(masterState) >= version(before)
          ? masterState
          : before,
      );
  }, [masterState]);
  useEffect(() => {
    generation.current += reload + 1;
    const request = generation.current;
    setLoaded(false);
    setOpen(false);
    setLoadError(false);
    if (status !== "open" || !online) return;
    getMasterState()
      .then((states) => {
        if (request !== generation.current) return;
        const state = states.at(-1) ?? null;
        setCurrent((before) =>
          before === undefined || version(state) >= version(before)
            ? state
            : before,
        );
        setLoaded(true);
      })
      .catch(() => {
        if (request === generation.current) {
          setLoadError(true);
          toast.error("受付状態を取得できませんでした");
        }
      });
    return () => {
      generation.current++;
    };
  }, [status, online, reload]);
  useOutsidePress(
    open,
    (target) => Boolean(root.current?.contains(target)),
    () => setOpen(false),
  );
  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        root.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  useEffect(() => {
    if (
      open &&
      current !== undefined &&
      (current?.type !== confirmation?.type ||
        current?.createdAt !== confirmation?.createdAt)
    )
      setOpen(false);
  }, [open, current, confirmation]);
  const available =
    loaded && current !== undefined && online && status === "open";
  const stopped = current?.type === "stop";
  const label =
    !online || status !== "open"
      ? "受付状態未確認"
      : !loaded
        ? loadError
          ? "受付状態を再取得"
          : "受付状態を確認中"
        : stopped
          ? "受付停止中"
          : "受付中";
  const submit = async () => {
    if (!available || busy.current || !navigator.onLine) return;
    const seen = confirmation;
    if (seen === undefined) return;
    if (
      seen?.createdAt !== latest.current?.createdAt ||
      seen?.type !== latest.current?.type
    ) {
      setOpen(false);
      toast.error("受付状態が変わりました。最新の状態を確認してください");
      return;
    }
    busy.current = true;
    setSending(true);
    const target = seen?.type === "stop" ? "operational" : "stop";
    try {
      const result = await updateMasterStatus(target, {
        type: seen?.type === "stop" ? "stop" : "operational",
        created_at: seen?.createdAt ?? null,
      });
      if (result) accept(responseToMasterState(result));
      toast(
        target === "stop" ? "オーダーストップしました" : "受付を再開しました",
      );
      setOpen(false);
    } catch (error) {
      toast.error("受付状態を変更できませんでした", {
        description: error instanceof Error ? error.message : undefined,
      });
      // 409・送信結果が不明な場合も最新を読むだけ。停止・再開は自動再送しない。
      setLoaded(false);
      setOpen(false);
      const request = generation.current;
      try {
        const states = await getMasterState();
        if (request === generation.current && navigator.onLine) {
          accept(states.at(-1) ?? null);
          setLoaded(true);
        }
      } catch {
        setLoadError(true);
      }
    } finally {
      busy.current = false;
      setSending(false);
    }
  };
  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-label="オーダー受付の状態と切替"
        aria-expanded={open}
        aria-controls="caos-order-stop-panel"
        disabled={
          !online || status !== "open" || sending || (!loaded && !loadError)
        }
        onClick={() => {
          if (loadError && !loaded) {
            setReload((value) => value + 1);
            return;
          }
          setConfirmation(current);
          setOpen((value) => !value);
        }}
        className={`flex h-11 touch-manipulation items-center gap-1 whitespace-nowrap rounded-lg border px-3 font-bold text-sm disabled:opacity-50 ${stopped ? "border-violet-300 bg-violet-100 text-violet-800" : "border-slate-300 bg-slate-100 text-slate-700"}`}
      >
        <span aria-hidden="true">●</span>
        {label}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <section
          id="caos-order-stop-panel"
          aria-label="オーダー受付"
          className="absolute top-[calc(100%+8px)] right-0 z-[100] w-[340px] max-w-[calc(100vw-16px)] rounded-lg border border-slate-300 bg-white p-4 text-slate-900 shadow-xl"
        >
          <h2 className="font-bold text-lg">オーダー受付</h2>
          <p className="my-3 text-sm leading-relaxed">
            {confirmation?.type === "stop"
              ? "現在、受付を停止しています。"
              : "レジに受付停止を知らせます。"}
            <br />
            注文入力・送信はロックされません。
          </p>
          <button
            type="button"
            disabled={!available || sending}
            onClick={() => void submit()}
            className={`h-11 w-full touch-manipulation rounded-md font-bold text-white disabled:opacity-50 ${confirmation?.type === "stop" ? "bg-sky-700" : "bg-violet-700"}`}
          >
            {sending
              ? "変更中…"
              : confirmation?.type === "stop"
                ? "受付を再開する"
                : "オーダーストップする"}
          </button>
        </section>
      )}
    </div>
  );
};
