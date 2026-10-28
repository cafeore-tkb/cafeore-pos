import { type ReactNode, useRef } from "react";
import { toast } from "sonner";
import brightNotifications from "~/assets/callscreen/bright-notifications.mp3";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import {
  CM_IMAGE_SECONDS_MAX,
  CM_IMAGE_SECONDS_MIN,
  type CmItem,
  type CmPlaylist,
  cmItemKind,
} from "~/lib/callscreen-cm";
import {
  CALL_SCREEN_SOUND_DEFAULT,
  type CallScreenSoundFlag,
  ECHO_LEVEL_MAX,
  ECHO_LEVEL_MIN,
  ECHO_LEVEL_STEP,
  setCallScreenSound,
  useCallScreenSound,
} from "~/lib/callscreen-sound";
import { callVoicePath, useAnnouncer } from "~/routes/callscreen.hooks";

/**
 * CM の並びを変えるもの。元のタブではこのタブの並び（lib/callscreen-cm の cmPlaylist）を直に、
 * 小窓では元のタブに頼んで変える（lib/callscreen-companion）
 */
export interface CmPlaylistControl {
  /** 動画・画像だけを渡す */
  add(files: File[]): void;
  remove(id: string): void;
  move(id: string, delta: -1 | 1): void;
  clear(): void;
  setImageSeconds(seconds: number): void;
}

const SOUND_FIELDS: {
  key: CallScreenSoundFlag;
  label: string;
  description: string;
}[] = [
  {
    key: "chime",
    label: "チャイム",
    description: "呼び出しの読み上げの前に鳴らします",
  },
  {
    key: "voice",
    label: "読み上げ",
    description:
      "呼び出しとドリップの案内を読み上げます。切ると読み上げの音声を作らせません",
  },
  {
    key: "echo",
    label: "読み上げのエコー",
    description: "読み上げに少しエコーをかけます",
  },
];

/** 試しに聞くときに読む番号 */
const PREVIEW_ORDER_NO = 1;

/** このブラウザで流せそうか（動画だけ見る。canPlayType が空なら流せない） */
const playableHere = (item: CmItem) =>
  item.kind !== "video" ||
  document.createElement("video").canPlayType(item.type) !== "";

/**
 * 呼び出し画面の設定（CM と音）。/callscreen を開いたときと、外部ディスプレイに出している間の小窓の中身。
 * header に見出しを、display に出す先の選び方（小窓では表示中の画面）を渡す
 */
