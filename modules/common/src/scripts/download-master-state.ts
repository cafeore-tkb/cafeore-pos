import fs from "node:fs";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { masterRepository } from "../repositories/global";

dayjs.extend(utc);
dayjs.extend(timezone);

const masterStateEntity = await masterRepository.get();
const orderStats = masterStateEntity?.orderStats ?? [];

const getJST = (date: Date) => dayjs(date).tz("Asia/Tokyo");

const sohosaiData = orderStats.filter(({ createdAt }) =>
  getJST(createdAt).isAfter(dayjs("2024-11-03 10:00").tz()),
);

console.log(
  getJST(sohosaiData[0].createdAt),
  getJST(sohosaiData[sohosaiData.length - 1].createdAt),
);

fs.writeFileSync("order_stops.json", JSON.stringify(sohosaiData, null, 2));
