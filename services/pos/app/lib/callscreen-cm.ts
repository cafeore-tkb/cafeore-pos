import { useSyncExternalStore } from "react";

// 呼び出し画面で流す CM の並び。マスタ設定の「呼び出し画面の CM」（/callscreen-cm）で、この端末のファイルを選ぶ。
//
// ファイルはどこにも上げず、保存もしない。選んだファイルをこのタブのメモリにだけ持ち（blob: の URL）、
// 同じタブで開いた呼び出し画面が順番に流す。読み込み直す・タブを閉じると消える。
// 画面どうしは SPA の中の移動（<Link>）なので、同じタブなら選んだものが残る。

export type CmItemKind = "video" | "image";

export interface CmItem {
  id: string;
  /** ファイルの名前 */
  name: string;
  kind: CmItemKind;
  /** ファイルの種類（MIME。video/mp4 など） */
  type: string;
  /** このタブの中だけで使える URL（URL.createObjectURL） */
  url: string;
}

export interface CmPlaylist {
  items: readonly CmItem[];
  /** 画像を出しておく秒数 */
  imageSeconds: number;
}

export const CM_IMAGE_SECONDS_DEFAULT = 10;
export const CM_IMAGE_SECONDS_MIN = 3;
export const CM_IMAGE_SECONDS_MAX = 120;

let playlist: CmPlaylist = {
  items: [],
  imageSeconds: CM_IMAGE_SECONDS_DEFAULT,
};
const listeners = new Set<() => void>();

const update = (next: CmPlaylist) => {
  playlist = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => playlist;

/** ファイルの種類（動画・画像でなければ null） */
export const cmItemKind = (file: Pick<File, "type">): CmItemKind | null => {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  return null;
};

let seq = 0;

export const cmPlaylist = {
  /**
   * ファイルを後ろに足す。動画・画像でないものは足さずに名前を返す
   */
  add(files: readonly File[]): string[] {
    const rejected: string[] = [];
    const added: CmItem[] = [];
    for (const file of files) {
      const kind = cmItemKind(file);
      if (kind === null) {
        rejected.push(file.name);
        continue;
      }
      added.push({
        id: `cm-${++seq}`,
        name: file.name,
        kind,
        type: file.type,
        url: URL.createObjectURL(file),
      });
    }
    if (added.length > 0) {
      update({ ...playlist, items: [...playlist.items, ...added] });
    }
    return rejected;
  },

  remove(id: string) {
    const item = playlist.items.find((it) => it.id === id);
    if (!item) return;
    URL.revokeObjectURL(item.url);
    update({ ...playlist, items: playlist.items.filter((it) => it.id !== id) });
  },

  /** 並びの中で 1 つ前（-1）・後ろ（+1）へ動かす */
  move(id: string, delta: -1 | 1) {
    const items = [...playlist.items];
    const from = items.findIndex((it) => it.id === id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= items.length) return;
    [items[from], items[to]] = [items[to], items[from]];
    update({ ...playlist, items });
  },

  clear() {
    for (const item of playlist.items) URL.revokeObjectURL(item.url);
    update({ ...playlist, items: [] });
  },

  setImageSeconds(seconds: number) {
    const clamped = Math.min(
      CM_IMAGE_SECONDS_MAX,
      Math.max(CM_IMAGE_SECONDS_MIN, Math.round(seconds)),
    );
    if (Number.isFinite(clamped)) {
      update({ ...playlist, imageSeconds: clamped });
    }
  },
};

/** 今の CM の並び（React の外で読むとき） */
export const getCmPlaylist = getSnapshot;

/** CM の並び（変わると描き直す） */
export const useCmPlaylist = () =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
