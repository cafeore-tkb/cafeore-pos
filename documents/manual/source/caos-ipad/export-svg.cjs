/** 段落を1つのSVG textに保ち、画像を埋め込んで編集用ページを出力する。 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const xmlEscape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
    });
    await page.goto(
      process.env.MANUAL_URL ||
        "http://localhost:5211/documents/manual/source/caos-ipad/manual.html",
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((i) => i.decode()));
    });
    const pages = await page.evaluate(() =>
      [...document.querySelectorAll("section.page")].map((section, index) => {
        const origin = section.getBoundingClientRect();
        const out = {
          index: index + 1,
          width: origin.width,
          height: origin.height,
          boxes: [],
          images: [],
          paragraphs: [],
        };
        const rect = (r) => ({
          x: r.left - origin.left,
          y: r.top - origin.top,
          width: r.width,
          height: r.height,
        });
        const elements = [section, ...section.querySelectorAll("*")];
        for (const el of elements) {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          if (
            cs.backgroundColor !== "rgba(0, 0, 0, 0)" ||
            Number.parseFloat(cs.borderTopWidth) > 0
          )
            out.boxes.push({
              ...rect(r),
              fill: cs.backgroundColor,
              radius: Number.parseFloat(cs.borderTopLeftRadius) || 0,
              border: cs.borderTopColor,
              borderWidth: Number.parseFloat(cs.borderTopWidth) || 0,
            });
          if (el.tagName === "IMG")
            out.images.push({
              ...rect(r),
              src: el.src,
              fit: cs.objectFit,
              position: cs.objectPosition,
            });
        }
        const groups = new Map();
        const canvas = document.createElement("canvas").getContext("2d");
        const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
        let node;
        while (true) {
          node = walker.nextNode();
          if (!node) break;
          if (!node.textContent.trim()) continue;
          const parent = node.parentElement;
          const cs = getComputedStyle(parent);
          if (cs.visibility === "hidden" || cs.display === "none") continue;
          const owner =
            parent.closest(
              "p,h1,h2,h3,li,th,td,.important,.strip>div,.footer,.eyebrow,.pill,.card-caption>div",
            ) || parent;
          let group = groups.get(owner);
          if (!group) {
            group = {
              id:
                owner.getAttribute("data-manuscript") ||
                `p${index + 1}-text-${groups.size + 1}`,
              text: "",
              runs: [],
            };
            groups.set(owner, group);
          }
          canvas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          const metrics = canvas.measureText("国Ag");
          const ascent =
            metrics.fontBoundingBoxAscent ||
            Number.parseFloat(cs.fontSize) * 0.88;
          const runs = [];
          let offset = 0;
          for (const character of node.textContent) {
            const range = document.createRange();
            range.setStart(node, offset);
            offset += character.length;
            range.setEnd(node, offset);
            const r = range.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            const x = r.left - origin.left;
            const y = r.top - origin.top + ascent;
            const last = runs.at(-1);
            if (last && Math.abs(last.y - y) < 0.5) last.text += character;
            else runs.push({ x, y, text: character });
          }
          if (!runs.length) continue;
          group.text += node.textContent;
          for (const run of runs)
            group.runs.push({
              ...run,
              size: Number.parseFloat(cs.fontSize),
              family: cs.fontFamily,
              weight: cs.fontWeight,
              fill: cs.color,
              spacing:
                cs.letterSpacing === "normal"
                  ? 0
                  : Number.parseFloat(cs.letterSpacing),
            });
        }
        for (const [owner, group] of groups) {
          if (owner.tagName === "LI" && group.runs.length) {
            const first = group.runs[0];
            const number = [...owner.parentElement.children].indexOf(owner) + 1;
            group.runs.unshift({
              ...first,
              text: `${number}. `,
              x: first.x - first.size * 1.4,
            });
          }
        }
        out.paragraphs = [...groups.values()];
        return out;
      }),
    );
    const dir = path.resolve(__dirname, "../../editable/caos-ipad");
    fs.mkdirSync(dir, { recursive: true });
    const manifest = { pages: [], fonts: new Set() };
    for (const p of pages) {
      const fontFaces = [
        ["Regular", 400],
        ["Bold", 700],
      ]
        .map(
          ([name, weight]) =>
            `@font-face{font-family:'Noto Sans JP';font-weight:${weight};src:url(data:font/ttf;base64,${fs.readFileSync(path.join(__dirname, "fonts", `NotoSansJP-${name}.ttf`)).toString("base64")}) format('truetype')}`,
        )
        .join("");
      let body = `<defs><style>${fontFaces}</style></defs><title>CaOS操作ガイド ${p.index}/8</title><desc>段落ごとにtext要素を保持。画面見本は埋め込み画像。</desc>`;
      for (const box of p.boxes)
        body += `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${box.radius}" fill="${xmlEscape(box.fill === "rgba(0, 0, 0, 0)" ? "none" : box.fill)}" stroke="${xmlEscape(box.border)}" stroke-width="${box.borderWidth}"/>`;
      for (const img of p.images) {
        const local = path.resolve(
          __dirname,
          new URL(img.src).pathname.split("/source/caos-ipad/")[1] ||
            path.relative(
              "/documents/manual/source/caos-ipad",
              new URL(img.src).pathname,
            ),
        );
        const bytes = fs.readFileSync(local);
        body += `<image x="${img.x}" y="${img.y}" width="${img.width}" height="${img.height}" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${bytes.toString("base64")}"/>`;
      }
      for (const paragraph of p.paragraphs) {
        body += `<text id="${xmlEscape(paragraph.id)}" xml:space="preserve" aria-label="${xmlEscape(paragraph.text.trim())}">`;
        for (const run of paragraph.runs) {
          manifest.fonts.add(run.family);
          body += `<tspan x="${run.x}" y="${run.y}" font-family="${xmlEscape(run.family)}" font-size="${run.size}" font-weight="${run.weight}" fill="${xmlEscape(run.fill)}" letter-spacing="${run.spacing}">${xmlEscape(run.text)}</tspan>`;
        }
        body += "</text>";
      }
      const filename = `page-${String(p.index).padStart(2, "0")}.svg`;
      fs.writeFileSync(
        path.join(dir, filename),
        `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="297mm" height="210mm" viewBox="0 0 ${p.width} ${p.height}">${body}</svg>`,
      );
      manifest.pages.push({
        file: filename,
        paragraphs: p.paragraphs.length,
        images: p.images.length,
      });
    }
    manifest.fonts = [...manifest.fonts];
    fs.writeFileSync(
      path.join(dir, "structure.json"),
      `${JSON.stringify({ ...manifest, fonts: [] }, null, 2).replace('"fonts": []', `"fonts": ${JSON.stringify(manifest.fonts)}`)}\n`,
    );
    console.log(JSON.stringify(manifest));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
