// Browser QA only: all API and WebSocket data is synthetic. No backend is contacted.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/qa/dashboard-year-comparison.mjs [output-dir] [preview-url]
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = path.resolve(
  process.argv[2] || "/tmp/cafeore-dashboard-qa/screenshots",
);
const url = process.argv[3] || "http://127.0.0.1:5179/dashboard";
await mkdir(output, { recursive: true });
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = (clock) => `2026-10-30T${clock}:00+09:00`;
const base = Date.parse(stamp("10:00"));
const now = Date.parse(stamp("15:30"));
const types = ["ホット", "アイス", "ミルク"].map((name, i) => ({
  id: uuid(100 + i),
  name: `demo-${i}`,
  display_name: name,
  makes_cup: true,
  needs_brew: i === 0,
  senior_only: false,
  iced_brew: false,
  serve_with_snack: false,
}));
const names = [
  "珈琲・俺ブレンド2026",
  "余音ブレンド",
  "シングルオリジン",
  "アイスコーヒー",
  "カフェオレ",
  "ミルク",
];
const items = names.map((name, i) => ({
  id: uuid(i + 1),
  name,
  abbr: name.slice(0, 3),
  item_type: types[i < 3 ? 0 : i < 5 ? 1 : 2],
}));
const menus = items.map((item, i) => ({
  id: uuid(i + 20),
  name: item.name,
  abbr: item.abbr,
  price: [400, 500, 600, 400, 500, 200][i],
  key: String(i + 1),
  priority: 0,
  items: [{ item, quantity: 1 }],
}));
const order = (i, created = base + ((i * 97_000) % (now - base - 600_000))) => {
  const itemIndex = i % items.length;
  const menu = menus[itemIndex];
  const id = uuid(1000 + i);
  const ready = created + (4 + (i % 10)) * 60_000;
  const served = ready + (1 + (i % 4)) * 60_000;
  const menuId = uuid(2000 + i);
  return {
    id,
    order_id: i + 1,
    created_at: new Date(created).toISOString(),
    ready_at: ready < now ? new Date(ready).toISOString() : null,
    served_at: served < now ? new Date(served).toISOString() : null,
    billing_amount: menu.price,
    received: menu.price,
    discount_order_id: null,
    discount_order_cups: 0,
    cancelled_at: i === 9 ? new Date(created + 30000).toISOString() : null,
    cash_refunded_at: null,
    payment_method: i % 3 === 0 ? "square" : "cash",
    square_refund_status: "none",
    comments: [],
    payments: [],
    menus: [
      {
        id: menuId,
        menu,
        menu_name: menu.name,
        unit_price: menu.price,
        assignee: null,
        dripper: null,
      },
    ],
    cups: [
      {
        id: uuid(3000 + i),
        order_menu_id: menuId,
        item: items[itemIndex],
        ready_at: ready < now ? new Date(ready).toISOString() : null,
        served_at: served < now ? new Date(served).toISOString() : null,
        dripper: itemIndex < 3 ? (i % 6) + 1 : null,
        dripper_position: i,
        drip_id: uuid(4000 + i),
        brew_started_at: new Date(created + 60000).toISOString(),
        brew_finished_at: ready < now ? new Date(ready).toISOString() : null,
        emergencies: [],
      },
    ],
  };
};
const orders = Array.from({ length: 230 }, (_, i) => order(i));
const inventory = ["ブレンドの豆", "ホットカップ", "ミルク"].map((name, i) => ({
  resource: {
    id: uuid(8000 + i),
    kind: i === 1 ? "cup" : "item",
    item_id: i === 1 ? null : items[i].id,
    name,
    item_type_ids: [],
    unit: ["g", "個", "ml"][i],
    per_serving: [15, 1, 150][i],
    notify_from: 100,
    notify_step: 20,
    buffer: 20,
  },
  level: i === 2 ? "warning" : "ok",
  counted_at: stamp("09:00"),
  counted_quantity: [5000, 500, 15000][i],
  received: 0,
  consumed: [1890, 126, 9900][i],
  servings: [126, 126, 66][i],
  remaining: [3110, 374, 5100][i],
  remaining_servings: [207, 374, 34][i],
  servings_last_hour: [26, 38, 13][i],
}));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  deviceScaleFactor: 1,
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  reducedMotion: "reduce",
});
const sockets = [];
const unexpectedRequests = [];
await context.routeWebSocket(/.*/, (ws) => {
  sockets.push(ws);
  ws.send(JSON.stringify({ type: "orders", orders }));
  ws.send(
    JSON.stringify({
      type: "master_state",
      master_state: { created_at: stamp("09:00"), type: "operational" },
    }),
  );
});
await context.route("**/*", async (route) => {
  const req = route.request();
  const requestUrl = new URL(req.url());
  if (requestUrl.pathname === "/status")
    return route.fulfill({
      json: { database: "connected" },
      headers: { "access-control-allow-origin": "*" },
    });
  if (requestUrl.pathname.startsWith("/api/")) {
    if (req.method() !== "GET") {
      unexpectedRequests.push(`${req.method()} ${requestUrl.pathname}`);
      return route.abort();
    }
    const values = {
      "/api/me": {
        enforcement: "enforce",
        email: "qa@example.invalid",
        role: "admin",
      },
      "/api/items": items,
      "/api/item-types": types,
      "/api/menus": menus,
      "/api/inventory": inventory,
      "/api/master-status": [
        { created_at: stamp("09:00"), type: "operational" },
        { created_at: stamp("12:04"), type: "stop" },
        { created_at: stamp("12:09"), type: "operational" },
      ],
      "/api/caos/logs": {
        entries: [
          {
            tabId: "demo",
            sequence: 1,
            at: stamp("12:09"),
            event: "comment.created",
            details: { page: "CaOS", text: "仮データ：提供を再開しました" },
          },
        ],
        operations: [],
      },
    };
    if (!(requestUrl.pathname in values))
      unexpectedRequests.push(`GET ${requestUrl.pathname}`);
    return route.fulfill({
      json: values[requestUrl.pathname] ?? [],
      headers: { "access-control-allow-origin": "*" },
    });
  }
  return route.continue();
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.clock.install({ time: new Date(now) });
await page.goto(url);
await page
  .getByRole("heading", { name: "ダッシュボード", exact: true })
  .waitFor();
await page.getByText("リアルタイム更新中", { exact: true }).waitFor();
await page
  .getByRole("combobox", { name: "前年の比較日", exact: true })
  .selectOption("2025-11-02");
await page.getByText("商品の対応付けを編集", { exact: true }).click();
const storageKey = "dashboard:2025-comparison:v1";
const cardButton = (side, name) =>
  page.getByRole("button", {
    name: `${side === "current" ? "今年" : "前年"}の${name}を選ぶ`,
    exact: true,
  });
const rowFor = (side, key) =>
  page.locator("[data-mapping-group]").filter({
    has: page.locator(
      `[data-mapping-side="${side}"][data-mapping-card=${JSON.stringify(key)}]`,
    ),
  });
const dragCard = async (side, name, target, preview = false, touch = false) => {
  const source = page.getByRole("button", {
    name: `${side === "current" ? "今年" : "前年"}の${name}をドラッグ`,
    exact: true,
  });
  const sb = await source.boundingBox();
  const tb = await target.boundingBox();
  const scrollTop = await page.evaluate(() => scrollY);
  await page.evaluate(
    (top) => scrollTo(0, top),
    Math.max(0, Math.min(sb.y, tb.y) + scrollTop - 150),
  );
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  let touchSession;
  if (touch) {
    touchSession = await context.newCDPSession(page);
    await touchSession.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    await touchSession.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...start, id: 1 }],
    });
    for (let step = 1; step <= 15; step++)
      await touchSession.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: start.x + ((end.x - start.x) * step) / 15,
            y: start.y + ((end.y - start.y) * step) / 15,
            id: 1,
          },
        ],
      });
  } else {
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      from.x + from.width / 2 + 8,
      from.y + from.height / 2,
      { steps: 2 },
    );
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 15,
    });
  }
  if (preview) {
    await page.locator("[data-add-preview]").first().waitFor();
    await page.screenshot({
      path: path.join(output, "11-mapping-add-preview.png"),
    });
  }
  if (touchSession) {
    await touchSession.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await touchSession.send("Emulation.setTouchEmulationEnabled", {
      enabled: false,
    });
    await touchSession.detach();
  } else await page.mouse.up();
  await page.clock.runFor(400);
};
assert.equal(await page.locator("[data-mapping-group]").count(), 0);
assert.equal(
  await page.locator("[data-pending-side] [data-mapping-card]").count(),
  17,
);
// Same-year cards can be reordered without creating a mapping.
await dragCard("current", "ミルク", cardButton("current", "アイスコーヒー"));
assert.equal(
  await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).board.pendingCurrent[0],
    storageKey,
  ),
  items[5].id,
);
// User's example: 縁 + も花も香 -> 余音, with a visible + before dropping.
await dragCard(
  "historical",
  "縁ブレンド",
  cardButton("current", "余音ブレンド"),
);
await dragCard(
  "historical",
  "も花も香ブレンド",
  cardButton("historical", "縁ブレンド"),
  true,
  true,
);
assert.equal(
  await rowFor("current", items[1].id)
    .locator('[data-mapping-side="historical"]')
    .count(),
  2,
);
const dimensions = await rowFor("current", items[1].id)
  .locator(".mapping-cell")
  .evaluateAll((cells) => cells.map((c) => c.getBoundingClientRect().height));
