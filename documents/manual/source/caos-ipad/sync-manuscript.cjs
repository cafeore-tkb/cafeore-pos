/** Markdownのblockに対応する本文をHTMLへ反映。本文はguide.mdで編集する。 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const root = __dirname;
  const md = fs.readFileSync(path.join(root, "guide.md"), "utf8");
  const blocks = Object.fromEntries(
    [...md.matchAll(/<!-- block:([\w-]+) -->\n([\s\S]*?)(?=\n\n)/g)].map(
      (m) => [m[1], m[2].replace(/^(?:#{1,6}|-) /, "")],
    ),
  );
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(
      process.env.TEMPLATE_URL ||
        "http://localhost:5211/documents/manual/source/caos-ipad/layout-template.html",
    );
    const html = await page.evaluate((blocks) => {
      for (const [id, text] of Object.entries(blocks)) {
        const el = document.querySelector(`[data-manuscript="${id}"]`);
        if (!el) throw Error(`本文の対応先がありません: ${id}`);
        const heading = el.matches(".card-caption>div")
          ? el.querySelector("h3")
          : null;
        if (heading) {
          for (const node of [...el.childNodes])
            if (node !== heading) node.remove();
          el.append(document.createTextNode(text));
        } else el.textContent = text;
      }
      return `<!doctype html>${document.documentElement.outerHTML}`;
    }, blocks);
    fs.writeFileSync(path.join(root, "manual.html"), html);
    console.log(`${Object.keys(blocks).length} blocks synchronized`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
