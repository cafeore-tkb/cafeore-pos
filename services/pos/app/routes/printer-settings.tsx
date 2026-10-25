import {
  DEFAULT_PRINTER_SETTINGS,
  LABEL_SIZE_LIMITS,
  type LabelPrinterTrailingFeed,
  PRINTER_DOTS_PER_MM,
  type PrinterPaperType,
  type PrinterPaperWidth,
  type PrinterSettings,
  type ReceiptPrinterModel,
  isLabelLengthMm,
  isLabelMarginMm,
  isLabelPrintWidthDots,
  labelMarginFits,
  openapiEnumLabels,
  printerSettingRepository,
  usePrinterSettings,
} from "@cafeore/common";
import { type ReactNode, useState } from "react";
import type { MetaFunction } from "react-router";
import { toast } from "sonner";
import { AdminPageHeader } from "~/components/molecules/AdminPageHeader";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Switch } from "~/components/ui/switch";
import {
  RECEIPT_EPOS_PRINTER_CONFIG,
  eposCertificateUrl,
  eposPrinterAt,
  labelPrinterAt,
} from "~/label/infra/epos";
import { labelGeometry, printableWidths } from "~/label/paper";
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

/** プリンターごとの名前・説明・IP アドレスの項目と、テスト印刷で見本に刷るもの */
const printers = {
  label: {
    name: "ラベル用",
    description:
      "注文を送ったときにカップに貼るシールを、緊急で淹れ直したとき・注文をキャンセルしたときにそのシールを刷るプリンター",
    ip: "label_printer_ip",
    sample: "緊急のシール（ここから・ここまで）で挟んだカップのシール",
  },
  receipt: {
    name: "レシート用",
    description:
      "会計のたびにレシートを、過去の注文の「領収書」を押したときに領収書を刷るプリンター",
    ip: "receipt_printer_ip",
    sample: "レシート",
  },
} as const satisfies Record<
  PrinterKind,
  {
    name: string;
    description: string;
    ip: keyof PrinterSettings;
    sample: string;
  }
>;

const receiptPrinterModelLabels = openapiEnumLabels("ReceiptPrinterModel");
const paperTypeLabels = openapiEnumLabels("PrinterPaperType");
const paperWidthLabels = openapiEnumLabels("PrinterPaperWidth");
const trailingFeedLabels = openapiEnumLabels("LabelPrinterTrailingFeed");

/** 選べるレシート用のプリンターの機種（openapi.yaml の並び） */
const receiptPrinterModels = Object.keys(
  receiptPrinterModelLabels,
) as ReceiptPrinterModel[];

/** 選べる用紙の種類・幅（openapi.yaml の並び） */
const paperTypes = Object.keys(paperTypeLabels) as PrinterPaperType[];
const paperWidths = Object.keys(paperWidthLabels) as PrinterPaperWidth[];

/** 選べる、ラベル用の一連の印刷の最後の送り方（openapi.yaml の並び） */
const trailingFeeds = Object.keys(
  trailingFeedLabels,
) as LabelPrinterTrailingFeed[];

/** 用紙の幅ごとのレシート用の印字幅（ドット）。用紙の種類と機種で変わる */
const receiptPrintableWidths = (values: PrinterSettings) =>
  printableWidths(
    values.receipt_printer_paper_type,
    values.receipt_printer_model,
  );

/** ラベル用のシールの大きさの項目。入力中は文字のまま持ち、保存・テスト印刷のときに読む */
type LabelSizeKey =
  | "label_printer_label_length_mm"
  | "label_printer_print_width_dots"
  | "label_printer_margin_mm";
type LabelSize = Pick<PrinterSettings, LabelSizeKey>;
type LabelSizeText = Record<LabelSizeKey, string>;

const labelSizeText = (settings: LabelSize): LabelSizeText => ({
  label_printer_label_length_mm: String(settings.label_printer_label_length_mm),
  label_printer_print_width_dots: String(
    settings.label_printer_print_width_dots,
  ),
  label_printer_margin_mm: String(settings.label_printer_margin_mm),
});

