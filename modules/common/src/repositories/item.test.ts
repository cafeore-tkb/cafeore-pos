import { beforeAll, describe, expect, test } from "vitest";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { Firestore } from "firebase/firestore";
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
    itemRepository = itemRepoFactory(testDB);
  });

  test("itemRepository is defined", () => {
    expect(itemRepository).toBeDefined();
  });

  test("itemRepository.save (create)", async () => {
    const item = ItemEntity.createNew({
      name: "Hoge",
      price: 100,
      type: "hot",
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
      name: "Fuga",
      price: 200,
      type: "ice",
    });
    const savedItem = await itemRepository.save(item);
    const foundItem = await itemRepository.findById(savedItem.id);
    expect(foundItem).toEqual(savedItem);
  });

  test("itemRepository.findAll", async () => {
    const item = ItemEntity.createNew({
      name: "Foo",
      price: 300,
      type: "hotOre",
    });
    const savedItem = await itemRepository.save(item);
    const items = await itemRepository.findAll();
    expect(items).toContainEqual(savedItem);
  });

  test("itemRepository.delete", async () => {
    const item = ItemEntity.createNew({
      name: "Bar",
      price: 400,
      type: "milk",
    });
    const savedItem = await itemRepository.save(item);
    await itemRepository.delete(savedItem.id);
    const foundItem = await itemRepository.findById(savedItem.id);
    expect(foundItem).toBeNull();
  });
});
