import {
  DEFAULT_PRINTER_SETTINGS,
  type PrinterSettings,
  printerSettingRepository,
  usePrinterSettings,
} from "@cafeore/common";
import { useState } from "react";
import type { MetaFunction } from "react-router";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

export const meta: MetaFunction = () => {
  return [{ title: "プリンター / 珈琲・俺POS" }];
};

// 0〜255 を 4 つ。先頭の 0 は付けない（サーバーも受け付けない）
const IPV4_PATTERN =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const fields: {
  key: keyof PrinterSettings;
  label: string;
  description: string;
}[] = [
  {
    key: "label_printer_ip",
    label: "ラベル用",
    description: "注文を送ったときに、カップに貼るシールを刷るプリンター",
  },
  {
    key: "receipt_printer_ip",
    label: "レシート用",
    description:
      "会計のたびにレシートを、過去の注文の「領収書」を押したときに領収書を刷るプリンター",
  },
];

const errorText = (e: unknown, fallback: string) =>
  e instanceof Error ? e.message : fallback;

export default function PrinterSettingsPage() {
  const { printerSettings, error, mutatePrinterSettings } =
    usePrinterSettings();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
      <header className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">プリンター</h1>
        <p className="text-muted-foreground text-sm">
          レジがつなぐ Epson のプリンター（ePOS-Print）の IP
          アドレスを設定します。全レジで共通です。開いているレジは、再読み込みすると新しい設定でつなぎ直します。
        </p>
      </header>

      {error ? (
        <p className="text-red-700 text-sm">
          {errorText(error, "設定を取得できません")}
        </p>
      ) : printerSettings === undefined ? (
        <p className="text-muted-foreground text-sm">読み込み中…</p>
      ) : (
        <PrinterSettingsForm
          initial={printerSettings}
          onSaved={(saved) => void mutatePrinterSettings(saved, false)}
        />
      )}
    </div>
  );
}

function PrinterSettingsForm({
  initial,
  onSaved,
}: {
  initial: PrinterSettings;
  onSaved: (saved: PrinterSettings) => void;
}) {
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const trimmed: PrinterSettings = {
      label_printer_ip: values.label_printer_ip.trim(),
      receipt_printer_ip: values.receipt_printer_ip.trim(),
    };
    const invalid = fields.find(
      (field) => !IPV4_PATTERN.test(trimmed[field.key]),
    );
    if (invalid) {
      toast(
        `${invalid.label}の IP アドレスが正しくありません（例 192.168.77.2）`,
      );
      return;
    }
    try {
      setBusy(true);
      const saved = await printerSettingRepository.save(trimmed);
      setValues(saved);
      onSaved(saved);
      toast("プリンターの設定を保存しました");
    } catch (e) {
      toast(errorText(e, "保存できませんでした"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-2">
          <Label htmlFor={field.key} className="font-bold text-base">
            {field.label}
          </Label>
          <p className="text-muted-foreground text-sm">{field.description}</p>
          <Input
            id={field.key}
            className="max-w-xs font-mono"
            value={values[field.key]}
            placeholder={DEFAULT_PRINTER_SETTINGS[field.key]}
            inputMode="decimal"
            maxLength={15}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
            }
          />
          <p className="text-muted-foreground text-xs">
            既定値: {DEFAULT_PRINTER_SETTINGS[field.key]}
          </p>
        </div>
      ))}
      <div>
        <Button type="submit" disabled={busy}>
          保存
        </Button>
      </div>
    </form>
  );
}
