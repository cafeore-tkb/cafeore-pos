const { chromium, devices } = require(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const BASE = process.env.APP_URL || "http://localhost:5191";
const out = require("node:path").resolve(__dirname, "../../images/caos-ipad");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    env: { ...process.env, XDG_CACHE_HOME: "/tmp/cafeore-manual/cache" },
  });
  try {
    const context = await browser.newContext({
      ...devices["iPad Pro 11"],
      viewport: { width: 1194, height: 834 },
      screen: { width: 1194, height: 834 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo",
    });
    await context.route(/https?:\/\/192\.168\./, (r) => r.abort());
    const page = await context.newPage();
    const home = async () => {
      await page.goto(`${BASE}/master-sheet`);
      await page.waitForTimeout(1800);
      await page.evaluate(() => document.fonts.ready);
    };
    await home();
    await page.waitForTimeout(10000);
    await page.screenshot({ path: `${out}/01-timeline.png` });
    await page.getByRole("button", { name: "キュー", exact: true }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/02-queue.png` });
    await page.getByRole("button", { name: /^注文にコメント/ }).click();
    await page.getByRole("button", { name: /^#134/ }).click();
    await page
      .locator("#caos-comment-text")
      .fill("ミルクの準備ができました。受け取りをお願いします。");
    await page.screenshot({ path: `${out}/06-comments.png` });
    await home();
    await page.getByRole("button", { name: "緊急", exact: true }).click();
    await page.getByLabel("注文番号", { exact: true }).fill("121");
    await page.getByRole("button", { name: "抽出ミス", exact: true }).click();
    await page.waitForTimeout(500);
    await page
      .locator("form")
      .filter({ has: page.getByLabel("注文番号", { exact: true }) })
      .screenshot({ path: `${out}/05-emergency.png` });
    await home();
    await page
      .getByRole("button", { name: "オーダー受付の状態と切替" })
      .click();
    await page.waitForTimeout(300);
    await page
      .locator("#caos-order-stop-panel")
      .screenshot({ path: `${out}/07-order-stop.png` });
    await home();
    await page.getByRole("button", { name: /山田/ }).first().click();
    await page.waitForTimeout(300);
    await page
      .getByRole("dialog")
      .screenshot({ path: `${out}/07-assignee.png` });
    await home();
    await page.getByRole("button", { name: "キュー", exact: true }).click();
    await page
      .getByRole("button", { name: /淹れ直し登録済み/ })
      .first()
      .click();
    await page.waitForTimeout(300);
    await page
      .getByRole("alertdialog")
      .screenshot({ path: `${out}/05-discard.png` });
    await page.goto(`${BASE}/master-sheet/libero`);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${out}/08-libero.png` });
    console.log("Captured 8 actual application views with iPad emulation");
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
