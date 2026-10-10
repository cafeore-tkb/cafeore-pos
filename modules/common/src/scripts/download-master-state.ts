import fs from "node:fs";
import { getMasterState } from "../data/masterState";

// オーダーストップの記録は API にある（古い順で返る）
const orderStats = await getMasterState();

fs.writeFileSync("order_stops.json", JSON.stringify(orderStats, null, 2));
