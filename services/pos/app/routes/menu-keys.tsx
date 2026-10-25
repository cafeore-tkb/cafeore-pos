import {
  MenuEntity,
  type WithId,
  menuRepository,
  useMenuMaster,
} from "@cafeore/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, type MetaFunction } from "react-router";
import { toast } from "sonner";
import {
  type KeyCapture,
  cancelHeldKeys,
  captureKeyDown,
  captureKeyUp,
  capturedKey,
  checkCapturedKey,
  emptyKeyCapture,
} from "~/components/functional/keyCapture";
import { AdminPageHeader } from "~/components/molecules/AdminPageHeader";
import { groupByItemType } from "~/components/organisms/cashier/MenuPanel";
import { Button } from "~/components/ui/button";
import { menuKeyLabel, menuKeyPartLabel, menuKeyParts } from "~/lib/menuKey";
import { cn } from "~/lib/utils";

export const meta: MetaFunction = () => {
  return [{ title: "商品のキー / 珈琲・俺POS" }];
};

export default function MenuKeysPage() {
  const { menus, error, isLoading, mutateMenus } = useMenuMaster();
  // キーを押して登録しているメニュー
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const close = useCallback(() => setCapturingId(null), []);
  const groups = groupByItemType(menus);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-6">
      <AdminPageHeader
        group="settings"
        title="商品のキー"
        description={
          <>
            レジで押すと商品を足すキーを、実際にキーを押して登録します。名前や値段は
            <Link to="/products" className="underline underline-offset-4">
              商品管理
            </Link>
            で変えます。
          </>
        }
      >
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            「キーを登録」を押してから、レジで使うキーボード（キーパッド）のキーを押します。離すと決まり、「登録」で保存します
          </li>
          <li>
            同時押しは、キーを押したまま次のキーを押してから全部離します（「a+s」のように登録されます）
          </li>
          <li>
            Shift と一緒に押すと記号（*
            など）や大文字として登録します。Alt・Ctrl・⌘
            と一緒に押したキーは使えません
          </li>
          <li>Esc で登録をやめます</li>
        </ul>
      </AdminPageHeader>

      {error ? (
        <p>エラー: {error instanceof Error ? error.message : String(error)}</p>
      ) : isLoading ? (
        <p>読み込み中...</p>
      ) : menus.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground text-sm">
          メニューがありません。商品管理から作れます
        </p>
      ) : (
        groups.map(({ itemType, menus: groupMenus }) => (
          <section
            key={itemType.id ?? itemType.name}
            className="flex flex-col gap-2"
          >
            <h2 className="font-bold text-lg">{itemType.display_name}</h2>
            <ul className="grid gap-2">
              {groupMenus.map((menu) => (
                <MenuKeyRow
                  key={menu.id}
                  menu={menu}
                  menus={menus}
                  capturing={capturingId === menu.id}
                  onStart={() => setCapturingId(menu.id)}
                  onClose={close}
                  onSaved={() => mutateMenus()}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function MenuKeyRow({
  menu,
  menus,
  capturing,
  onStart,
  onClose,
  onSaved,
}: {
  menu: WithId<MenuEntity>;
  menus: WithId<MenuEntity>[];
  capturing: boolean;
  onStart: () => void;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  return (
    <li
      className={cn(
        "rounded-md border",
        capturing && "border-primary ring-2 ring-primary/20",
      )}
    >
      <div className="flex items-center justify-between gap-4 p-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-bold">{menu.name}</span>
          <span className="text-muted-foreground text-sm">{menu.abbr}</span>
        </div>
        <div className="flex flex-none items-center gap-3">
          <KeyLabel parts={menuKeyParts(menu.key) ?? [menu.key]} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={capturing}
            onClick={onStart}
          >
            キーを登録
          </Button>
        </div>
      </div>
      {capturing && (
        <KeyCaptureForm
          menu={menu}
          menus={menus}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </li>
  );
}

/** キーを押して登録する欄。開いている間に押したキーは、ページの操作には使わずに覚える */
function KeyCaptureForm({
  menu,
  menus,
  onClose,
  onSaved,
}: {
  menu: WithId<MenuEntity>;
  menus: WithId<MenuEntity>[];
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [capture, setCapture] = useState<KeyCapture>(emptyKeyCapture);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const pressing = capture.held.size > 0;
  const key = capturedKey(capture);
  const check = key === null ? null : checkCapturedKey(key, menu.id, menus);
  const canSave = key !== null && capture.error === null && check?.ok === true;

  // 「キーを登録」にフォーカスが残ると Enter・Space でまた押されるので、欄に移す
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // 保存している間は、保存するキーが変わらないよう覚えない
  useEffect(() => {
    if (saving) return;
    const keydown = (event: KeyboardEvent) => {
      // Space のスクロールや Tab のフォーカス移動などはさせない。Ctrl・⌘ との組（再読み込みなど）はブラウザに任せる
      if (!event.ctrlKey && !event.metaKey) event.preventDefault();
      if (event.key === "Escape") {
        onClose();
        return;
      }
      setCapture((current) => captureKeyDown(current, event));
    };
    const keyup = (event: KeyboardEvent) => {
      // Space で押したボタンは離したときに押される
      event.preventDefault();
      setCapture((current) => captureKeyUp(current, event));
    };
    const blur = () => setCapture(cancelHeldKeys);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    };
  }, [saving, onClose]);

  const save = async () => {
    if (key === null) return;
    setSaving(true);
    try {
      // ほかの端末で変えた名前や値段を古いまま戻さないよう、読み直してキーだけ変える。
      // 同時押しの順が違う同じキーは API では断れないので、読み直した一覧でも確かめる
      const latestMenus = await menuRepository.findAll();
      const latest = latestMenus.find(({ id }) => id === menu.id);
      if (!latest) {
        throw new Error("このメニューはほかの端末で消されました");
      }
      const latestCheck = checkCapturedKey(key, menu.id, latestMenus);
      if (!latestCheck.ok) {
        throw new Error(latestCheck.message);
      }
      await menuRepository.save(
        MenuEntity.fromMenu({
          id: latest.id,
          name: latest.name,
          abbr: latest.abbr,
          price: latest.price,
          key,
          priority: latest.priority,
          items: latest.items,
          assignee: null,
        }),
      );
      toast.success(
        `「${latest.name}」のキーを「${menuKeyLabel(key)}」にしました`,
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
      await onSaved();
    }
  };

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="grid gap-3 border-t bg-muted/40 p-3 outline-none"
    >
      <div className="flex min-h-12 items-center">
        {capture.keys.length === 0 ? (
          <span className="animate-pulse text-muted-foreground">
            登録するキーを押してください…
          </span>
        ) : (
          <KeyLabel parts={capture.keys} size="lg" active={pressing} />
        )}
      </div>
      <p aria-live="polite" className="min-h-5 text-sm">
        {pressing ? (
          <span className="text-muted-foreground">
            押しています。全部離すと決まります
          </span>
        ) : capture.error ? (
          <span className="text-destructive">{capture.error}</span>
        ) : check && !check.ok ? (
          <span className="text-destructive">{check.message}</span>
        ) : check?.ok && check.warning ? (
          <span className="text-amber-700">{check.warning}</span>
        ) : check?.ok ? (
          <span className="text-muted-foreground">
            このキーで登録できます。違うときはもう一度押し直してください
          </span>
        ) : null}
      </p>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={saving}
        >
          やめる（Esc）
        </Button>
        <Button
          type="button"
          onClick={() => void save()}
          disabled={!canSave || saving}
        >
          {saving ? "保存中..." : "登録"}
        </Button>
      </div>
    </div>
  );
}

/** キーの札。同時押しは + でつなぐ */
function KeyLabel({
  parts,
  size = "sm",
  active = false,
}: {
  parts: readonly string[];
  size?: "sm" | "lg";
  /** 押している間 */
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-mono",
        size === "lg" ? "gap-2 text-2xl" : "gap-1 text-sm",
      )}
    >
      {parts.map((part, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: 同時押しのキーの並びは変わらない
          key={index}
          className={cn(
            "inline-flex items-center",
            size === "lg" ? "gap-2" : "gap-1",
          )}
        >
          {index > 0 && <span className="text-muted-foreground">+</span>}
          <kbd
            className={cn(
              "rounded border font-semibold",
              size === "lg" ? "bg-background px-3 py-1" : "bg-muted px-1.5",
              active && "border-primary bg-primary text-primary-foreground",
            )}
          >
            {menuKeyPartLabel(part)}
          </kbd>
        </span>
      ))}
    </span>
  );
}
