import { ArrowRight } from "lucide-react";
import type { MetaFunction } from "react-router";
import { Link } from "react-router";
import { DownloadButton } from "~/components/organisms/DownloadData";
import {
  type ScreenKind,
  ScreenPreview,
} from "~/components/organisms/top/ScreenPreview";
import { cn } from "~/lib/utils";

export const meta: MetaFunction = () => {
  return [{ title: "Top / 珈琲・俺POS" }];
};

type Audience = "staff" | "customer" | "admin";

type Screen = {
  kind: ScreenKind;
  to: string;
  title: string;
  audience: Audience;
  /** 誰がどの端末で使うか */
  where: string;
  description: string;
};

type Section = {
  audience: Audience;
  title: string;
  lead: string;
  screens: Screen[];
};

const audienceBadge: Record<Audience, { label: string; className: string }> = {
  staff: { label: "スタッフ用", className: "bg-theme-primary text-white" },
  customer: { label: "お客さん向け", className: "bg-orange-500 text-white" },
  admin: { label: "運営・管理", className: "bg-stone-700 text-white" },
};

const sections: Section[] = [
  {
    audience: "staff",
    title: "営業中に使う画面",
    lead: "注文は レジ → マスター → 提供 の順に流れます",
    screens: [
      {
        kind: "cashier",
        to: "/cashier",
        title: "レジ",
        audience: "staff",
        where: "レジ担当（ラベルプリンターと接続）",
        description:
          "商品・割引・備考・お預かり金額を入力して注文を送信。送信するとカップに貼るラベルが印刷されます。",
      },
      {
        kind: "master",
        to: "/master",
        title: "マスター",
        audience: "staff",
        where: "ドリップ担当",
        description:
          "未提供の注文をカップ単位で一覧。アイスや特別な豆は色分け。オーダーストップの切り替えもここから。",
      },
      {
        kind: "serve",
        to: "/serve",
        title: "提供",
        audience: "staff",
        where: "提供担当",
        description:
          "できあがったらベルで呼び出し、手渡したらチェックで提供済みに。呼び出し画面にすぐ反映されます。",
      },
    ],
  },
  {
    audience: "customer",
    title: "お客さんに見せる画面",
    lead: "外部ディスプレイに全画面で映しておく画面です",
    screens: [
      {
        kind: "cashier-mini",
        to: "/cashier-mini",
        title: "レジ客用画面",
        audience: "customer",
        where: "レジ横のお客さん向けディスプレイ",
        description:
          "レジで入力中の注文番号・合計・おつりをリアルタイムに表示。送信すると「ご注文ありがとうございました」に切り替わります。",
      },
      {
        kind: "callscreen",
        to: "/callscreen",
        title: "呼び出し画面",
        audience: "customer",
        where: "受け取り口の大型ディスプレイ",
        description:
          "お呼び出し中の番号を大きく表示し、ドリップ中の番号も一覧。呼び出しのたびに通知音が鳴ります。",
      },
    ],
  },
  {
    audience: "admin",
    title: "運営・管理",
    lead: "売れ行きや在庫の確認、メニューの設定",
    screens: [
      {
        kind: "dashboard",
        to: "/dashboard",
        title: "ダッシュボード",
        audience: "admin",
        where: "営業中の状況確認・営業後の振り返り",
        description:
          "商品ごとの杯数（過去データとの比較）、提供時間の推移、注文一覧、オーダーストップ記録。",
      },
      {
        kind: "inventory",
        to: "/inventory",
        title: "在庫",
        audience: "admin",
        where: "棚卸し・入荷のたびに記録",
        description:
          "棚卸しの実数と入荷・注文から、豆とカップの残量を推定。棚卸し・入荷の記録もここで。",
      },
    ],
  },
];

const settingLinks = [
  { to: "/products", label: "商品管理" },
  { to: "/inventory/settings", label: "在庫の設定" },
];

export default function Index() {
  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-6 font-noto">
      <header>
        <h1 className="font-bold text-3xl text-ore">珈琲・俺POS</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          使う画面を選んでください。各画面は担当の端末で開いたままにしておきます。
        </p>
      </header>

      {sections.map((section) => (
        <section key={section.audience}>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-bold text-xl">{section.title}</h2>
            <p className="text-muted-foreground text-sm">{section.lead}</p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {section.screens.map((screen) => (
              <li key={screen.to}>
                <ScreenCard screen={screen} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h2 className="font-bold">マスタ設定</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            メニュー・商品・在庫の通知条件を編集します
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {settingLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <h2 className="font-bold">オーダーデータ書き出し</h2>
          <p className="mt-1 mb-3 text-muted-foreground text-sm">
            全注文を CSV でダウンロードします
          </p>
          <DownloadButton />
        </div>
      </section>
    </div>
  );
}

function ScreenCard({ screen }: { screen: Screen }) {
  const badge = audienceBadge[screen.audience];
  return (
    <Link
      to={screen.to}
      className={cn(
        "group flex h-full flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm transition",
        "hover:border-theme-primary hover:shadow-md focus-visible:outline-2 focus-visible:outline-theme-primary",
      )}
    >
      <div className="transition-transform duration-200 group-hover:scale-[1.02]">
        <ScreenPreview kind={screen.kind} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-1">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-2xl text-amber-950">{screen.title}</h3>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-medium text-xs",
              badge.className,
            )}
          >
            {badge.label}
          </span>
          <ArrowRight className="ml-auto h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-theme-primary" />
        </div>
        <p className="text-muted-foreground text-xs">
          {screen.where}
          <span className="ml-2 font-mono">{screen.to}</span>
        </p>
        <p className="text-sm leading-relaxed">{screen.description}</p>
      </div>
    </Link>
  );
}
