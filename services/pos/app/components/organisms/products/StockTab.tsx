import {
  type ItemType,
  type StockResource,
  openapiEnumLabels,
} from "@cafeore/common";
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
import { type StockAmounts, stockFields } from "~/lib/stock";

type Props = {
  resources: StockResource[];
  itemTypes: ItemType[];
  onChanged: () => void;
};

// 見出しは在庫対象の種類の表示名（openapi.yaml の x-enum-descriptions）
const kindLabels = openapiEnumLabels("StockResourceKind");

export function StockTab({ resources, itemTypes, onChanged }: Props) {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <div>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-semibold text-lg">{kindLabels.item}の在庫</h2>
            <Link
              to="/inventory"
              className="text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
            >
              残量・棚卸しを見る →
            </Link>
          </div>
          <p className="text-muted-foreground text-sm">
            アイテムを作ると一緒にでき、アイテムを消すと消えます。注文のたびに「1回の量」を引きます。
            通知は残りが「通知開始」を切ったときと、そこから「間隔」回減るごとに
            Slack
            に送ります。「バッファ」を切ると危険扱いになります（いずれも回数）。
          </p>
        </div>
        <Table>
          <ResourceHeader names={["アイテム"]} />
          <TableBody>
            {resources
              .filter((r) => r.kind === "item")
              .map((resource) => (
                <ItemStockRow
                  key={resource.id}
                  resource={resource}
                  onChanged={onChanged}
                />
              ))}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-semibold text-lg">{kindLabels.cup}</h2>
          <p className="text-muted-foreground text-sm">
            チェックしたタイプのアイテムが 1 つ売れるごとに「1回の量」を引きます
          </p>
        </div>
        <Table>
          <ResourceHeader names={["名前", "使うタイプ"]} />
          <TableBody>
            {resources
              .filter((r) => r.kind === "cup")
              .map((resource) => (
                <CupRow
                  key={resource.id}
                  resource={resource}
                  itemTypes={itemTypes}
                  onChanged={onChanged}
                />
              ))}
            <CupRow itemTypes={itemTypes} onChanged={onChanged} />
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

/** names は量の欄より前の列の見出し */
function ResourceHeader({ names }: { names: string[] }) {
  return (
    <TableHeader>
      <TableRow>
        {names.map((name) => (
          <TableHead key={name}>{name}</TableHead>
        ))}
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

/** 単位・1回の量・通知の段階の入力欄 */
function StockFieldCells({
  form,
  onChange,
}: {
  form: StockAmounts;
  onChange: (key: keyof StockAmounts, raw: string) => void;
}) {
  return stockFields.map(({ key, type }) => (
    <TableCell key={key}>
      <Input
        type={type}
        min={0}
        value={String(form[key])}
        onChange={(e) => onChange(key, e.target.value)}
      />
    </TableCell>
  ));
}

/** アイテムの在庫。名前はアイテムの名前で、消すのはアイテムを消すとき */
function ItemStockRow({
  resource,
  onChanged,
}: {
  resource: StockResource;
  onChanged: () => void;
}) {
  const { form, setStockField, busy, save } = useStockResourceForm(
    resource,
    onChanged,
  );
  return (
    <TableRow>
      <TableCell>
        <span className="font-medium">{form.name}</span>
      </TableCell>
      <StockFieldCells form={form} onChange={setStockField} />
      <TableCell>
        <Button type="button" disabled={busy} onClick={() => void save()}>
          保存
        </Button>
      </TableCell>
    </TableRow>
  );
}

function CupRow({
  resource,
  itemTypes,
  onChanged,
}: {
  /** 無ければ新しいカップ */
  resource?: StockResource;
  itemTypes: ItemType[];
  onChanged: () => void;
}) {
  const { form, setName, setStockField, toggleItemType, busy, save, remove } =
    useStockResourceForm(resource, onChanged);

  return (
    <TableRow>
      <TableCell>
        <Input
          value={form.name ?? ""}
          placeholder={resource ? "" : "新しいカップ"}
          onChange={(e) => setName(e.target.value)}
        />
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {/* カップを作らないタイプ（makes_cup が false）は選んでもカップが減らないので出さない。もう選んであれば外せるよう出す */}
          {itemTypes
            .filter(
              (itemType) =>
                itemType.makes_cup ||
                form.item_type_ids?.includes(itemType.id ?? ""),
            )
            .map((itemType) => (
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
      <StockFieldCells form={form} onChange={setStockField} />
      <TableCell>
        <div className="flex gap-2">
          <Button type="button" disabled={busy} onClick={() => void save()}>
            {resource ? "保存" : "追加"}
          </Button>
          {resource && (
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