assert.ok(Math.abs(dimensions[0] - dimensions[1]) < 1);
await rowFor("current", items[1].id).screenshot({
  path: path.join(output, "12-mapping-pair.png"),
});
// Click/keyboard alternative to dragging. A target in an existing row adds another card.
const pair = async (currentName, historicalName) => {
  await cardButton("current", currentName).click();
  await cardButton("historical", historicalName).click();
};
await pair(names[0], "珈琲・俺ブレンド");
await pair(names[2], "トラジャ");
for (const old of ["ピンクブルボン", "ライチ", "ブルマン"]) {
  await cardButton("historical", old).click();
  await rowFor("current", items[2].id)
    .getByRole("button", { name: /の行に追加$/ })
    .click();
}
await pair(names[3], "アイスコーヒー");
await pair(names[4], "アイスオレ");
await pair(names[5], "アイスミルク");
await page
  .getByRole("button", {
    name: "前年のキリマンジャロを対応から外す",
    exact: true,
  })
  .click();
assert.equal(
  await page
    .locator('[data-excluded-side="historical"] [data-mapping-card]')
    .count(),
  1,
);
await page
  .locator('section[aria-label="比較しないカード"]')
  .screenshot({ path: path.join(output, "13-mapping-excluded.png") });
const saved = await page.evaluate(
  (key) => JSON.parse(localStorage.getItem(key)),
  storageKey,
);
assert.equal(saved.version, 2);
assert.equal(saved.current[items[1].id], "余音ブレンド");
assert.equal(saved.historical.縁ブレンド, "余音ブレンド");
assert.equal(saved.historical.も花も香ブレンド, "余音ブレンド");
await page
  .getByRole("combobox", { name: "前年の比較日", exact: true })
  .selectOption("2025-11-03");
