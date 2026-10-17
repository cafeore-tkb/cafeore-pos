import {
  DEFAULT_PRINTER_SETTINGS,
  type PrinterPaperType,
  type PrinterPaperWidth,
  type PrinterSettings,
  type ReceiptPrinterModel,
  openapiEnumLabels,
  printerSettingRepository,
  usePrinterSettings,
} from "@cafeore/common";
import { type ReactNode, useState } from "react";
import type { MetaFunction } from "react-router";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import {
  DEFAULT_EPOS_PRINTER_CONFIG,
  RECEIPT_EPOS_PRINTER_CONFIG,
  eposCertificateUrl,
  eposPrinterAt,
} from "~/label/infra/epos";
import { printableWidths as paperPrintableWidths } from "~/label/paper";
import {
  type PrintOnceResult,
  type TestPrintTarget,
  labelTestPrintJob,
  printOnce,
  receiptTestPrintJob,
} from "~/label/test-print";

export const meta: MetaFunction = () => {
  return [{ title: "プリンター / 珈琲・俺POS" }];
};

// 0〜255 を 4 つ。先頭の 0 は付けない（サーバーも受け付けない）
const IPV4_PATTERN =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

type PrinterKind = "label" | "receipt";

/** プリンターごとの、設定の項目と、テスト印刷で刷るもの */
const printers = {
  label: {
    name: "ラベル用",
    description: "注文を送ったときに、カップに貼るシールを刷るプリンター",
    ip: "label_printer_ip",
    paperType: "label_printer_paper_type",
    paperWidth: "label_printer_paper_width",
    sample: "シール",
  },
  receipt: {
    name: "レシート用",
    description:
      "会計のたびにレシートを、過去の注文の「領収書」を押したときに領収書を刷るプリンター",
    ip: "receipt_printer_ip",
    paperType: "receipt_printer_paper_type",
    paperWidth: "receipt_printer_paper_width",
    sample: "レシート",
  },
} as const satisfies Record<
  PrinterKind,
  {
    name: string;
    description: string;
    ip: keyof PrinterSettings;
    paperType: keyof PrinterSettings;
    paperWidth: keyof PrinterSettings;
    sample: string;
  }
>;

const receiptPrinterModelLabels = openapiEnumLabels("ReceiptPrinterModel");
const paperTypeLabels = openapiEnumLabels("PrinterPaperType");
const paperWidthLabels = openapiEnumLabels("PrinterPaperWidth");

/** 選べるレシート用のプリンターの機種（openapi.yaml の並び） */
const receiptPrinterModels = Object.keys(
  receiptPrinterModelLabels,
) as ReceiptPrinterModel[];

/** 選べる用紙の種類・幅（openapi.yaml の並び） */
const paperTypes = Object.keys(paperTypeLabels) as PrinterPaperType[];
const paperWidths = Object.keys(paperWidthLabels) as PrinterPaperWidth[];

/** 用紙の幅ごとの印字幅（ドット）。用紙の種類と、レシート用は機種でも変わる */
const printableWidths = (kind: PrinterKind, values: PrinterSettings) =>
  paperPrintableWidths(
    values[printers[kind].paperType],
    kind === "receipt" ? values.receipt_printer_model : undefined,
  );

const errorText = (e: unknown, fallback: string) =>
  e instanceof Error ? e.message : fallback;

const invalidAddressMessage = (kind: PrinterKind) =>
  `${printers[kind].name}の IP アドレスが正しくありません（例 192.168.77.2）`;

/** テスト印刷の結果を知らせる */
const notifyTestPrint = (
  kind: PrinterKind,
  address: string,
  result: PrintOnceResult,
) => {
  const { name } = printers[kind];
  if (result === "printed") {
    toast(`${name}のプリンターでテスト印刷しました`);
  } else if (result === "failed") {
    toast.error(`${name}のプリンターにつながりましたが、刷れませんでした`, {
      description:
        "紙が切れていないか、カバーが閉まっているかを確かめてください",
    });
  } else {
    toast.error(`${name}のプリンター（${address}）につながりませんでした`, {
      description: `IP アドレスと電源を確かめてください。iPad は ${eposCertificateUrl(address)} を一度開いて証明書を許可します`,
    });
  }
};

