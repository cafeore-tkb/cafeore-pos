import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { buttonVariants } from "~/components/ui/button";

export type DeleteTarget = {
  /** 「アイテム」などの種類 */
  label: string;
  name: string;
  /** 使っている側の種類。usedBy が空でなければ削除させない */
  usedByLabel?: string;
  usedBy: string[];
  run: () => Promise<void>;
};

type Props = {
  target: DeleteTarget | null;
  onClose: () => void;
};

export function DeleteDialog({ target, onClose }: Props) {
  const [deleting, setDeleting] = useState(false);
  const inUse = (target?.usedBy.length ?? 0) > 0;

  return (
    <AlertDialog
      open={target != null}
      onOpenChange={(open) => {
        if (!open && !deleting) onClose();
      }}
    >
      {target && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {inUse
                ? `「${target.name}」は削除できません`
                : `「${target.name}」を削除しますか？`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              {inUse ? (
                <div className="space-y-2">
                  <p>
                    次の{target.usedByLabel}
                    で使われています。先にそちらから外すか、削除してください。
                  </p>
                  <ul className="list-disc pl-5 text-foreground">
                    {target.usedBy.map((name, i) => (
                      // 同じ名前が並ぶこともあるので位置も含める
                      // biome-ignore lint/suspicious/noArrayIndexKey: 並びは変わらない
                      <li key={`${name}-${i}`}>{name}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p>この{target.label}は一覧から消えます。</p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {inUse ? "閉じる" : "キャンセル"}
            </AlertDialogCancel>
            {!inUse && (
              <AlertDialogAction
                className={buttonVariants({ variant: "destructive" })}
                disabled={deleting}
                onClick={async (e) => {
                  // 終わるまで閉じない
                  e.preventDefault();
                  setDeleting(true);
                  try {
                    await target.run();
                    onClose();
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? "削除中..." : "削除"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