await page.reload();
await page.waitForFunction(
  () =>
    document.querySelector('select[aria-label="前年の比較日"]')?.value ===
    "2025-11-03",
);
await page.getByText("リアルタイム更新中", { exact: true }).waitFor();
await page.getByText("商品の対応付けを編集", { exact: true }).click();
assert.equal(
  await rowFor("current", items[1].id)
    .locator('[data-mapping-side="historical"]')
    .count(),
  2,
);
assert.equal(
  await page
    .locator('[data-excluded-side="historical"] [data-mapping-card]')
    .count(),
  1,
);
await page
  .getByRole("button", { name: "前年のキリマンジャロを戻す", exact: true })
  .click();
assert.equal(
  await page
    .locator('[data-pending-side="historical"] [data-mapping-card]')
    .count(),
  1,
);
await page
  .getByRole("button", {
    name: "前年のキリマンジャロを対応から外す",
    exact: true,
  })
  .click();
await page
  .getByRole("combobox", { name: "前年の比較日", exact: true })
  .selectOption("2025-11-02");
// A new order created after the last 10-second tick must be included immediately on receipt.
const salesCard = page
  .locator("article")
  .filter({ has: page.getByText("売上", { exact: true }) });
const before = await salesCard.innerText();
await page.clock.runFor(1000);
const extra = order(500, now + 500);
orders.push(extra);
sockets.at(-1).send(JSON.stringify({ type: "order", order: extra }));
await page.waitForFunction(
  ({ expected }) =>
    [...document.querySelectorAll("article")].some(
      (e) => e.textContent.includes("売上") && e.textContent.includes(expected),
    ),
  {
    expected: `¥${orders
      .filter((o) => !o.cancelled_at)
      .reduce((sum, o) => sum + o.billing_amount, 0)
      .toLocaleString("ja-JP")}`,
  },
);
assert.notEqual(await salesCard.innerText(), before);
const productChart = page.locator(
  '[aria-label="今年の注文杯数と対応付けた前年の杯数"]',
);
// Six current products become six comparison groups. Last year's totals are not repeated per product.
assert.equal(await productChart.locator('g[data-year="current"]').count(), 6);
assert.ok((await productChart.locator('[fill="#c8e3cf"]').count()) >= 5);
const milkRow = page.getByRole("row").filter({
  has: page.getByRole("rowheader", { name: "ミルク", exact: true }),
});
const milkValues = await milkRow.locator("td").allTextContents();
const milkCurrent = Number.parseInt(milkValues[0], 10);
const milkPrevious = Number.parseInt(milkValues[1], 10);
assert.ok(milkCurrent > milkPrevious);
const ratio = await productChart
  .locator('[data-year-excess="true"]')
  .first()
  .evaluate((element) => {
    const base = element.previousElementSibling;
    return (
      Number(element.getAttribute("width")) /
      (Number(element.getAttribute("width")) +
        Number(base.getAttribute("width")))
    );
  });
