import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { Firestore } from "firebase/firestore";
import { beforeAll, describe, expect, test } from "vitest";
import firebasejson from "../../firebase.json";
import type { WithId } from "../lib/typeguard";
import { ItemEntity } from "../models/item";

import { itemRepoFactory } from "./item";
import type { ItemRepository } from "./type";

describe("[db] itemRepository", async () => {
  // To use this environment, firebase emulator must be running.

  let savedItemHoge: WithId<ItemEntity>;
  let itemRepository: ItemRepository;

  beforeAll(async () => {
    const testEnv = await initializeTestEnvironment({
      projectId: "demo-firestore",
      firestore: {
        host: "localhost",
        port: firebasejson.emulators.firestore.port,
      },
    });
    const testDB = testEnv
      .unauthenticatedContext()
      .firestore() as unknown as Firestore;
    itemRepository = itemRepoFactory();
  });

  test("itemRepository is defined", () => {
    expect(itemRepository).toBeDefined();
  });

  test("itemRepository.save (create)", async () => {
    const item = ItemEntity.createNew({
      name: "hoge",
      abbr: "1",
      price: 100,
      key: "1",
      item_type: { id: "1", name: "hot", display_name: "ホット" },
    });
    savedItemHoge = await itemRepository.save(item);
    expect(savedItemHoge.id).toBeDefined();
  });

  test("itemRepository.save (update)", async () => {
    savedItemHoge.assignee = "toririm";
    const savedItem = await itemRepository.save(savedItemHoge);
    expect(savedItem.id).toEqual(savedItemHoge.id);
    expect(savedItem.assignee).toEqual("toririm");
  });

  test("itemRepository.findById", async () => {
    const item = ItemEntity.createNew({
      id: "2",
      name: "fuga",
      abbr: "2",
      price: 500,
      key: "2",
      item_type: { id: "2", name: "ice", display_name: "アイス" },
    });
    const savedItem = await itemRepository.save(item);
    const foundItem = await itemRepository.findById(savedItem.id);
    expect(foundItem).toEqual(savedItem);
  });

  test("itemRepository.findAll", async () => {
    const item = ItemEntity.createNew({
      id: "3",
      name: "foo",
      abbr: "3",
      price: 600,
      key: "3",
      item_type: { id: "3", name: "ore", display_name: "オレ" },
    });
    const savedItem = await itemRepository.save(item);
    const items = await itemRepository.findAll();
    expect(items).toContainEqual(savedItem);
  });

  test("itemRepository.delete", async () => {
    const item = ItemEntity.createNew({
      id: "4",
      name: "bar",
      abbr: "4",
      price: 100,
      key: "4",
      item_type: { id: "4", name: "milk", display_name: "ミルク" },
    });
    const savedItem = await itemRepository.save(item);
    await itemRepository.delete(savedItem.id);
    const foundItem = await itemRepository.findById(savedItem.id);
    expect(foundItem).toBeNull();
  });
});
