const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const path = require("node:path");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      deviceScaleFactor: 2,
    });
    await page.goto(
      process.env.GALLERY_URL || "http://localhost:5210/gallery.html",
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((i) => i.decode()));
    });
    for (const [id, file] of [
      ["cards", "03-cards.png"],
      ["icons", "04-icons.png"],
    ])
      await page.locator(`#${id}`).screenshot({
        path: path.resolve(__dirname, "../../images/caos-ipad", file),
      });
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
