/* PLAYWRIGHT_MODULEでplaywrightまたはplaywright-coreのモジュールパスを指定できる。 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const root = path.resolve(__dirname, "../../../..");
  const url =
    process.env.MANUAL_URL ||
    "http://localhost:5211/documents/manual/source/caos-ipad/manual.html";
  const output = path.join(root, "documents/manual/pdf/master-sheet-ipad.pdf");
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
    });
    await page.goto(url);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    const layout = await page.evaluate(() =>
      [...document.querySelectorAll("section.page")].map((section, i) => {
        const footer = section.querySelector(".footer").getBoundingClientRect();
        const bottom = Math.max(
          ...[...section.children]
            .filter((child) => !child.classList.contains("footer"))
            .map((child) => child.getBoundingClientRect().bottom),
        );
        return {
          page: i + 1,
          clearance: Math.round((footer.top - bottom) * 10) / 10,
        };
      }),
    );
    console.log(JSON.stringify(layout));
    if (layout.length !== 8 || layout.some((row) => row.clearance < 4))
      throw Error("ページ数・フッターとの重なりを確認してください");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await page.pdf({
      path: output,
      printBackground: true,
      preferCSSPageSize: true,
      tagged: true,
      outline: true,
    });
    console.log(output);
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