export default function PrinterSettingsPage() {
  const { printerSettings, error, mutatePrinterSettings } =
    usePrinterSettings();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
      <header className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">プリンター</h1>
        <p className="text-muted-foreground text-sm">
          レジがつなぐ Epson のプリンター（ePOS-Print）の IP
          アドレスと用紙（種類と幅）、レシート用のプリンターの機種を設定します。全レジで共通です。開いているレジは、再読み込みすると新しい設定でつなぎ直します。
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
      ...values,
      label_printer_ip: values.label_printer_ip.trim(),
      receipt_printer_ip: values.receipt_printer_ip.trim(),
    };
    const invalid = (["label", "receipt"] as const).find(
      (kind) => !IPV4_PATTERN.test(trimmed[printers[kind].ip]),
    );
    if (invalid) {
      toast(invalidAddressMessage(invalid));
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

  /** 入力中の（保存する前の）設定でテスト印刷する */
  const testPrint = async (kind: PrinterKind) => {
    const printer = printers[kind];
    const address = values[printer.ip].trim();
    if (!IPV4_PATTERN.test(address)) {
      toast(invalidAddressMessage(kind));
      return;
    }
    const paperWidth = values[printer.paperWidth];
    const target: TestPrintTarget = {
      name: printer.name,
      address,
      paperWidth,
      paperType: paperTypeLabels[values[printer.paperType]],
      width: printableWidths(kind, values)[paperWidth],
      ...(kind === "receipt" && {
        model: receiptPrinterModelLabels[values.receipt_printer_model],
      }),
    };
    const result =
      kind === "label"
        ? await printOnce(
            eposPrinterAt(address, DEFAULT_EPOS_PRINTER_CONFIG),
            labelTestPrintJob(target),
          )
        : await printOnce(
            eposPrinterAt(address, RECEIPT_EPOS_PRINTER_CONFIG),
            receiptTestPrintJob(target),
          );
    notifyTestPrint(kind, address, result);
  };

  /** key の項目を value にする（choices に無い値なら変えない） */
  const choose = (
    key: keyof PrinterSettings,
    choices: readonly string[],
    value: string,
  ) => {
    if (choices.includes(value)) {
      setValues((prev) => ({ ...prev, [key]: value }));
    }
  };

  const section = (kind: PrinterKind, extra?: ReactNode) => {
    const printer = printers[kind];
    const widths = printableWidths(kind, values);
    return (
      <section className="flex flex-col gap-5 rounded-lg border p-4">
        <div className="space-y-1">
          <h2 className="font-bold text-lg">{printer.name}</h2>
          <p className="text-muted-foreground text-sm">{printer.description}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={printer.ip} className="font-bold">
            IP アドレス
          </Label>
          <Input
            id={printer.ip}
            className="max-w-xs font-mono"
            value={values[printer.ip]}
            placeholder={DEFAULT_PRINTER_SETTINGS[printer.ip]}
            inputMode="decimal"
            maxLength={15}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [printer.ip]: e.target.value }))
            }
          />
          <p className="text-muted-foreground text-xs">
            既定値: {DEFAULT_PRINTER_SETTINGS[printer.ip]}
          </p>
        </div>
        {extra}
        <ChoiceField
          id={printer.paperType}
          label="用紙の種類"
          description="レシート紙（ロール紙・連続ラベル）か、ダイカットラベル（台紙に 1 枚ずつ並んだシール）か。ダイカットラベルは印字幅が狭くなります"
          choices={paperTypes}
          labels={paperTypeLabels}
          value={values[printer.paperType]}
          defaultValue={DEFAULT_PRINTER_SETTINGS[printer.paperType]}
          onChange={(value) => choose(printer.paperType, paperTypes, value)}
        />
        <ChoiceField
          id={printer.paperWidth}
          label="用紙の幅"
          description={`プリンターに入れている紙の幅。${printer.sample}はこの紙の印字幅（かっこ内）に収めて刷ります。紙より広い幅を選ぶと右端が切れます`}
          choices={paperWidths}
          labels={paperWidthLabels}
          detail={(paperWidth) => `${widths[paperWidth]} ドット`}
          value={values[printer.paperWidth]}
          defaultValue={DEFAULT_PRINTER_SETTINGS[printer.paperWidth]}
          onChange={(value) => choose(printer.paperWidth, paperWidths, value)}
        />
        <TestPrintButton
          sample={printer.sample}
          onTestPrint={() => testPrint(kind)}
        />
      </section>
    );
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {section("label")}
      {section(
        "receipt",
        <ChoiceField
          id="receipt_printer_model"
          label="機種"
          description="レシート・領収書は、この機種と用紙で決まる印字幅に合わせた画像で刷ります。プリンターと違う機種を選ぶと、幅が合わずに右端が切れることがあります"
          choices={receiptPrinterModels}
          labels={receiptPrinterModelLabels}
          value={values.receipt_printer_model}
          defaultValue={DEFAULT_PRINTER_SETTINGS.receipt_printer_model}
          onChange={(value) =>
            choose("receipt_printer_model", receiptPrinterModels, value)
          }
        />,
      )}
      <div className="space-y-1 text-muted-foreground text-sm">
        <p>
          テスト印刷は、保存する前の入力中の設定で、確認用のページ（プリンター・IP
          アドレス・用紙を書き、印字幅いっぱいを枠で囲んだもの）と見本を刷ります。
        </p>
        <p>
          枠の左右が欠けていれば、紙より広い幅を選んでいます。枠の外に広い余白があれば、紙より狭い幅を選んでいます。
        </p>
        <p>
          ここの設定が紙と合っているのに欠けるときは、プリンター本体の用紙幅の設定（電源を入れるときに
          FEED を押したままにして刷る自己診断の「Paper Roll
          Width」）が紙と合っているかを確かめてください。
        </p>
      </div>
      <div>
        <Button type="submit" disabled={busy}>
          保存
        </Button>
      </div>
    </form>
  );
}

