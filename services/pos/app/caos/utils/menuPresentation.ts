import type { BeanCode } from "../types";

export type MenuFamily = "signature" | "gourmet" | "finish" | "premium";

export interface MenuPresentation {
  family: MenuFamily;
  familyLabel: string;
  shortLabel: string;
  processLabel: string;
  cardClass: string;
  badgeClass: string;
  accent: string;
}

export const MENU_PRESENTATION: Record<BeanCode, MenuPresentation> = {
  CHAMP: {
    family: "signature",
    familyLabel: "看板",
    shortLabel: "チャンプ",
    processLabel: "定番ブレンド",
    cardClass: "bg-white border-slate-300",
    badgeClass: "bg-slate-900 text-white",
    accent: "#64748b",
  },
  ORE: {
    family: "signature",
    familyLabel: "看板",
    shortLabel: "俺ブレ",
    processLabel: "深煎りブレンド",
    cardClass: "bg-white border-slate-300",
    badgeClass: "bg-slate-900 text-white",
    accent: "#64748b",
  },
  KEN: {
    family: "gourmet",
    familyLabel: "限定豆",
    shortLabel: "ケニア",
    processLabel: "浅煎り",
    cardClass: "bg-white border-slate-300",
    badgeClass: "bg-slate-900 text-white",
    accent: "#64748b",
  },
  TNZ: {
    family: "gourmet",
    familyLabel: "限定豆",
    shortLabel: "タンザニア",
    processLabel: "中煎り",
    cardClass: "bg-white border-slate-300",
    badgeClass: "bg-slate-900 text-white",
    accent: "#64748b",
  },
  BRA: {
    family: "gourmet",
    familyLabel: "限定豆",
    shortLabel: "ブラジル",
    processLabel: "深煎り",
    cardClass: "bg-white border-slate-300",
    badgeClass: "bg-slate-900 text-white",
    accent: "#64748b",
  },
  ICE: {
    family: "finish",
    familyLabel: "仕上げ",
    shortLabel: "氷",
    processLabel: "ハーフ抽出 → 急冷",
    cardClass: "bg-cyan-50 border-cyan-200",
    badgeClass: "bg-cyan-700 text-white",
    accent: "#0891b2",
  },
  MILK: {
    family: "finish",
    familyLabel: "仕上げ",
    shortLabel: "牛",
    processLabel: "ハーフ抽出 → 牛乳",
    cardClass: "bg-violet-50 border-violet-200",
    badgeClass: "bg-violet-700 text-white",
    accent: "#7c3aed",
  },
  SP: {
    family: "premium",
    familyLabel: "特別",
    shortLabel: "限定SP",
    processLabel: "特別抽出",
    cardClass: "bg-emerald-950 border-emerald-700",
    badgeClass: "bg-emerald-200 text-emerald-950",
    accent: "#047857",
  },
  OTHER: {
    family: "gourmet",
    familyLabel: "その他",
    shortLabel: "その他",
    processLabel: "通常抽出",
    cardClass: "bg-white border-slate-300",
    badgeClass: "bg-slate-900 text-white",
    accent: "#64748b",
  },
};

export const MENU_GROUPS: {
  family: MenuFamily;
  title: string;
  description: string;
  codes: BeanCode[];
}[] = [
  {
    family: "signature",
    title: "SIGNATURE",
    description: "注文の中心になる2大看板",
    codes: ["CHAMP", "ORE"],
  },
  {
    family: "gourmet",
    title: "GOURMET BEANS",
    description: "焙煎違いで楽しむ限定豆",
    codes: ["KEN", "TNZ", "BRA", "SP"],
  },
  {
    family: "finish",
    title: "SLOW FINISH",
    description: "半量をゆっくり抽出して仕上げる",
    codes: ["ICE", "MILK"],
  },
];
