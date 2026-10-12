import { useEffect, useRef } from "react";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";
import { useCaosLanes } from "./useCaosLanes";

// sohosai-shift の予定を読み直したら（定期・手動・合言葉を入れたとき。読めたときだけ）、今の担当者の上級生かを新しい名簿に合わせる
// （CaosLanesProvider の syncSeniors）。読み直し 1 回につき 1 回だけで、担当者が変わっただけでは合わせない（名簿の違う端末どうしで書き合わないように）。
// 担当者がまだ届いていなければ、届いてから合わせる。実データテスト中（paused）は書かず、終えてから合わせる。
export const useSeniorRefresh = (paused: boolean) => {
  const { caosLanes } = useOrdersWSContext();
  const { shiftFeed, syncSeniors } = useCaosLanes();
  const { fetchedAt } = shiftFeed;
  const arrived = caosLanes !== null;
  const synced = useRef<number | null>(null);
  const sync = useRef(syncSeniors);
  sync.current = syncSeniors;

  useEffect(() => {
    if (paused || !arrived || fetchedAt === null) return;
    if (synced.current === fetchedAt) return;
    synced.current = fetchedAt;
    sync.current();
  }, [paused, arrived, fetchedAt]);
};
