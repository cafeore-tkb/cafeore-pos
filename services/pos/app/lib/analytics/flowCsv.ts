import { jstClock, jstDate } from "@cafeore/common";
import type { BucketMinutes, FlowBucket } from "./operations";

/** 既存の8列は順番を変えず、新しい情報は末尾へ追加する。 */
export const flowCsv = (
  buckets: FlowBucket[],
  intervalMinutes: BucketMinutes,
) =>
  [
    "日時(JST),受注杯数,提供杯数,未提供杯数,キャンセル未提供杯数,未提供増減,混み合い加速度,枠確定,集計間隔(分)",
    ...buckets.map((b) =>
      [
        `${jstDate(b.at)} ${jstClock(b.at)}`,
        b.received,
        b.served,
        b.backlog,
        b.cancelled,
        b.net,
        b.acceleration ?? "",
        b.complete ? "確定" : "途中",
        intervalMinutes,
      ].join(","),
    ),
  ].join("\n");