/** 選択肢から 1 つ選ぶ欄。detail があれば、名前の後ろのかっこに添える */
function ChoiceField<T extends string>({
  id,
  label,
  description,
  choices,
  labels,
  detail,
  value,
  defaultValue,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  choices: readonly T[];
  labels: Record<T, string>;
  detail?: (choice: T) => string;
  value: T;
  defaultValue: T;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label id={id} className="font-bold">
        {label}
      </Label>
      <p className="text-muted-foreground text-sm">{description}</p>
      <RadioGroup
        aria-labelledby={id}
        className="flex flex-wrap gap-6"
        value={value}
        onValueChange={onChange}
      >
        {choices.map((choice) => (
          <div key={choice} className="flex items-center gap-2">
            <RadioGroupItem id={`${id}_${choice}`} value={choice} />
            <Label htmlFor={`${id}_${choice}`}>
              {labels[choice]}
              {detail && `（${detail(choice)}）`}
            </Label>
          </div>
        ))}
      </RadioGroup>
      <p className="text-muted-foreground text-xs">
        既定値: {labels[defaultValue]}
      </p>
    </div>
  );
}

/** テスト印刷のボタン。刷り終わる（つながらないと分かる）まで押せない */
function TestPrintButton({
  sample,
  onTestPrint,
}: {
  sample: string;
  onTestPrint: () => Promise<void>;
}) {
  const [printing, setPrinting] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={printing}
        onClick={async () => {
          setPrinting(true);
          try {
            await onTestPrint();
          } finally {
            setPrinting(false);
          }
        }}
      >
        {printing ? "テスト印刷中…" : "テスト印刷"}
      </Button>
      <p className="text-muted-foreground text-xs">
        確認用のページと{sample}の見本を刷ります
      </p>
    </div>
  );
}
