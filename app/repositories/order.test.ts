import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { beforeAll, describe, expect, test } from "bun:test";
import type { Firestore } from "firebase/firestore";
import firebasejson from "~/../firebase.json";
import type { WithId } from "~/lib/typeguard";
import { OrderEntity } from "~/models/order";
import { orderRepoFactory } from "./order";
import type { OrderRepository } from "./type";

const isEmulatorRunning = async (): Promise<boolean> => {
  try {
    const res = await fetch(
      `http://localhost:${firebasejson.emulators.firestore.port}`,
    );
    return res.ok;
  } catch (e) {
    return false;
  }
};

describe("[db] orderRepository", async () => {
  // To use this environment, firebase emulator must be running.

  let savedOrderHoge: WithId<OrderEntity>;
  let orderRepository: OrderRepository;

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
    orderRepository = orderRepoFactory(testDB);
    if (!(await isEmulatorRunning())) {
      console.log("Emulator is not running");
    }
  });

  test("orderRepository is defined", () => {
    expect(orderRepository).toBeDefined();
  });

  test("orderRepository.save (create)", async () => {
    const order = OrderEntity.createNew({ orderId: 2024 });
    savedOrderHoge = await orderRepository.save(order);
    expect(savedOrderHoge.id).toBeDefined();
  });

  test("orderRepository.save (update)", async () => {
    savedOrderHoge.assignee = "hoge";
    const savedOrder = await orderRepository.save(savedOrderHoge);
    expect(savedOrder.id).toEqual(savedOrderHoge.id);
    expect(savedOrder.assignee).toEqual("hoge");
  });

  test("orderRepository.findById", async () => {
    const order = OrderEntity.createNew({ orderId: 2025 });
    const savedOrder = await orderRepository.save(order);
    const foundOrder = await orderRepository.findById(savedOrder.id);
    expect(foundOrder).toEqual(savedOrder);
  });

  test("orderRepository.findAll", async () => {
    const order = OrderEntity.createNew({ orderId: 2026 });
    const savedOrder = await orderRepository.save(order);
    const orders = await orderRepository.findAll();
    expect(orders).toContainEqual(savedOrder);
  });

  test("orderRepository.delete", async () => {
    const order = OrderEntity.createNew({ orderId: 2027 });
    const savedOrder = await orderRepository.save(order);
    await orderRepository.delete(savedOrder.id);
    const foundOrder = await orderRepository.findById(savedOrder.id);
    expect(foundOrder).toBeNull();
  });
});
