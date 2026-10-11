import type { ItemType, StockResource } from "@cafeore/common";
import { Link } from "react-router";
import { useStockResourceForm } from "~/components/functional/useStockResourceForm";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { stockFields } from "~/lib/stock";

type Props = {
  resources: StockResource[];
  itemTypes: ItemType[];
  onChanged: () => void;
};

export function StockTab({ resources, itemTypes, onChanged }: Props) {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <div>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-semibold text-lg">アイテムの在庫</h2>
            <Link
              to="/inventory"
              className="text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
            >
              残量・棚卸しを見る →
            </Link>
          </div>
          <p className="text-muted-foreground text-sm">
            アイテムを作ると一緒にでき、アイテムを消すと消えます。注文のたびに「1回の量」を引きます。
            通知は残りが「通知開始」を切ったときと、そこから「間隔」杯減るごとに
            Slack
            に送ります。「バッファ」を切ると危険扱いになります（いずれも杯数）。
          </p>
        </div>
        <Table>
          <ResourceHeader name="アイテム" />
          <TableBody>
            {resources
              .filter((r) => r.item_id != null)
              .map((resource) => (
                <ResourceRow
                  key={resource.id}
                  resource={resource}
                  itemTypes={itemTypes}
                  onChanged={onChanged}
                />
              ))}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-semibold text-lg">カップ</h2>
          <p className="text-muted-foreground text-sm">
            チェックしたタイプのアイテムが 1 つ売れるごとに「1回の量」を引きます
          </p>
        </div>
        <Table>
          <ResourceHeader name="名前" withItemTypes />
          <TableBody>
            {resources
              .filter((r) => r.item_id == null)
              .map((resource) => (
                <ResourceRow
                  key={resource.id}
                  resource={resource}
                  itemTypes={itemTypes}
                  onChanged={onChanged}
                />
              ))}
            <ResourceRow itemTypes={itemTypes} onChanged={onChanged} />
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function ResourceHeader({
  name,
  withItemTypes = false,
}: {
  name: string;
  withItemTypes?: boolean;
}) {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{name}</TableHead>
        {withItemTypes && <TableHead>使うタイプ</TableHead>}
        {stockFields.map(({ key, label }) => (
          <TableHead key={key} className="w-24">
            {label}
          </TableHead>
        ))}
        <TableHead className="w-44">操作</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function ResourceRow({
  resource,
  itemTypes,
  onChanged,
}: {
  /** 無ければ新しいカップ */
  resource?: StockResource;
  itemTypes: ItemType[];
  onChanged: () => void;
}) {
  const {
    form,
    setName,
    setStockField,
    toggleItemType,
    busy,
    isCup,
    save,
    remove,
  } = useStockResourceForm(resource, onChanged);

  return (
    <TableRow>
      <TableCell>
        {isCup ? (
          <Input
            value={form.name ?? ""}
            placeholder={resource ? "" : "新しいカップ"}
            onChange={(e) => setName(e.target.value)}
          />
        ) : (
          <span className="font-medium">{form.name}</span>
        )}
      </TableCell>
      {isCup && (
        <TableCell>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {itemTypes.map((itemType) => (
              <label
                key={itemType.id}
                className="flex items-center gap-1 whitespace-nowrap text-sm"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={
                    form.item_type_ids?.includes(itemType.id ?? "") ?? false
                  }
                  onChange={() => toggleItemType(itemType.id ?? "")}
                />
                {itemType.display_name}
              </label>
            ))}
          </div>
        </TableCell>
      )}
      {stockFields.map(({ key }) => (
        <TableCell key={key}>
          <Input
            type={key === "unit" ? "text" : "number"}
            min={0}
            value={String(form[key])}
            onChange={(e) => setStockField(key, e.target.value)}
          />
        </TableCell>
      ))}
      <TableCell>
        <div className="flex gap-2">
          <Button type="button" disabled={busy} onClick={() => void save()}>
            {resource ? "保存" : "追加"}
          </Button>
          {/* 消せるのはカップだけ。アイテムの在庫はアイテムを消すと消える */}
          {resource && isCup && (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              削除
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