assert.ok(Math.abs(ratio - (milkCurrent - milkPrevious) / milkCurrent) < 0.001);
assert.ok(
  await salesCard
    .locator("strong")
    .evaluateAll((elements) =>
      elements.every((e) => Number(getComputedStyle(e).fontWeight) >= 700),
    ),
);
assert.ok(
  (await productChart.locator("defs linearGradient stop").count()) >= 7,
);
assert.ok(
  await productChart
    .locator('[data-year-excess="true"]')
    .first()
    .evaluate((element) => {
      const id = element.getAttribute("fill").slice(5, -1);
      const gradient = document.getElementById(id);
      return (
        gradient.getAttribute("gradientUnits") === "userSpaceOnUse" &&
        Number(gradient.getAttribute("x2")) -
          Number(gradient.getAttribute("x1")) <
          Number(element.getAttribute("width")) &&
        gradient.getAttribute("y1") === gradient.getAttribute("y2")
      );
    }),
);
assert.ok(
  await page
    .locator("linearGradient")
    .evaluateAll((gradients) =>
      gradients.some(
        (gradient) =>
          gradient.getAttribute("x1") === gradient.getAttribute("x2") &&
          Number(gradient.getAttribute("y2")) <
            Number(gradient.getAttribute("y1")),
      ),
    ),
);
assert.ok(
  await productChart
    .locator('[data-year-excess="true"]')
    .first()
    .evaluate((element) => {
      const gradient = document.getElementById(
        element.getAttribute("fill").slice(5, -1),
      );
      const length =
        Number(gradient.getAttribute("x2")) -
        Number(gradient.getAttribute("x1"));
      const base = element.previousElementSibling;
      const stops = [...gradient.querySelectorAll("stop")];
      return (
        Math.abs(length - Number(base.getAttribute("width"))) < 0.001 &&
        stops
          .find((s) => s.classList.contains("year-excess-stop-pink"))
          .getAttribute("offset") === "10%" &&
        stops
          .find((s) => s.classList.contains("year-excess-stop-coral"))
          .getAttribute("offset") === "25%" &&
        getComputedStyle(stops[0]).stopColor === "rgb(30, 64, 175)"
      );
    }),
);
// Screenshot labels are injected by the QA harness only, never shipped with the product.
await page.addStyleTag({
  content:
    'html::before { content: "仮データでの表示確認 / 2026-10-30 15:30"; display:block; padding:8px 20px; background:#f5f5f4; color:#57534e; font:12px sans-serif; }',
});
await page.evaluate(() => document.fonts.ready);
const capture = async (filename) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(output, `${filename}.png`),
    fullPage: true,
  });
  await page.screenshot({
    path: path.join(output, `${filename}-viewport.png`),
  });
};
await capture("07-mapping");
await page.getByText("商品の対応付けを編集", { exact: true }).click();
const sections = [
  ["売り上げ", "01-sales"],
  ["提供パフォーマンス", "02-performance"],
  ["消費量・在庫", "03-inventory"],
  ["個別データ", "04-details"],
  ["運用記録", "05-records"],
  ["25年度比較", "06-comparison"],
];
for (const [name, filename] of sections) {
  await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
  await page.getByRole("heading", { name, exact: true }).waitFor();
  if (name === "消費量・在庫")
    await page.getByText("ブレンドの豆", { exact: true }).first().waitFor();
  if (name === "運用記録")
    await page
      .locator("summary")
      .filter({ hasText: "業務コメントを保存" })
      .waitFor();
  await page.waitForTimeout(250);
  await capture(filename);
}
await page.getByRole("tab", { name: /^売り上げ/ }).click();
await page.setViewportSize({ width: 820, height: 1180 });
await page.waitForTimeout(250);
await capture("08-ipad-sales");
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false,
);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
await capture("09-mobile-sales");
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false,
);
// Preview the actual CSS palette with its fixed ratio anchors.
await page.setViewportSize({ width: 1000, height: 220 });
await page.evaluate(() => {
  const panel = document.createElement("section");
  panel.id = "qa-color-scale";
  panel.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:white;padding:32px 60px;font:13px system-ui;color:#172554";
  panel.innerHTML = `<p style="margin:0 0 22px;font-size:18px;font-weight:700">前年比の配色</p><div class="year-excess-legend" style="height:28px;border:1px solid #94a3b8;border-radius:3px"></div><div style="position:relative;margin-top:10px">${[
    100, 110, 125, 140, 160, 180, 200,
  ]
    .map(
      (value) =>
        `<span style="position:absolute;left:${value - 100}%;transform:translateX(-50%);font-weight:700">${value}%</span>`,
    )
    .join("")}</div>`;
  document.body.append(panel);
});
await page
  .locator("#qa-color-scale")
  .screenshot({ path: path.join(output, "10-color-scale.png") });
