/**
 * この端末に残しておくもの（刷れなかったシール・送れていない CaOS の操作）。
 *
 * 1 件ずつ localStorage の別のキー（prefix + id）に置く（読んで書き戻さないので、同じ端末のタブどうしで足し消しが重なっても消えない）。
 * タブを閉じても開き直せば残っていて、同じ端末のタブどうしで共有する。
 * localStorage に書けないとき（使えない・容量切れなど）は、そのタブのメモリだけで持つ。
 * parse は置いたものの形か確かめる（壊れたもの・ほかが書いたものは null で読まない）。
 */
export const createDeviceStore = <T extends { id: string; at: number }>(
  prefix: string,
  parse: (id: string, value: unknown) => T | null,
) => {
  // localStorage に書けなかったもの
  const memory = new Map<string, T>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  const stored = () => {
    const items: T[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(prefix)) continue;
        try {
          const item = parse(
            key.slice(prefix.length),
            JSON.parse(localStorage.getItem(key) ?? ""),
          );
          if (item) items.push(item);
        } catch {}
      }
    } catch {
      // 読めなければメモリの分だけ
    }
    return items;
  };

  return {
    /** 残っているもの（古い順） */
    read: () => [...stored(), ...memory.values()].sort((a, b) => a.at - b.at),
    /** 置く（同じ id なら置き換える） */
    put: (item: T) => {
      const { id, ...value } = item;
      try {
        localStorage.setItem(prefix + id, JSON.stringify(value));
      } catch {
        memory.set(id, item);
      }
      notify();
    },
    remove: (id: string) => {
      memory.delete(id);
      try {
        localStorage.removeItem(prefix + id);
      } catch {}
      notify();
    },
    /** 変わったら呼ぶ（ほかのタブで変わったときも） */
    subscribe: (listener: () => void) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key.startsWith(prefix)) listener();
      };
      listeners.add(listener);
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    /**
     * run のあいだ、同じ端末のほかのタブには同じ run をさせない（同じものを 2 回送らないように）。
     * Web Locks が無いブラウザでは、そのまま走らせる
     */
    withLock: <R>(run: () => Promise<R>) =>
      navigator.locks ? navigator.locks.request(prefix, run) : run(),
  };
};
