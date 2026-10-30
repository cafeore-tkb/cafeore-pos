import { describe, expect, it } from "vitest";
import { comparisonDefaults } from "./comparisonDefaults";
import preset from "./data/comparison-2026.json";
import { comparisonSettingsSchema } from "./yearComparison";

const products = preset.map((row, i) => ({
  key: `id-${i}`,
  name: row.current,
}));
const historical = preset.flatMap((row) => row.historical);
describe("2026 comparison defaults", () => {
  it("reproduces all ten rows and eleven historical cards in screenshot order", () => {
    const settings = comparisonDefaults("2026", products, historical);
    if (!settings) throw new Error("Expected defaults");
    expect(comparisonSettingsSchema.safeParse(settings).success).toBe(true);
    expect(
      settings.board?.groups.map((g) => ({
        current: g.current,
        historical: g.historical,
      })),
    ).toEqual(
      preset.map((row, i) => ({
        current: [`id-${i}`],
        historical: row.historical,
      })),
    );
    expect(settings.current["id-4"]).toBe(settings.historical.縁ブレンド);
    expect(settings.historical.縁ブレンド).toBe(
      settings.historical.も花も香ブレンド,
    );
    expect(settings.board?.pendingCurrent).toEqual([]);
    expect(settings.board?.pendingHistorical).toEqual([]);
  });
  it("does not apply to another year or unavailable catalogs", () => {
    expect(comparisonDefaults("2027", products, historical)).toBeNull();
    expect(comparisonDefaults("2026", [], historical)).toBeNull();
    expect(comparisonDefaults("2026", products, [])).toBeNull();
  });
  it("leaves unknown and ambiguous products pending without guessing", () => {
    const settings = comparisonDefaults(
      "2026",
      [
        ...products,
        { key: "duplicate", name: "余音ブレンド" },
        { key: "new", name: "新商品" },
      ],
      [...historical, "新しい前年商品"],
    );
    if (!settings) throw new Error("Expected defaults");
    expect(settings.board?.groups).toHaveLength(9);
    expect(settings.board?.pendingCurrent).toEqual([
      "id-4",
      "duplicate",
      "new",
    ]);
    expect(settings.board?.pendingHistorical).toEqual([
      "縁ブレンド",
      "も花も香ブレンド",
      "新しい前年商品",
    ]);
  });
});
