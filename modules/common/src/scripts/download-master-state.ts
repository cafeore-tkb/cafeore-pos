import fs from "node:fs";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { getMasterState } from "../data/masterState";

dayjs.extend(utc);
dayjs.extend(timezone);

// API の /api/master-status からオーダーストップの履歴を落とす。
// VITE_API_BASE_URL で接続先を指定する（未設定なら localhost:8080）。
const orderStats = await getMasterState();

const getJST = (date: string) => dayjs(date).tz("Asia/Tokyo");

const sohosaiData = orderStats.filter(({ createdAt }) =>
  getJST(createdAt).isAfter(dayjs("2024-11-03 10:00").tz()),
);

if (sohosaiData.length === 0) {
  console.log("該当するオーダーストップの記録が無い");
} else {
  console.log(
    getJST(sohosaiData[0].createdAt),
    getJST(sohosaiData[sohosaiData.length - 1].createdAt),
  );
}

fs.writeFileSync("order_stops.json", JSON.stringify(sohosaiData, null, 2));
