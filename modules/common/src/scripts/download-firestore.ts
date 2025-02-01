import * as fs from "fs";
import { orderRepository } from "../repositories/order";

const orderEntities = await orderRepository.findAll();
const orders = orderEntities.map((order) => order.toOrder());

const output = { orders };

fs.writeFileSync("orders.json", JSON.stringify(output, null, 2));
