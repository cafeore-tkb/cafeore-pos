import type { components } from "../types/api";
import openapiSchemas from "../types/openapi-schemas.json";

type Schemas = components["schemas"];
type JsonSchemas = typeof openapiSchemas;

// openapi.yaml で x-enum-descriptions（値ごとの表示名）を持つ enum の名前
type LabeledEnum = {
  [K in keyof JsonSchemas & keyof Schemas]: JsonSchemas[K] extends {
    "x-enum-descriptions": string[];
  }
    ? K
    : never;
}[keyof JsonSchemas & keyof Schemas];

/**
 * openapi.yaml の enum の値ごとの表示名（x-enum-descriptions）。
 * 表示名は openapi.yaml にだけ書き、POS と API の通知で同じ言い方にする。
 */
export const openapiEnumLabels = <K extends LabeledEnum>(
  name: K,
): Record<Schemas[K], string> => {
  const schema: { enum: string[]; "x-enum-descriptions": string[] } =
    openapiSchemas[name];
  return Object.fromEntries(
    schema.enum.map((value, i) => [value, schema["x-enum-descriptions"][i]]),
  ) as Record<Schemas[K], string>;
};
