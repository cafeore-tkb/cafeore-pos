import type { ReactNode } from "react";
import {
  type OrderIdRange,
  countOrderIds,
  formatOrderIdRange,
} from "../functional/missingOrderIds";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

type Props = {
  /** 廃棄する引換券の番号。空なら出さない */
  ranges: readonly OrderIdRange[];
  /** なぜ廃棄するか（番号の上に出す） */
  description: ReactNode;
  /** 番号の下に出す注意 */
  note?: ReactNode;
  /** 「廃棄しました」を押した */
  onClose: () => void;
};

/**
 * 廃棄する引換券の番号を案内するダイアログ。注文の無い番号の引換券を使わないよう、
 * 「廃棄しました」を押すまで閉じない（Esc・外側のクリックでは閉じない）
 */
export const DiscardCouponDialog = ({
  ranges,
  description,
  note,
  onClose,
}: Props) => (
  <AlertDialog open={ranges.length > 0}>
    <AlertDialogContent
      // Esc で閉じない。レジ画面は Esc で入力中の注文を消すので、レジにも渡さない
      onEscapeKeyDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <AlertDialogHeader>
        <AlertDialogTitle>
          引換券 {countOrderIds(ranges)} 枚を廃棄してください
        </AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="space-y-3">
            <p>{description}</p>
            <ul className="flex flex-wrap gap-2">
              {ranges.map((range) => (
                <li
                  key={range.start}
                  className="rounded-lg bg-red-50 px-3 py-1.5 font-black text-2xl text-red-700 tabular-nums"
                >
                  {formatOrderIdRange(range)}
                </li>
              ))}
            </ul>
            {note && <p className="text-xs">{note}</p>}
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogAction onClick={onClose}>廃棄しました</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