export function CallScreenSettings({
  header,
  display,
  playlist,
  control,
}: {
  header: ReactNode;
  display: ReactNode;
  playlist: CmPlaylist;
  control: CmPlaylistControl;
}) {
  const { items, imageSeconds } = playlist;
  const sound = useCallScreenSound();
  const fileRef = useRef<HTMLInputElement>(null);
  // 試しに聞くとき用。呼び出し画面と同じ流し方（useAnnouncer）で鳴らす
  const chimeRef = useRef<HTMLAudioElement>(null);
  const voiceRef = useRef<HTMLAudioElement>(null);
  const announce = useAnnouncer(chimeRef, voiceRef);

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const accepted = [...files].filter((file) => cmItemKind(file) !== null);
    const rejected = [...files]
      .filter((file) => cmItemKind(file) === null)
      .map((file) => file.name);
    if (accepted.length > 0) control.add(accepted);
    if (rejected.length > 0) {
      toast.error(
        `動画・画像でないので足せませんでした：${rejected.join("、")}`,
      );
    }
    // 同じファイルをもう一度選んでも足せるように空にする
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
      {header}

      {display}

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-semibold text-lg">CM</h2>
          <p className="text-muted-foreground text-sm">
            呼び出しの無い間に流す動画・画像を、この端末のファイルから選びます。上から順に繰り返し流します（動画は最後まで、画像は下の秒数だけ）。
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="cm-files">動画・画像を足す</Label>
            <Input
              id="cm-files"
              ref={fileRef}
              type="file"
              accept="video/*,image/*"
              multiple
              onChange={(e) => addFiles(e.target.files)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cm-image-seconds">画像を出す秒数</Label>
            {/* 打っている途中で丸めないよう、欄を離れたときに決める（決めた値で欄を作り直す） */}
            <Input
              key={imageSeconds}
              id="cm-image-seconds"
              type="number"
              min={CM_IMAGE_SECONDS_MIN}
              max={CM_IMAGE_SECONDS_MAX}
              defaultValue={imageSeconds}
              onBlur={(e) => control.setImageSeconds(Number(e.target.value))}
              className="w-28"
            />
          </div>
          {items.length > 0 && (
            <Button variant="outline" onClick={() => control.clear()}>
              すべて外す
            </Button>
          )}
        </div>

        {items.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
            まだ選んでいません。選ばなければ、呼び出し画面は置いてある
            CM（なければロゴの画面）を出します。
          </p>
        ) : (
          <ol className="divide-y rounded-md border">
            {items.map((item, index) => (
              <li key={item.id} className="flex items-center gap-3 p-3">
                <span className="w-6 text-right text-muted-foreground text-sm tabular-nums">
                  {index + 1}
                </span>
                <div className="h-16 w-28 shrink-0 overflow-hidden rounded bg-black">
                  {item.kind === "video" ? (
                    <video
                      src={item.url}
                      muted
                      preload="metadata"
                      className="h-full w-full object-cover"
                    >
                      <track kind="captions" />
                    </video>
                  ) : (
                    <img
                      src={item.url}
                      alt=""
                      className="h-full w-full object-contain"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">{item.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {item.kind === "video"
                      ? "動画"
                      : `画像（${imageSeconds} 秒）`}
                  </p>
                  {!playableHere(item) && (
                    <p className="text-red-700 text-xs">
                      このブラウザでは流せない形式かもしれません（H.264 の mp4
                      にすると確実です）。流せなければ飛ばします
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={index === 0}
                    onClick={() => control.move(item.id, -1)}
                    aria-label="上へ"
                  >
                    ↑
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={index === items.length - 1}
                    onClick={() => control.move(item.id, 1)}
                    aria-label="下へ"
                  >
                    ↓
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => control.remove(item.id)}
                  >
                    外す
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-semibold text-lg">音</h2>
          <p className="text-muted-foreground text-sm">
            呼び出し画面で鳴らす音です。CM
            のファイルと違い、この端末に覚えます（読み込み直しても残り、ほかのタブ・窓で開いている呼び出し画面にもすぐ効きます）。
          </p>
        </div>
        <div className="grid gap-4">
          {SOUND_FIELDS.map(({ key, label, description }) => (
            <div key={key} className="flex items-start gap-3">
              <Switch
                id={`sound-${key}`}
                checked={sound[key]}
                disabled={key === "echo" && !sound.voice}
                onCheckedChange={(checked) =>
                  setCallScreenSound({ ...sound, [key]: checked })
                }
              />
              <div className="grid gap-1">
                <Label htmlFor={`sound-${key}`}>{label}</Label>
                <p className="text-muted-foreground text-xs">{description}</p>
              </div>
            </div>
          ))}
          {/* スイッチの幅（w-11）と間（gap-3）だけずらし、エコーの欄の下にそろえる */}
          <div className="grid gap-1 pl-14">
            <Label htmlFor="sound-echo-level">エコーの強さ</Label>
            <div className="flex items-center gap-3">
              <input
                id="sound-echo-level"
                type="range"
                min={ECHO_LEVEL_MIN}
                max={ECHO_LEVEL_MAX}
                step={ECHO_LEVEL_STEP}
                value={sound.echoLevel}
                disabled={!sound.voice || !sound.echo}
                onChange={(e) =>
                  setCallScreenSound({
                    ...sound,
                    echoLevel: Number(e.target.value),
                  })
                }
                className="w-56 accent-primary disabled:opacity-50"
              />
              <span className="text-sm tabular-nums">{sound.echoLevel}%</span>
            </div>
            <p className="text-muted-foreground text-xs">
              返す声の大きさです（読み上げの声を 100% として）。既定は{" "}
              {CALL_SCREEN_SOUND_DEFAULT.echoLevel}
              %。上げるほど響きますが、番号は聞き取りにくくなります
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={!sound.chime && !sound.voice}
            onClick={() =>
              announce({
                path: callVoicePath(PREVIEW_ORDER_NO, false),
                chime: true,
              })
            }
          >
            試しに聞く
          </Button>
          <p className="text-muted-foreground text-xs">
            {PREVIEW_ORDER_NO}
            番の呼び出しを、今の設定（チャイム・読み上げ・エコー）でこの端末から流します
          </p>
        </div>
        <audio src={brightNotifications} ref={chimeRef} preload="auto">
          <track kind="captions" />
        </audio>
        <audio ref={voiceRef} preload="none">
          <track kind="captions" />
        </audio>
      </section>
    </div>
  );
}