await page.locator("#qa-color-scale").evaluate((element) => element.remove());
await page.setViewportSize({ width: 390, height: 844 });
// Invalid saved data must survive both initial loading and cross-tab reloads verbatim.
const validSettingsText = await page.evaluate(
  (key) => localStorage.getItem(key),
  storageKey,
);
const invalidSettingsTexts = [
  "{broken-json",
  JSON.stringify({ ...JSON.parse(validSettingsText), version: 999 }),
  "",
];
const readFailure = page
  .getByRole("alert")
  .filter({ hasText: "比較設定の編集・自動保存を停止" });
const currentGroupInput = cardButton("current", names[0]);
for (const invalid of invalidSettingsTexts) {
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: storageKey,
    value: invalid,
  });
  await page.reload();
  await readFailure.waitFor();
  await page.getByText("商品の対応付けを編集", { exact: true }).click();
  assert.equal(await currentGroupInput.isDisabled(), true);
  assert.equal(await page.locator("[data-mapping-group]").count(), 0);
  await page.clock.runFor(10000);
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
    invalid,
  );
}
const peer = await context.newPage();
await peer.goto(`${new URL(url).origin}/status`);
const writeFromPeer = (value) =>
  peer.evaluate(
    ({ key, value }) => {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    },
    { key: storageKey, value },
  );
