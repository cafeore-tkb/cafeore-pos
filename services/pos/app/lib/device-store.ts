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
  // 読んだもの（変わるまで同じものを返す。useSyncExternalStore にそのまま渡せる）
  let cache: readonly T[] | null = null;
  const changed = () => {
    cache = null;
    for (const listener of listeners) listener();
  };
  // ほかのタブで変わったら読み直す（初めて読んだときから見る）
  let watching = false;
  const watch = () => {
    if (watching || typeof window === "undefined") return;
    watching = true;
    window.addEventListener("storage", (event) => {
      if (event.key === null || event.key.startsWith(prefix)) changed();
    });
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

  const readItems = () =>
    [
      ...new Map(
        [...stored(), ...memory.values()].map((item) => [item.id, item]),
      ).values(),
    ].sort((a, b) => a.at - b.at);

  // 業務操作は、再読込で失うメモリへの退避を成功扱いにしない。
  const putPersisted = (item: T) => {
    const { id, ...value } = item;
    localStorage.setItem(prefix + id, JSON.stringify(value));
    memory.delete(id);
    changed();
  };

  return {
    /** 永続保存できなければ例外。以前の保存値は残す。 */
    putPersisted,
    /** ロック取得後、ほかのタブが最後に保存したキューを読み直す。 */
    reload: () => {
      const next = readItems();
      if (JSON.stringify(cache) === JSON.stringify(next)) return;
      cache = next;
      for (const listener of listeners) listener();
    },
    /** 残っているもの（古い順） */
    read: () => {
      watch();
      cache ??= readItems();
      return cache;
    },
    /** 置く（同じ id なら置き換える） */
    put: (item: T) => {
      try {
        putPersisted(item);
        return;
      } catch {
        // 更新前の保存値を消さない。再読込時には、その値から再送できる。
        memory.set(item.id, item);
      }
      changed();
    },
    remove: (id: string) => {
      memory.delete(id);
      try {
        localStorage.removeItem(prefix + id);
      } catch {}
      changed();
    },
    /** 変わったら呼ぶ（ほかのタブで変わったときも） */
    subscribe: (listener: () => void) => {
      watch();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /**
     * run のあいだ、同じ端末のほかのタブには同じ run をさせない（同じものを 2 回送らないように）。
     * Web Locks が無いブラウザでは、そのまま走らせる
     */
    withLock: async <R>(
      run: () => Promise<R>,
      lockName = prefix,
    ): Promise<R> => {
      if (!navigator.locks) return run();
      let started = false;
      try {
        return await navigator.locks.request(lockName, async () => {
          started = true;
          return await run();
        });
      } catch (error) {
        // APIが存在しても、ブラウザの設定等でロックを取得できないことがある。
        // 操作は送る。競合はAPIのbefore値とトランザクションで検出する。
        if (started) throw error;
        return run();
      }
    },
  };
};
