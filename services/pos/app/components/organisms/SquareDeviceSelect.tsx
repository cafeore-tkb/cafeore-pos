import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import type { PairedSquareDevice } from "../functional/useSquareDevice";
import { Button } from "../ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";

type Props = {
  /** 選べる端末（ペアリング済みのもの） */
  devices: PairedSquareDevice[];
  /** このレジで使っている端末 */
  device: PairedSquareDevice | null;
  /** 選んでいた端末が一覧から外されている */
  missing: boolean;
  onSelect: (deviceId: string) => void;
  /** 決済中は切り替えない（出した端末と画面の表示がずれる） */
  disabled: boolean;
};

/**
 * このレジで使う Square 端末を選ぶ
 *
 * 選んだ端末はブラウザに覚えるので、決済のたびには選ばない。
 * 選んでいない（端末が複数ある）・選んでいた端末が外されたときは目立たせる。
 */
export const SquareDeviceSelect = ({
  devices,
  device,
  missing,
  onSelect,
  disabled,
}: Props) => {
  const [open, setOpen] = useState(false);

  if (devices.length === 0 && !missing) {
    return <div className="text-sm text-stone-400">Square 端末未登録</div>;
  }

  const trigger =
    device !== null ? (
      <Button
        variant="ghost"
        className="h-8 px-2 text-stone-500"
        disabled={disabled}
      >
        Square: {device.name}
      </Button>
    ) : (
      <Button
        variant={missing ? "destructive" : "outline"}
        className="h-8 gap-1 px-3"
        disabled={disabled}
      >
        <ExclamationTriangleIcon />
        {missing
          ? "Square 端末を選び直してください"
          : "Square 端末を選んでください"}
      </Button>
    );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        className="overflow-y-auto"
        // レジ画面は Esc で入力中の注文を消す。シートを閉じるだけの Esc で消さない
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        <SheetHeader>
          <SheetTitle>このレジで使う Square 端末</SheetTitle>
          <SheetDescription>
            選んだ端末はこのブラウザに覚えます。決済画面はここで選んだ端末に出ます。端末の追加は
            Square 端末の管理画面（/square-devices）で行います。
          </SheetDescription>
        </SheetHeader>
        {missing && (
          <p className="mt-4 text-red-600 text-sm">
            使っていた端末が一覧から外されました。このレジの横にある端末を選んでください。
          </p>
        )}
        <ul className="mt-4 space-y-2">
          {devices.map((candidate) => {
            const current = candidate.device_id === device?.device_id;
            return (
              <li key={candidate.id}>
                <Button
                  variant={current ? "default" : "outline"}
                  className="h-auto w-full flex-col items-start gap-0 py-2"
                  onClick={() => {
                    onSelect(candidate.device_id);
                    setOpen(false);
                  }}
                >
                  <span className="font-bold">
                    {candidate.name}
                    {current && "（使用中）"}
                  </span>
                  <span className="font-mono text-xs opacity-70">
                    {candidate.device_id}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
};