await writeFromPeer(validSettingsText);
await rowFor("current", items[0].id).waitFor();
assert.equal(await currentGroupInput.isDisabled(), false);
// A later failure must clear the previously loaded mapping and synchronously block writes.
const corruptFromPeer = JSON.stringify({
  version: 999,
  untouched: "must survive",
});
await writeFromPeer(corruptFromPeer);
await readFailure.waitFor();
assert.equal(await page.locator("[data-mapping-group]").count(), 0);
assert.equal(await currentGroupInput.isDisabled(), true);
assert.equal(
  await page
    .getByRole("combobox", { name: "前年の比較日", exact: true })
    .isDisabled(),
  true,
);
// Exercise the hook's guard as well as the disabled UI, even if a DOM edit bypasses disabled.
await currentGroupInput.evaluate((element) => {
  element.disabled = false;
  element.closest("fieldset").disabled = false;
});
await currentGroupInput.click();
await cardButton("historical", "縁ブレンド").evaluate((element) => {
  element.disabled = false;
  element.closest("fieldset").disabled = false;
});
await cardButton("historical", "縁ブレンド").click();
assert.equal(
  await page.evaluate((key) => localStorage.getItem(key), storageKey),
  corruptFromPeer,
);
await writeFromPeer(validSettingsText);
await rowFor("current", items[0].id).waitFor();
assert.equal(await currentGroupInput.isDisabled(), false);
await writeFromPeer(null);
await page.waitForFunction(
  () => document.querySelectorAll("[data-mapping-group]").length === 0,
);
assert.equal(await currentGroupInput.isDisabled(), false);
assert.equal(
  await page.evaluate((key) => localStorage.getItem(key), storageKey),
  null,
);
await writeFromPeer(validSettingsText);
await rowFor("current", items[0].id).waitFor();
await peer.close();
await page.getByText("商品の対応付けを編集", { exact: true }).click();
// Storage quota/private-mode failure keeps the edit in memory and reports that it was not saved.
await page.getByText("商品の対応付けを編集", { exact: true }).click();
await page.evaluate(() => {
  Storage.prototype.setItem = () => {
    throw new Error("QA quota failure");
  };
});
await cardButton("current", names[0]).click();
await rowFor("current", items[1].id)
  .getByRole("button", { name: /の行に追加$/ })
  .click();
await page
  .getByRole("alert")
  .filter({ hasText: "ブラウザに保存できませんでした" })
  .waitFor();
assert.equal(
  await rowFor("current", items[1].id)
    .locator('[data-mapping-side="current"]')
    .count(),
  2,
);
assert.equal(
  await page.evaluate((key) => localStorage.getItem(key), storageKey),
  validSettingsText,
);
assert.deepEqual(errors, []);
assert.deepEqual(unexpectedRequests, []);
await writeFile(
  path.join(output, "validation.json"),
  JSON.stringify(
    {
      pages: sections.map(([name]) => name),
      viewport: [1440, 1050],
      currentFixture: { orders: orders.length, timestamp: stamp("15:30") },
      historical: "Bundled 2025/data/day12.json (real data)",
      checks: [
        "no implicit product mapping",
        "dragged cards align in one row and show plus before adding a second historical card",
        "touch dragging and click alternative create mappings; reorder, exclusions and restore survive reload",
        "mapping and comparison date survive reload",
        "WebSocket order immediately changes sales",
        "product graph groups many-to-many mappings without duplicating previous counts",
        "previous products appear as pale green lines and gradient width equals the surplus",
        "comparison numbers use bold dark text",
        "axis aligned gradient uses fixed year-over-year percentage anchors",
        "iPad and mobile have no horizontal page overflow",
        "storage write failure shown and edit retained",
        "invalid JSON, version and empty saved values remain byte-for-byte unchanged",
        "cross-tab read failure clears stale settings and blocks writes even if disabled is bypassed",
        "valid cross-tab replacement or removal recovers editing",
        "no runtime errors or backend mutations",
      ],
      runtimeErrors: errors,
      unexpectedRequests,
    },
    null,
    2,
  ),
);
await browser.close();
console.log(JSON.stringify({ output, screenshots: 13, result: "passed" }));
