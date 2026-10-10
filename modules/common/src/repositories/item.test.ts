import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { Firestore } from "firebase/firestore";
import { beforeAll, describe, expect, test } from "vitest";
import firebasejson from "../../firebase.json";
import type { WithId } from "../lib/typeguard";
import { ItemEntity, type ItemType } from "../models/item";

import { itemRepoFactory } from "./item";
import type { ItemRepository } from "./type";

const coffee: Omit<ItemType, "id" | "name" | "display_name"> = {
  makes_cup: true,
  needs_brew: true,
  senior_only: false,
  iced_brew: false,
};

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
      abbr: "h",
      item_type: {
        id: "1",
        name: "hot",
        display_name: "ホット",
        ...coffee,
      },
    });
    savedItemHoge = await itemRepository.save(item);
    expect(savedItemHoge.id).toBeDefined();
  });

  test("itemRepository.save (update)", async () => {
    const savedItem = await itemRepository.save(savedItemHoge);
    expect(savedItem.id).toEqual(savedItemHoge.id);
    expect(savedItem.name).toEqual("hoge");
  });

  test("itemRepository.findById", async () => {
    const item = ItemEntity.createNew({
      name: "fuga",
      abbr: "f",
      item_type: {
        id: "2",
        name: "ice",
        display_name: "アイス",
        ...coffee,
        iced_brew: true,
      },
    });
    const savedItem = await itemRepository.save(item);
    const foundItem = await itemRepository.findById(savedItem.id);
    expect(foundItem).toEqual(savedItem);
  });

  test("itemRepository.findAll", async () => {
    const item = ItemEntity.createNew({
      name: "foo",
      abbr: "f",
      item_type: {
        id: "3",
        name: "ore",
        display_name: "オレ",
        ...coffee,
      },
    });
    const savedItem = await itemRepository.save(item);
    const items = await itemRepository.findAll();
    expect(items).toContainEqual(savedItem);
  });

  test("itemRepository.delete", async () => {
    const item = ItemEntity.createNew({
      name: "bar",
      abbr: "b",
      item_type: {
        id: "4",
        name: "milk",
        display_name: "ミルク",
        ...coffee,
        needs_brew: false,
      },
    });
    const savedItem = await itemRepository.save(item);
    await itemRepository.delete(savedItem.id);
    const foundItem = await itemRepository.findById(savedItem.id);
    expect(foundItem).toBeNull();
  });
});
