import { type CaosOrderInput, assignmentDisplay } from "@cafeore/common";
import { Siren } from "lucide-react";
import { useId, useState } from "react";
import {
  type EmergencyCup,
  type EmergencyInitial,
  useEmergencyDraft,
} from "../functional/useCupEmergency";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";

/** 緊急（入れ直し）の印。マスターと CaOS の緊急のボタンに付ける */
export const EmergencyIcon = Siren;

/**
 * 緊急（入れ直し）の入力：注文番号・入れ直すカップ・理由（よく使うものを押すか、自由に書く）。マスターと CaOS で同じもの。
 * 状態は useEmergencyDraft（initial はカップやカードから開いたときの注文番号とカップ）。
 * 確定すると onAdd（足して、そのカップのシールを刷る）、足せたら onDone
 */
export type EmergencyFormProps<O extends CaosOrderInput> = {
  orders: readonly O[];
  initial?: EmergencyInitial;
  /** 足した入れ直しの id。断られたら null */
  onAdd: (cups: EmergencyCup<O>[], reason: string) => Promise<string[] | null>;
  onDone: () => void;
  /** 実データテストの練習の盤面に足す（シールを刷らないので、確定のボタンにそう書く） */
  practice?: boolean;
};

export const EmergencyForm = <O extends CaosOrderInput>({
  orders,
  initial,
  onAdd,
  onDone,
  practice = false,
}: EmergencyFormProps<O>) => {
  const id = useId();
  const draft = useEmergencyDraft(orders, initial);
  // 送っている間は確定させない（2 回押して入れ直しが倍にならないように）
  const [sending, setSending] = useState(false);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (sending || draft.selected.length === 0) return;
        setSending(true);
        try {
          if (await onAdd(draft.selected, draft.reason)) onDone();
        } finally {
          setSending(false);
        }
      }}
    >
      <label htmlFor={`${id}-no`} className="grid gap-1 font-bold text-sm">
        注文番号
        <Input
          id={`${id}-no`}
          type="number"
          inputMode="numeric"
          min={1}
          value={draft.orderNo}
          onChange={(event) => draft.changeOrderNo(event.target.value)}
          className="h-12 font-bold font-mono text-2xl"
        />
      </label>
      {draft.orderNo.trim() !== "" && !draft.order && (
        <p className="font-bold text-red-600 text-sm">
          その番号の注文がありません
        </p>
      )}
      {draft.order && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 font-bold text-sm">入れ直すカップ</legend>
          {draft.cups.length === 0 && (
            <p className="text-muted-foreground text-sm">
              抽出が要るカップがありません
            </p>
          )}
          {draft.cups.map((cup) => (
            <button
              key={cup.cupId}
              type="button"
              aria-pressed={draft.picked.includes(cup.cupId)}
              onClick={() => draft.toggle(cup.cupId)}
              className="flex min-h-12 items-center gap-3 rounded-lg border-2 border-slate-300 bg-white px-4 text-left font-bold aria-pressed:border-red-600 aria-pressed:bg-red-50"
            >
              <span className="text-xl">{cup.abbr}</span>
              <span>{cup.name}</span>
              {assignmentDisplay(cup) && (
                <span className="text-slate-500 text-sm">
                  指名:{assignmentDisplay(cup)}
                </span>
              )}
            </button>
          ))}
        </fieldset>
      )}
      <div className="grid gap-2">
        <label
          htmlFor={`${id}-reason`}
          className="grid gap-1 font-bold text-sm"
        >
          理由
          <Input
            id={`${id}-reason`}
            value={draft.reason}
            maxLength={100}
            placeholder="自由に書けます（無くてもよい）"
            onChange={(event) => draft.setReason(event.target.value)}
          />
        </label>
        {draft.reasons.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {draft.reasons.map((reason) => (
              <Button
                key={reason}
                type="button"
                size="sm"
                variant={draft.reason === reason ? "default" : "outline"}
                onClick={() => draft.setReason(reason)}
              >
                {reason}
              </Button>
            ))}
          </div>
        )}
      </div>
      <Button
        type="submit"
        variant="destructive"
        disabled={sending || draft.selected.length === 0}
        className="h-12 gap-2 font-bold text-base"
      >
        <EmergencyIcon className="h-5 w-5" />
        {practice
          ? `${draft.selected.length}杯を入れ直す（テストなので刷りません）`
          : `${draft.selected.length}杯を入れ直して刷る`}
      </Button>
    </form>
  );
};

/** マスターの緊急の入力（右から出す）。足せたら閉じる */
export const EmergencySheet = <O extends CaosOrderInput>({
  onClose,
  ...form
}: Omit<EmergencyFormProps<O>, "onDone"> & {
  onClose: () => void;
}) => (
  <Sheet open onOpenChange={(open) => !open && onClose()}>
    <SheetContent className="overflow-y-auto">
      <SheetHeader className="mb-4">
        <SheetTitle>緊急（入れ直し）</SheetTitle>
      </SheetHeader>
      <EmergencyForm {...form} onDone={onClose} />
    </SheetContent>
  </Sheet>
);
