import { Eye, LoaderCircle, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { useMasterSheetTab } from "../hooks/useMasterSheetTab";

/** 所有権を確認するまで、操作用Provider・自動処理・フォームをマウントしない。 */
export const MasterSheetTabGuard = ({ children }: { children: ReactNode }) => {
  const { state, retry } = useMasterSheetTab();
  const location = useLocation();
  if (state === "active") return children;
  if (state === "duplicate" || state === "legacy") {
    return (
      <Navigate
        to="/master-sheet/view?from=duplicate-master"
        replace
        state={{
          caosDuplicate: state,
          caosTakeoverBlocked: location.state?.caosTakeover === true,
        }}
      />
    );
  }

  const checking = state === "checking";
  const Icon = checking ? LoaderCircle : ShieldAlert;
  const title = checking
    ? "マスターシートを確認しています"
    : "操作するタブを確認できませんでした";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f0f4fa] p-6 font-sans text-[#0f172a]">
      <section
        aria-labelledby="master-tab-title"
        aria-busy={checking}
        className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <p className="mb-5 font-bold text-slate-500 text-sm tracking-widest">
          CaOS
        </p>
        <Icon
          aria-hidden="true"
          className={`mb-4 size-8 text-slate-600 ${checking ? "motion-safe:animate-spin" : ""}`}
        />
        <h1 id="master-tab-title" className="font-bold text-xl sm:text-2xl">
          {title}
        </h1>
        <div
          aria-live="polite"
          className="mt-4 space-y-3 text-base text-slate-600"
        >
          {checking ? (
            <p>そのままお待ちください。</p>
          ) : state === "unsupported" ? (
            <p>
              このブラウザーではタブの重複を確認できません。最新のSafariまたはChromeで開いてください。閲覧専用画面は利用できます。
            </p>
          ) : (
            <p>
              少し待って「もう一度確認」を押してください。確認できるまで操作は始まりません。
            </p>
          )}
        </div>
        {!checking && (
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/master-sheet/view"
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 font-bold text-base text-white hover:bg-slate-700"
            >
              <Eye className="size-5" aria-hidden="true" />
              閲覧専用で開く
            </Link>
            {state !== "unsupported" && (
              <button
                type="button"
                onClick={retry}
                className="min-h-12 rounded-xl border border-slate-300 px-5 py-3 font-bold text-base text-slate-700 hover:bg-slate-50"
              >
                もう一度確認
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
};
