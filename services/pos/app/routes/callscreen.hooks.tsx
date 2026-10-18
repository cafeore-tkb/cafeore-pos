import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCallScreenSound } from "~/lib/callscreen-sound";

/** 光り始めてから、元に戻り始めるまで */
const FLASH_HOLD_MS = 5000;
/** 元に戻るフェードの長さ */
export const FLASH_FADE_MS = 1000;
/** 新しく入った番号を光らせる長さ（元に戻るフェードまで含む） */
export const FLASH_MS = FLASH_HOLD_MS + FLASH_FADE_MS;
/** 呼び出し催促した番号を目立たせ始めてから、元に戻り始めるまで */
export const URGENT_HOLD_MS = 60_000;
/** 呼び出し催促した番号を目立たせる長さ（元に戻るフェードまで含む） */
export const URGENT_MS = URGENT_HOLD_MS + FLASH_FADE_MS;

/**
 * 固定サイズのステージを画面に収める倍率を返す。
 * レイアウトは実寸のまま、拡大縮小だけで解像度差を吸収する。
 */
export function useStageScale(width: number, height: number) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const update = () => {
      setScale(
        Math.min(window.innerWidth / width, window.innerHeight / height),
      );
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [width, height]);

  return scale;
}

/** 光らせている 1 回分 */
export type Flash = {
  key: number;
  /** 光り始めた時刻（performance.now()）。作り直されたプレートでも、光り始めからの続きを出すのに使う */
  startedAt: number;
  /** 元に戻るフェードに入ったか */
  fading: boolean;
};

const NO_FLASHES: readonly Flash[] = [];

/**
 * 番号を holdMs のあいだ光らせ、FLASH_FADE_MS で元に戻す。既定は新しく入った番号の光（FLASH_MS）。
 * 呼び出し催促した番号を目立たせるのにも使う（URGENT_HOLD_MS を渡して URGENT_MS）。
 * 同じ番号でも呼ぶたびに別の 1 回として重ねるので、光っている最中にまた呼ばれても、それぞれが最後まで光る。
 * 光り方（地が浮かび、プリズムの光が抜けて、元に戻る）は CSS のアニメーションに任せ、ここでは光らせている回だけを持つ。
 */
export function useFlash(holdMs = FLASH_HOLD_MS) {
  const [flashes, setFlashes] = useState<ReadonlyMap<number, readonly Flash[]>>(
    () => new Map(),
  );
  const keyRef = useRef(0);
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  const startFlash = useCallback(
    (id: number) => {
      keyRef.current += 1;
      const key = keyRef.current;
      const timers = timersRef.current;

      // この回を書き換える。null なら外す
      const update = (change: (flash: Flash) => Flash | null) =>
        setFlashes((prev) => {
          const rest = (prev.get(id) ?? []).flatMap((flash) => {
            if (flash.key !== key) return [flash];
            const changed = change(flash);
            return changed ? [changed] : [];
          });
          const next = new Map(prev);
          if (rest.length > 0) next.set(id, rest);
          else next.delete(id);
          return next;
        });
      const later = (ms: number, run: () => void) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          run();
        }, ms);
        timers.add(timer);
      };

      const flash = { key, startedAt: performance.now(), fading: false };
      setFlashes((prev) =>
        new Map(prev).set(id, [...(prev.get(id) ?? []), flash]),
      );
      later(holdMs, () => update((it) => ({ ...it, fading: true })));
      later(holdMs + FLASH_FADE_MS, () => update(() => null));
    },
    [holdMs],
  );

  const flashesOf = useCallback(
    (id: number) => flashes.get(id) ?? NO_FLASHES,
    [flashes],
  );

  return { startFlash, flashesOf };
}

/**
 * 一覧に新しく入った番号だけを知らせる。
 *
 * enabled（最初の一覧を受け取ったか）が false の間は控えを取らず、true になった最初の一覧は
 * 「既にあったもの」として黙って覚える。画面を開き直したときに
 * 前からの呼び出しで鳴らしたり光らせたりしないため。
 */
