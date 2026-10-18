import { describe, expect, test } from "vitest";
import { colorScreens } from "../models/colorSetting";
import { openapiEnumLabels } from "./openapi-enum";

describe("[unit] openapiEnumLabels", () => {
  test("画面の名前は openapi.yaml の x-enum-descriptions から引き、どの画面にもある", () => {
    const labels = openapiEnumLabels("ColorScreen");
    expect(labels.cashier).toBe("レジ（ボタン）");
    expect(Object.keys(labels)).toEqual([...colorScreens]);
    for (const screen of colorScreens) expect(labels[screen]).toBeTruthy();
  });

  test("在庫対象の種類の名前", () => {
    expect(openapiEnumLabels("StockResourceKind")).toEqual({
      item: "アイテム",
      cup: "カップ",
    });
  });

  test("レシート用のプリンターの機種の名前", () => {
    expect(openapiEnumLabels("ReceiptPrinterModel")).toEqual({
      tm_l90: "TM-L90",
      tm_m30: "TM-m30",
    });
  });

  test("プリンターの用紙の幅の名前", () => {
    expect(openapiEnumLabels("PrinterPaperWidth")).toEqual({
      "58mm": "58mm",
      "80mm": "80mm",
    });
  });

  test("プリンターの用紙の種類の名前", () => {
    expect(openapiEnumLabels("PrinterPaperType")).toEqual({
      receipt: "レシート紙",
      die_cut_label: "ダイカットラベル",
    });
  });
});
