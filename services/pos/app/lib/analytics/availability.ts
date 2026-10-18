import { z } from "zod";
import type { FlowBucket } from "./operations";
const observation = z.object({
  at: z.string().datetime({ offset: true }),
  availableMenus: z.number().int().nonnegative(),
});
/** 販売終了/品切れ/切替の確定時点の販売可能数。履歴のない時間へ現在値を遡及しない。 */
export const availabilitySchema = z.array(observation).min(1);
export type AvailabilityObservation = z.infer<typeof observation>;
export const availabilityComparison = (
  input: AvailabilityObservation[],
  buckets: FlowBucket[],
) => {
  const observations = [
    ...new Map(input.map((v) => [Date.parse(v.at), v])).values(),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return buckets
    .filter((b) => b.complete)
    .map((bucket) => {
      let count: number | null = null;
      let cursor = bucket.at;
      let exposure = 0;
      for (const point of observations) {
        const at = Date.parse(point.at);
        if (at <= bucket.at) {
          count = point.availableMenus;
          continue;
        }
        if (at >= bucket.at + 900_000) break;
        if (count === null) return { ...bucket, availableMenus: null };
        exposure += (at - cursor) * count;
        cursor = at;
        count = point.availableMenus;
      }
      return {
        ...bucket,
        availableMenus:
          count === null
            ? null
            : (exposure + (bucket.at + 900_000 - cursor) * count) / 900_000,
      };
    });
};