/** 空なら NaN（Number("") は 0 になるので） */
const toNumber = (text: string) =>
  text.trim() === "" ? Number.NaN : Number(text);

const { lengthMm, printWidthDots, marginMm, printableMinMm } =
  LABEL_SIZE_LIMITS;

/** 入力中のシールの大きさを読む。読めない・範囲の外なら、どう直すかを書いた文 */
const parseLabelSize = (
  text: LabelSizeText,
): { size: LabelSize } | { error: string } => {
  const size = {
    label_printer_label_length_mm: toNumber(text.label_printer_label_length_mm),
    label_printer_print_width_dots: toNumber(
      text.label_printer_print_width_dots,
    ),
    label_printer_margin_mm: toNumber(text.label_printer_margin_mm),
  };
  if (!isLabelLengthMm(size.label_printer_label_length_mm)) {
    return {
      error: `ラベルの長さは ${lengthMm.min}〜${lengthMm.max} mm で入れてください`,
    };
  }
  if (!isLabelPrintWidthDots(size.label_printer_print_width_dots)) {
    return {
      error: `印字幅は ${printWidthDots.min}〜${printWidthDots.max} ドットの ${printWidthDots.step} の倍数で入れてください`,
    };
  }
  if (!isLabelMarginMm(size.label_printer_margin_mm)) {
    return {
      error: `余白は ${marginMm.min}〜${marginMm.max} mm で入れてください`,
    };
  }
  if (
    !labelMarginFits(
      size.label_printer_label_length_mm,
      size.label_printer_print_width_dots,
      size.label_printer_margin_mm,
    )
  ) {
    return {
      error: `余白が大きすぎます（内側に縦横 ${printableMinMm} mm 以上残してください）`,
    };
  }
  return { size };
};

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
        "紙が切れていないか、カバーが閉まっているか、剥離位置のシールを取ったかを確かめてください",
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
      <AdminPageHeader
        group="settings"
        title="プリンター"
        description="レジがつなぐ Epson のプリンター（ePOS-Print）の IP アドレスと、ラベル用のシールの大きさと向き、レシート用の用紙（種類と幅）と機種を設定します。全レジで共通です。開いているレジは、再読み込みすると新しい設定でつなぎ直します。"
      />

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
  // ラベル用の用紙の種類・幅はもう使わないが、API が受け取るので読んだ値のまま送り返す
  const [values, setValues] = useState(initial);
  const [sizeText, setSizeText] = useState(() => labelSizeText(initial));
  const [busy, setBusy] = useState(false);
  const labelSize = parseLabelSize(sizeText);

  const save = async () => {
    const trimmed = {
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
    if ("error" in labelSize) {
      toast(labelSize.error);
      return;
    }
    try {
      setBusy(true);
      const saved = await printerSettingRepository.save({
        ...trimmed,
        ...labelSize.size,
      });
      setValues(saved);
      setSizeText(labelSizeText(saved));
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
    const address = values[printers[kind].ip].trim();
    if (!IPV4_PATTERN.test(address)) {
      toast(invalidAddressMessage(kind));
      return;
    }
    if (kind === "label") {
      if ("error" in labelSize) {
        toast(labelSize.error);
        return;
      }
      const result = await printOnce(
        labelPrinterAt(address, values.label_printer_trailing_feed),
        labelTestPrintJob({
          address,
          geometry: labelGeometry({
            ...labelSize.size,
            label_printer_rotate_180: values.label_printer_rotate_180,
          }),
        }),
      );
      notifyTestPrint(kind, address, result);
      return;
    }
    const paperWidth = values.receipt_printer_paper_width;
    const target: TestPrintTarget = {
      name: printers.receipt.name,
      address,
      paperWidth,
      paperType: paperTypeLabels[values.receipt_printer_paper_type],
      width: receiptPrintableWidths(values)[paperWidth],
      model: receiptPrinterModelLabels[values.receipt_printer_model],
    };
    const result = await printOnce(
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

  const sizeField = (key: LabelSizeKey) => (value: string) =>
    setSizeText((prev) => ({ ...prev, [key]: value }));

  const section = (kind: PrinterKind, fields: ReactNode) => {
    const printer = printers[kind];
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
        {fields}
        <TestPrintButton
          sample={printer.sample}
          onTestPrint={() => testPrint(kind)}
        />
      </section>
    );
  };

  const receiptWidths = receiptPrintableWidths(values);

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {section(
        "label",
        <>
          <NumberField
            id="label_printer_label_length_mm"
            label="ラベルの長さ"
            description="シール 1 枚の、紙が送られる向きの長さ。シールの間のすき間は含めません。緊急・キャンセルのシールは、この長さに収めて描きます"
            unit="mm"
            step={0.5}
            limits={lengthMm}
            value={sizeText.label_printer_label_length_mm}
            defaultValue={
              DEFAULT_PRINTER_SETTINGS.label_printer_label_length_mm
            }
            onChange={sizeField("label_printer_label_length_mm")}
          />
          <NumberField
            id="label_printer_print_width_dots"
            label="印字幅"
            description={`左端から刷る幅（1 ドットは 1/8 mm）。${printWidthDots.step} の倍数にします。シールより広くすると右端が切れます。カップのシールもこの幅に収めます`}
            unit="ドット"
            step={printWidthDots.step}
            limits={printWidthDots}
            value={sizeText.label_printer_print_width_dots}
            defaultValue={
              DEFAULT_PRINTER_SETTINGS.label_printer_print_width_dots
            }
            onChange={sizeField("label_printer_print_width_dots")}
          />
          <NumberField
            id="label_printer_margin_mm"
            label="余白"
            description="緊急・キャンセル・テスト印刷のシールの四辺に空ける幅。中身はその内側に描きます"
            unit="mm（四辺）"
            step={0.5}
            limits={marginMm}
            value={sizeText.label_printer_margin_mm}
            defaultValue={DEFAULT_PRINTER_SETTINGS.label_printer_margin_mm}
            onChange={sizeField("label_printer_margin_mm")}
          />
          <p
            className={
              "error" in labelSize
                ? "text-red-700 text-sm"
                : "text-muted-foreground text-sm"
            }
          >
            {"error" in labelSize
              ? labelSize.error
              : labelSizeSummary(labelSize.size)}
          </p>
          <div className="flex items-start gap-3">
            <Switch
              id="label_printer_rotate_180"
              checked={values.label_printer_rotate_180}
              onCheckedChange={(checked) =>
                setValues((prev) => ({
                  ...prev,
                  label_printer_rotate_180: checked,
                }))
              }
            />
            <div className="grid gap-1">
              <Label htmlFor="label_printer_rotate_180" className="font-bold">
                180° 回して刷る
              </Label>
              <p className="text-muted-foreground text-sm">
                カップ・緊急・キャンセルのシールを上下逆さまに刷ります（シールの真ん中を中心に回します）。テスト印刷の確認用のページは、目盛りの読み方が変わらないよう回しません
              </p>
              <p className="text-muted-foreground text-xs">
                既定値:{" "}
                {DEFAULT_PRINTER_SETTINGS.label_printer_rotate_180
                  ? "回す"
                  : "回さない"}
              </p>
            </div>
          </div>
          <ChoiceField
            id="label_printer_trailing_feed"
            label="印刷の最後の送り方"
            description="1 回に刷るシールの最後に、どう送るか。空のシールを 1 枚送ると、刷ったシールの後ろに空のシールを 1 枚送ります（少しの高さの白を刷って、次のシールの先頭まで送ります）。剥離位置まで送ると、ピーラーで剥がす所で止め、そのシールを取るまで次を刷りません"
            choices={trailingFeeds}
            labels={trailingFeedLabels}
            value={values.label_printer_trailing_feed}
            defaultValue={DEFAULT_PRINTER_SETTINGS.label_printer_trailing_feed}
            onChange={(value) =>
              choose("label_printer_trailing_feed", trailingFeeds, value)
            }
          />
        </>,
      )}
      {section(
        "receipt",
        <>
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
          />
          <ChoiceField
            id="receipt_printer_paper_type"
            label="用紙の種類"
            description="レシート紙（ロール紙・連続ラベル）か、ダイカットラベル（台紙に 1 枚ずつ並んだシール）か。ダイカットラベルは印字幅が狭くなります"
            choices={paperTypes}
            labels={paperTypeLabels}
            value={values.receipt_printer_paper_type}
            defaultValue={DEFAULT_PRINTER_SETTINGS.receipt_printer_paper_type}
            onChange={(value) =>
              choose("receipt_printer_paper_type", paperTypes, value)
            }
          />
          <ChoiceField
            id="receipt_printer_paper_width"
            label="用紙の幅"
            description="プリンターに入れている紙の幅。レシートはこの紙の印字幅（かっこ内）に収めて刷ります。紙より広い幅を選ぶと右端が切れます"
            choices={paperWidths}
            labels={paperWidthLabels}
            detail={(paperWidth) => `${receiptWidths[paperWidth]} ドット`}
            value={values.receipt_printer_paper_width}
            defaultValue={DEFAULT_PRINTER_SETTINGS.receipt_printer_paper_width}
            onChange={(value) =>
              choose("receipt_printer_paper_width", paperWidths, value)
            }
          />
        </>,
      )}
      <div className="space-y-1 text-muted-foreground text-sm">
        <p>
          テスト印刷は、保存する前の入力中の設定で、確認用のページと見本を刷ります。
        </p>
        <p>
          ラベル用の確認用のページはシール 1
          枚分で、余白の内側を枠で囲み、上と左に最初に刷られる点からの目盛り（1
          mm ごとの線と 10 mm
          ごとの数字）を入れます。シールの右端・下端がどの数字の所にあるかを読み、印字幅（mm
          × 8
          ドット）とラベルの長さを合わせます。右と下の辺の三角は、刷る範囲の真ん中です。確認用のページは、180°
          回す設定でも回しません。見本は設定の向きで刷ります。ラベル用は、最後に設定の送り方で送ります。
        </p>
        <p>
          レシート用の確認用のページは、印字幅いっぱいを枠で囲みます。枠の左右が欠けていれば、紙より広い幅を選んでいます。枠の外に広い余白があれば、紙より狭い幅を選んでいます。
        </p>
        <p>
          ここの設定が紙と合っているのに欠けるときは、プリンター本体の用紙の設定（電源を入れるときに
          FEED を押したままにして刷る自己診断の「Paper Roll Width」「Type of
          Paper」）が紙と合っているかを確かめてください。
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

/** シールの大きさを、ドットと mm で書く（360 × 232 ドット（45 × 29 mm）、余白 0 mm） */
const labelSizeSummary = (size: LabelSize) => {
  // 大きさは向きによらない
  const { width, height } = labelGeometry({
    ...size,
    label_printer_rotate_180: false,
  });
  return `シールの大きさ: ${width} × ${height} ドット（${width / PRINTER_DOTS_PER_MM} × ${size.label_printer_label_length_mm} mm）、余白 ${size.label_printer_margin_mm} mm`;
};

/** 数を入れる欄。値は文字のまま親が持つ（入れかけの値も消さないように） */
function NumberField({
  id,
  label,
  description,
  unit,
  step,
  limits,
  value,
  defaultValue,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  unit: string;
  step: number;
  limits: { min: number; max: number };
  value: string;
  defaultValue: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="font-bold">
        {label}
      </Label>
      <p className="text-muted-foreground text-sm">{description}</p>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          className="w-32 font-mono"
          inputMode="decimal"
          min={limits.min}
          max={limits.max}
          step={step}
          value={value}
          placeholder={String(defaultValue)}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="text-muted-foreground text-sm">{unit}</span>
      </div>
      <p className="text-muted-foreground text-xs">
        既定値: {defaultValue} {unit}（{limits.min}〜{limits.max}）
      </p>
    </div>
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
