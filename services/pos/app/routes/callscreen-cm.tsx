import { useRef } from "react";
import { Link, type MetaFunction } from "react-router";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  CM_IMAGE_SECONDS_MAX,
  CM_IMAGE_SECONDS_MIN,
  type CmItem,
  cmPlaylist,
  useCmPlaylist,
} from "~/lib/callscreen-cm";

export const meta: MetaFunction = () => {
  return [{ title: "呼び出し画面の CM / 珈琲・俺POS" }];
};

/** このブラウザで流せそうか（動画だけ見る。canPlayType が空なら流せない） */
const playableHere = (item: CmItem) =>
  item.kind !== "video" ||
  document.createElement("video").canPlayType(item.type) !== "";

export default function CallScreenCmPage() {
  const { items, imageSeconds } = useCmPlaylist();
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const rejected = cmPlaylist.add([...files]);
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
      <header className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">
          呼び出し画面の CM
        </h1>
        <p className="text-muted-foreground text-sm">
          呼び出し画面が呼び出しの無い間に流す動画・画像を、この端末のファイルから選びます。上から順に繰り返し流します（動画は最後まで、画像は下の秒数だけ）。
        </p>
        <p className="text-muted-foreground text-sm">
          選んだファイルはどこにも上げず、
          <span className="font-semibold text-foreground">
            このタブの中だけで覚えます
          </span>
          。読み込み直したりタブを閉じたりすると消えます。呼び出し画面は、下の「呼び出し画面を開く」からこのタブのまま開いてください（新しいタブで開くと流れません）。
        </p>
      </header>

      <section className="flex flex-wrap items-end gap-3">
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
            onBlur={(e) => cmPlaylist.setImageSeconds(Number(e.target.value))}
            className="w-28"
          />
        </div>
      </section>

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
                  onClick={() => cmPlaylist.move(item.id, -1)}
                  aria-label="上へ"
                >
                  ↑
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={index === items.length - 1}
                  onClick={() => cmPlaylist.move(item.id, 1)}
                  aria-label="下へ"
                >
                  ↓
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => cmPlaylist.remove(item.id)}
                >
                  外す
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/callscreen">呼び出し画面を開く</Link>
        </Button>
        {items.length > 0 && (
          <Button variant="outline" onClick={() => cmPlaylist.clear()}>
            すべて外す
          </Button>
        )}
      </div>
    </div>
  );
}
