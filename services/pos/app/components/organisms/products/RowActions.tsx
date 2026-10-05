import { Button } from "~/components/ui/button";

export type RowHandlers = {
  onEdit: (id: string) => void;
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
};

// 行のクリックでも編集を開くので、ボタンのクリックは行に伝えない
export function RowActions({
  id,
  onEdit,
  onCopy,
  onDelete,
}: RowHandlers & { id: string }) {
  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={(e) => {
          e.stopPropagation();
          onEdit(id);
        }}
      >
        編集
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={(e) => {
          e.stopPropagation();
          onCopy(id);
        }}
      >
        複製
      </Button>
      <Button
        type="button"
        variant="destructive"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(id);
        }}
      >
        削除
      </Button>
    </div>
  );
}
