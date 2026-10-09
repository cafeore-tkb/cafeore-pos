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
      cup: "カップ",
      bean: "豆",
    });
  });
});
