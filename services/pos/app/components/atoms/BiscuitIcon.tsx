/** 提供時に添えるお菓子のアイコン。 */
export function BiscuitIcon({ className }: { className?: string }) {
  return (
    <img
      src="/images/lotus.svg"
      alt=""
      aria-hidden="true"
      className={className}
    />
  );
}
