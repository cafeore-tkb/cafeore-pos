#!/usr/bin/env node
// 商品マスター（アイテムの種類・アイテム・メニュー・背景色設定）を API 経由で投入する。
//
//   node scripts/seed-master/seed.mjs --api <API の URL> [--reset] [--apply]
//
// 既定は何も書き込まず、やることを表示するだけ。--apply を付けたときだけ書き込む。
// 既にあるものは名前（メニューは key、背景色は対象と画面の組）で突き合わせて作らない。
// 画面で直した内容を上書きしないよう、既存の行は更新しない。
//
// --reset は投入前に既存のマスターを全部消す（いずれも論理削除）。
// メニューの key は論理削除後も一意制約に残るので、key を退避してから消す。
//
// データは /products の「書き出し」の JSON と同じ形（メニューの構成は menu_items に
// メニューの key で1行ずつ書く）。書き出したファイルを --data にそのまま渡せる。

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    api: { type: "string" },
    data: {
      type: "string",
      default: new URL("master.json", import.meta.url).pathname,
    },
    reset: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
  },
});

if (!args.api) {
  console.error("--api <URL> を指定してください");
  process.exit(1);
}
const base = args.api.replace(/\/+$/, "");
const apply = args.apply;
const seed = JSON.parse(await readFile(args.data, "utf8"));

const request = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
};

// --apply が無いときは書き込まずに表示だけする。作成の戻り値には仮の ID を返す。
let dryRunSeq = 0;
const write = async (label, method, path, body) => {
  console.log(`${apply ? "" : "[dry-run] "}${label}`);
  if (!apply) return { id: `dry-run-${++dryRunSeq}` };
  return request(method, path, body);
};

const load = async () => ({
  itemTypes: await request("GET", "/api/item-types"),
  items: await request("GET", "/api/items"),
  menus: await request("GET", "/api/menus"),
  colors: await request("GET", "/api/color-settings"),
});

console.log(`対象: ${base}${apply ? "" : "（dry-run）"}`);
let current = await load();
console.log(
  `現在: item-types ${current.itemTypes.length} / items ${current.items.length} / menus ${current.menus.length} / color-settings ${current.colors.length}`,
);

if (args.reset) {
  for (const color of current.colors) {
    await write(
      `背景色を削除: ${color.target_type} ${color.screen}`,
      "DELETE",
      `/api/color-settings/${color.id}`,
    );
  }
  for (const menu of current.menus) {
    await write(
      `メニューの key を退避: ${menu.name}（${menu.key}）`,
      "PUT",
      `/api/menus/${menu.id}`,
      {
        id: menu.id,
        name: menu.name,
        abbr: menu.abbr,
        price: menu.price,
        key: `deleted:${menu.id}`,
        items: menu.items.map((mi) => ({
          item_id: mi.item.id,
          quantity: mi.quantity,
        })),
      },
    );
    await write(
      `メニューを削除: ${menu.name}`,
      "DELETE",
      `/api/menus/${menu.id}`,
    );
  }
  for (const item of current.items) {
    await write(
      `アイテムを削除: ${item.name}`,
      "DELETE",
      `/api/items/${item.id}`,
    );
  }
  for (const itemType of current.itemTypes) {
    await write(
      `種類を削除: ${itemType.name}`,
      "DELETE",
      `/api/item-types/${itemType.id}`,
    );
  }
  current = apply
    ? await load()
    : { itemTypes: [], items: [], menus: [], colors: [] };
}

const uniqueBy = (rows, key, label) => {
  const map = new Map();
  for (const row of rows) {
    if (map.has(row[key])) {
      throw new Error(
        `${label} の ${key}=${row[key]} が複数あります。画面で整理してから流してください`,
      );
    }
    map.set(row[key], row);
  }
  return map;
};

const typeIds = new Map(
  [...uniqueBy(current.itemTypes, "name", "item-types")].map(([name, t]) => [
    name,
    t.id,
  ]),
);
for (const t of seed.item_types) {
  if (typeIds.has(t.name)) continue;
  const created = await write(
    `種類を作成: ${t.name}（${t.display_name}）`,
    "POST",
    "/api/item-types",
    {
      name: t.name,
      display_name: t.display_name,
    },
  );
  typeIds.set(t.name, created.id);
}

const itemIds = new Map(
  [...uniqueBy(current.items, "name", "items")].map(([name, i]) => [
    name,
    i.id,
  ]),
);
for (const i of seed.items) {
  if (itemIds.has(i.name)) continue;
  const itemTypeId = typeIds.get(i.item_type);
  if (!itemTypeId)
    throw new Error(`種類 ${i.item_type} がありません（${i.name}）`);
  const created = await write(
    `アイテムを作成: ${i.name}`,
    "POST",
    "/api/items",
    {
      name: i.name,
      abbr: i.abbr,
      item_type_id: itemTypeId,
    },
  );
  itemIds.set(i.name, created.id);
}

const menuKeys = uniqueBy(current.menus, "key", "menus");
for (const m of seed.menus) {
  if (menuKeys.has(m.key)) continue;
  const rows = seed.menu_items.filter((row) => row.menu === m.key);
  if (rows.length === 0)
    throw new Error(`メニュー ${m.name} の構成がありません`);
  const items = rows.map(({ item, quantity }) => {
    const itemId = itemIds.get(item);
    if (!itemId)
      throw new Error(`アイテム ${item} がありません（メニュー ${m.name}）`);
    return { item_id: itemId, quantity };
  });
  await write(
    `メニューを作成: ${m.name}（${m.key} / ${m.price}円）`,
    "POST",
    "/api/menus",
    {
      name: m.name,
      abbr: m.abbr,
      price: m.price,
      key: m.key,
      items,
    },
  );
}

const colorKey = (type, id, screen) => `${type}:${id}:${screen}`;
const existingColors = new Set(
  current.colors.map((c) => colorKey(c.target_type, c.target_id, c.screen)),
);
for (const c of seed.color_settings) {
  const targetId = (c.target_type === "ItemType" ? typeIds : itemIds).get(
    c.target,
  );
  if (!targetId)
    throw new Error(`背景色の対象 ${c.target_type} ${c.target} がありません`);
  if (existingColors.has(colorKey(c.target_type, targetId, c.screen))) continue;
  await write(
    `背景色を設定: ${c.target} ${c.screen} ${c.color}`,
    "PUT",
    "/api/color-settings",
    {
      target_type: c.target_type,
      target_id: targetId,
      screen: c.screen,
      color: c.color,
    },
  );
}

if (apply) {
  const after = await load();
  console.log(
    `投入後: item-types ${after.itemTypes.length} / items ${after.items.length} / menus ${after.menus.length} / color-settings ${after.colors.length}`,
  );
}
