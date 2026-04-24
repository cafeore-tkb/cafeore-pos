import { useMasterState } from "@cafeore/common";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/utils";

const formatMasterStateDate = (value: string) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");

  return `${mm}/${dd} ${hh}:${min}:${ss}`;
};

/**
 * ダッシュボードでオーダーストップの記録を表示するコンポーネント
 */
export function OrderStatusList() {
  const { masterStates, isLoading, error } = useMasterState();

  if (isLoading) return <div>読み込み中...</div>;
  if (error) return <div>取得失敗</div>;
  console.log(masterStates);

  return (
    <div className="h-162.5 w-1/2 overflow-auto">
      <Table>
        <TableHeader
          className={cn("sticky top-0 z-10 bg-background [&_tr]:border-b")}
        >
          <TableRow>
            <TableHead>時刻</TableHead>
            <TableHead>状態</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {masterStates
            ?.slice()
            .reverse()
            .map((state) => (
              <TableRow key={state.createdAt}>
                <TableCell className="font-medium">
                  {formatMasterStateDate(state.createdAt)}
                </TableCell>
                <TableCell>
                  {state.type === "stop"
                    ? "中止"
                    : state.type === "operational"
                      ? "再開"
                      : ""}
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
  );
}
