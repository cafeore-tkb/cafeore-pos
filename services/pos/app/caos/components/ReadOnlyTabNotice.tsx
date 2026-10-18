import { Eye } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";

/** 重複タブは閲覧を続けてもらい、必要なときだけ操作タブへ引き継ぐ。 */
export const ReadOnlyTabNotice = () => {
  const [params] = useSearchParams();
  const location = useLocation();
  const blocked = location.state?.caosTakeoverBlocked === true;
  const [expanded, setExpanded] = useState(blocked);
  if (params.get("from") !== "duplicate-master") return null;

  return (
    <section
      aria-label="閲覧専用と操作の引き継ぎ"
      className="shrink-0 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sky-950"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Eye aria-hidden="true" className="size-5 shrink-0" />
        <p className="min-w-0 flex-1 text-sm sm:text-base">
          別のタブで操作中のため、このタブは閲覧専用で開きました。
        </p>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="master-tab-handoff"
          onClick={() => setExpanded((current) => !current)}
          className="min-h-11 rounded-lg border border-sky-300 bg-white px-4 py-2 font-bold text-sm hover:bg-sky-100"
        >
          {expanded ? "閲覧を続ける" : "このタブで操作したい"}
        </button>
      </div>
      {expanded && (
        <div
          id="master-tab-handoff"
          className="mt-3 space-y-3 border-sky-200 border-t pt-3 text-sm sm:text-base"
        >
          {blocked && (
            <p aria-live="polite" className="font-bold text-amber-900">
              元のタブがまだ開いているため、引き継げませんでした。
            </p>
          )}
          <p>
            元のタブの保存待ちがなくなったことを確認してから閉じ、下のボタンを押してください。
            未送信の操作が残っている場合は、元のタブを閉じずに担当者へ確認してください。
          </p>
          <Link
            to="/master-sheet"
            state={{ caosTakeover: true }}
            className="inline-flex min-h-12 items-center rounded-lg bg-slate-900 px-5 py-3 font-bold text-white hover:bg-slate-700"
          >
            操作を引き継ぐ
          </Link>
        </div>
      )}
    </section>
  );
};
