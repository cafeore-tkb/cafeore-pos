import { toast } from "sonner";

const METHODS = ["カード", "QR コード"] as const;

/**
 * Square 端末を用意できないお試し環境で、決済手段の見た目だけを確認するための表示。
 * 実際の決済処理には接続せず、押したときはそのことを明示する。
 */
export const SquareDemoMethods = () => {
  const notifyDemo = (method: (typeof METHODS)[number]) => {
    toast(`${method}は見た目確認用です。Square決済は実行されません。`);
  };

  return (
    <>
      {METHODS.map((method) => (
        <button
          key={method}
          type="button"
          onClick={() => notifyDemo(method)}
          className="relative h-12 whitespace-nowrap rounded-lg border-2 border-theme-primary bg-theme-primary p-0 font-extrabold text-[13.5px] text-white tracking-[-.03em] disabled:cursor-not-allowed"
        >
          {method}
        </button>
      ))}
    </>
  );
};