export function useOnAdded<T>(
  ids: readonly T[],
  onAdded: (id: T) => void,
  enabled: boolean,
) {
  const knownRef = useRef<Set<T> | null>(null);

  useEffect(() => {
    const known = knownRef.current;
    knownRef.current = enabled ? new Set(ids) : null;

    if (known === null) return;

    for (const id of ids) {
      if (!known.has(id)) onAdded(id);
    }
  }, [ids, onAdded, enabled]);
}

/**
 * お呼び出し中のうち、画面に出す番号を返す。新しく呼んだ番号は reveal（チャイムを鳴らすとき）まで出さない。
 * 何件も立て続けに入っても、読み上げは 1 件ずつ順に流れるので、番号もそれに合わせて 1 件ずつ音と同時に出すため。
 *
 * useOnAdded と同じく、enabled（最初の一覧を受け取ったか）が true になった最初の一覧は読み上げないので、そのまま出す。
 * 呼び出しから外れた番号は忘れ、また呼ばれたら reveal まで待たせる
 */
export function useRevealedCalls(calling: readonly number[], enabled: boolean) {
  // null の間は最初の一覧を待っている（その一覧はそのまま出す）
  const [revealed, setRevealed] = useState<ReadonlySet<number> | null>(null);
  const callingRef = useRef(calling);
  callingRef.current = calling;

  useEffect(() => {
    if (!enabled) {
      setRevealed(null);
      return;
    }
    setRevealed((prev) => {
      if (prev === null) return new Set(calling);
      const kept = [...prev].filter((id) => calling.includes(id));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [calling, enabled]);

  /** 番号を画面に出す。鳴らすまでに提供済みなどで呼び出しから外れていたら false */
  const reveal = useCallback((id: number) => {
    if (!callingRef.current.includes(id)) return false;
    setRevealed((prev) => new Set(prev ?? []).add(id));
    return true;
  }, []);

  const shown = useMemo(
    () =>
      revealed === null ? calling : calling.filter((id) => revealed.has(id)),
    [calling, revealed],
  );

  return { shown, reveal };
}

/**
 * 呼び出しがある間は呼び出し画面を出し、無くなってから delayMs 後に CM へ戻す。
 * 提供が途切れるたびに切り替わらないよう、少し待ってから戻す。
 */
export function useCallVisibility(hasCalling: boolean, delayMs: number) {
  const [showCall, setShowCall] = useState(false);

  useEffect(() => {
    if (hasCalling) {
      setShowCall(true);
      return;
    }

    const timer = setTimeout(() => setShowCall(false), delayMs);
    return () => clearTimeout(timer);
  }, [hasCalling, delayMs]);

  return showCall;
}

/** チャイムが鳴り終わるのを待つ上限（ファイルは 2.6 秒） */
const CHIME_TIMEOUT_MS = 5_000;
/** 読み上げが鳴り終わるのを待つ上限 */
const VOICE_TIMEOUT_MS = 20_000;
/** 読み上げの音声を待つ上限。過ぎたら読み上げずに進む（呼び出しならチャイムだけ鳴らす） */
const VOICE_LOAD_TIMEOUT_MS = 8_000;
/** 先に作らせておくとき、ほかの画面と同時に作らないようにずらす幅 */
const WARM_JITTER_MS = 5_000;
/** 先に作らせる 1 件を待つ上限。返事が来ないまま止まると、後ろの先読みが全部止まるので打ち切る */
const WARM_TIMEOUT_MS = 15_000;

// 読み上げの音声は Worker（worker/call-voice.ts）が ElevenLabs で作り、片ごとに R2 に溜めたものをつないで返す。
// 文は Worker が決めるので、ここでは番号・「順番が前後するか」・ドリッパーの番号だけを渡す。

/** 呼び出しの読み上げ */
export const callVoicePath = (orderNo: number, reordered: boolean) =>
  `/call-voice/call?order=${orderNo}${reordered ? "&reordered=1" : ""}`;

/** 呼び出し催促の読み上げ（「N番のお客様、商品のご用意ができております。お急ぎ、提供口までお越しください。」） */
export const recallVoicePath = (orderNo: number) =>
  `/call-voice/recall?order=${orderNo}`;

/** ドリップの案内の読み上げ。invite が false なら「よろしければぜひ、お近くでご覧ください。」を省く */
export const dripVoicePath = (
  orderNos: readonly number[],
  dripper: number,
  invite: boolean,
) =>
  `/call-voice/drip?${orderNos.map((no) => `order=${no}`).join("&")}&dripper=${dripper}${invite ? "" : "&invite=0"}`;

/**
 * 音声を取りに行き、再生できる URL（blob:）にする。
 * 取れなければ null（ローカルの dev サーバーには Worker が無い、鍵が無い、ElevenLabs が落ちている、待ちきれないなど）
 */
const loadVoice = async (path: string): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOICE_LOAD_TIMEOUT_MS);
  try {
    const res = await fetch(path, { signal: controller.signal });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("audio/")) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** 最後まで鳴らす。鳴らせない・終わらないときも timeoutMs で先へ進む */
const playToEnd = (audio: HTMLAudioElement, timeoutMs: number) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      audio.removeEventListener("ended", done);
      audio.removeEventListener("error", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    audio.addEventListener("ended", done);
    audio.addEventListener("error", done);
    try {
      audio.currentTime = 0;
    } catch {
      // Safari など currentTime の操作に失敗する環境があるので握りつぶす
    }
    // 自動再生の制限で弾かれたら、待たずに次へ
    audio.play().catch(done);
  });

/** 読み上げのエコー。声から遅れて返すまでの秒数 */
const ECHO_DELAY_S = 0.12;
/** 返すたびに小さくする割合 */
const ECHO_FEEDBACK = 0.25;

/**
 * 読み上げに少しエコーをかける（Web Audio で、そのままの声に遅らせて小さくした声を重ねる）。
 * level は返す声の大きさ（そのままの声を 1 として。0 ならエコー無し）。
 * つなぐと要素の音は AudioContext からしか出なくなり、AudioContext が止まっている（自動再生の制限など）と声ごと消えるので、
 * 動いている（running）ときだけつなぐ。動かせない・Web Audio が無いときは、エコー無しで流す。
 * 一度つなぐと外せないので、切ったときは返す声を 0 にする
 */
function useEcho(audioRef: React.RefObject<HTMLAudioElement>) {
  const ctxRef = useRef<AudioContext | null>(null);
  const wetRef = useRef<GainNode | null>(null);

  return useCallback(
    (level: number) => {
      const wet = wetRef.current;
      if (wet) wet.gain.value = level;
      const audio = audioRef.current;
      // 切っていて、まだつないでいなければ Web Audio は使わない
      if (!audio || (level === 0 && !wet)) return;
      try {
        ctxRef.current ??= new AudioContext();
        const ctx = ctxRef.current;
        if (ctx.state !== "running") {
          void ctx.resume().catch(() => undefined);
          return;
        }
        if (wet) return;
        const source = ctx.createMediaElementSource(audio);
        const delay = ctx.createDelay();
        delay.delayTime.value = ECHO_DELAY_S;
        const feedback = ctx.createGain();
        feedback.gain.value = ECHO_FEEDBACK;
        const wetGain = ctx.createGain();
        wetGain.gain.value = level;
        source.connect(ctx.destination);
        source.connect(delay);
        delay.connect(feedback).connect(delay);
        delay.connect(wetGain).connect(ctx.destination);
        wetRef.current = wetGain;
      } catch {
        // Web Audio が使えなければ、エコー無しで流す
      }
    },
    [audioRef],
  );
}

export type Announcement = {
  /** 読み上げの音声（callVoicePath・recallVoicePath・dripVoicePath） */
  path: string;
  /** 呼び出し（催促も）か、ドリップの案内か。設定の callVoice・dripVoice のどちらで読み上げるか決める */
  kind: "call" | "drip";
  /** 読み上げの前にチャイムを鳴らすか（呼び出しと呼び出し催促だけ鳴らす） */
  chime: boolean;
  /** 鳴らし始めるとき（音声が届いて、チャイムを鳴らす直前）に呼ぶ。呼び出しの番号を音と同時に画面に出したり、催促した番号を目立たせ始めたりするのに使う */
  onStart?: () => void;
};

/**
 * 読み上げる。何件も重なったときは 1 件ずつ順に流す。
 * 音声は頼んだ時点で取りに行き、届いてからチャイムを鳴らして、間を空けずに続けて流す
 * （届く前にチャイムを鳴らすと、作っている間だけチャイムと声の間が空く）。
 * 音声が取れない・読み上げを切っているときは、チャイムだけ鳴らす（チャイムの無い案内は何も鳴らさない）。
 * チャイム・読み上げ・エコーは、頼んだ時点の設定（lib/callscreen-sound）で鳴らすか決める
 */
export function useAnnouncer(
  chimeRef: React.RefObject<HTMLAudioElement>,
  voiceRef: React.RefObject<HTMLAudioElement>,
) {
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const echo = useEcho(voiceRef);

  return useCallback(
    ({ path, kind, chime, onStart }: Announcement) => {
      const sound = getCallScreenSound();
      const voiceOn = kind === "drip" ? sound.dripVoice : sound.callVoice;
      const voice = voiceOn ? loadVoice(path) : Promise.resolve(null);
      const echoLevel = sound.echo ? sound.echoLevel / 100 : 0;
      queueRef.current = queueRef.current.then(async () => {
        const url = await voice;
        const audio = voiceRef.current;
        // チャイムの間に読み込ませ、AudioContext も動かしておき、鳴り終わったらすぐ流せるようにする
        if (url && audio) {
          audio.src = url;
          audio.load();
          echo(echoLevel);
        }
        onStart?.();
        const chimeAudio = chimeRef.current;
        if (chime && sound.chime && chimeAudio) {
          await playToEnd(chimeAudio, CHIME_TIMEOUT_MS);
        }
        if (url && audio) {
          echo(echoLevel);
          await playToEnd(audio, VOICE_TIMEOUT_MS);
        }
        if (url) URL.revokeObjectURL(url);
      });
    },
    [chimeRef, voiceRef, echo],
  );
}

/**
 * 呼び出しの読み上げを先に作らせておく（Worker が R2 に溜め、ブラウザにも 1 時間持たせる）。呼ぶときに作るのを待たずに済む。
 * 番号の片はドリップの案内と同じものなので、そちらも速くなる。
 * 新しく見えた番号ごとに 1 回だけ、1 件ずつ頼む。開いたあとに入った注文は、呼び出し画面が何台もあると
 * 同時に頼んで二重に作りうるので、少しずらしてから頼む（開いたときにあった注文は、ほかの画面がもう作っているので、ずらさない）
 */
export function useWarmCallVoices(
  orderNos: readonly number[],
  enabled: boolean,
) {
  const warmedRef = useRef<Set<number> | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!enabled) return;
    const initial = warmedRef.current === null;
    const warmed = warmedRef.current ?? new Set<number>();
    warmedRef.current = warmed;
    for (const no of orderNos) {
      if (warmed.has(no)) continue;
      warmed.add(no);
      const jitter = initial ? 0 : Math.random() * WARM_JITTER_MS;
      chainRef.current = chainRef.current
        .then(() => new Promise((resolve) => setTimeout(resolve, jitter)))
        // 本文まで読み切って、ブラウザのキャッシュに入れる（打ち切りは本文を読むところまで効く）
        .then(async () => {
          const res = await fetch(callVoicePath(no, false), {
            signal: AbortSignal.timeout(WARM_TIMEOUT_MS),
          });
          await res.arrayBuffer();
        })
        .then(
          () => undefined,
          () => undefined,
        );
    }
  }, [orderNos, enabled]);
}
