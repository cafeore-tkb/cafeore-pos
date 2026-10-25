import { type SquareDevice, squareRepository } from "@cafeore/common";
import { useState } from "react";
import type { MetaFunction } from "react-router";
import { toast } from "sonner";
import useSWR from "swr";
import { AdminPageHeader } from "~/components/molecules/AdminPageHeader";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

export const meta: MetaFunction = () => {
  return [{ title: "Square 端末 / 珈琲・俺POS" }];
};

/** ペアリング待ちのコードがある間、一覧を取り直す間隔 */
const PAIRING_POLL_MS = 3000;

const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
});

const statusLabel: Record<SquareDevice["status"], string> = {
  UNPAIRED: "ペアリング待ち",
  PAIRED: "ペアリング済み",
  EXPIRED: "期限切れ",
};

const errorText = (e: unknown, fallback: string) =>
  e instanceof Error ? e.message : fallback;

export default function SquareDevicesPage() {
  const { data: status } = useSWR("square-status", squareRepository.getStatus);
  const {
    data: devices,
    error,
    mutate,
  } = useSWR("square-devices", squareRepository.listDevices, {
    // 端末でコードを入力するまで、サーバー経由で Square に問い合わせ続ける。
    // コードはペアリング待ちの行と、ペアリング済みの端末に発行し直した行にだけ入る
    refreshInterval: (latest) =>
      latest?.some((device) => device.code) ? PAIRING_POLL_MS : 0,
  });
  const enabled = status?.enabled ?? false;
  const refresh = () => void mutate();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-6">
      <AdminPageHeader
        group="settings"
        title="Square 端末"
        description="レジから決済画面を出す Square Terminal を登録します。どのレジでどの端末を使うかは、各レジの画面右上で選びます。"
      >
        {status && (
          <p className="text-sm">
            接続先: <span className="font-mono">{status.environment}</span>
          </p>
        )}
      </AdminPageHeader>

      {status && !enabled && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-red-700 text-sm">
          SQUARE_ACCESS_TOKEN が設定されていないため、Square
          連携は無効です。コードの発行と取り込みはできません。
        </p>
      )}

      <PairSection enabled={enabled} onIssued={refresh} />
      <DevicesSection devices={devices} error={error} onChanged={refresh} />
      <ImportSection enabled={enabled} onImported={refresh} />
      <RegisterSection onRegistered={refresh} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// コードを発行する

function PairSection({
  enabled,
  onIssued,
}: {
  enabled: boolean;
  onIssued: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const issue = async () => {
    if (!name.trim()) {
      toast("名前を入力してください");
      return;
    }
    try {
      setBusy(true);
      const device = await squareRepository.pairDevice(name.trim());
      toast(`${device.name} のコードを発行しました`);
      setName("");
      onIssued();
    } catch (e) {
      toast(errorText(e, "コードを発行できませんでした"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="space-y-1">
        <h2 className="font-bold text-xl">端末を追加する</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>名前（例 レジ2）を入れて「コードを発行」を押す</li>
          <li>
            端末のサインイン画面で「デバイスコードでサインイン」を選び、下の一覧に出たコードを入力する
          </li>
          <li>
            しばらくすると一覧で「ペアリング済み」になる。使うレジの画面右上でその端末を選ぶ
          </li>
        </ol>
        <p className="text-muted-foreground text-xs">
          Square
          のダッシュボードで発行したコードではペアリングできません。端末が別のアカウントやモードでサインインしているときは、先にサインアウトしてください。
        </p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void issue();
        }}
      >
        <Input
          className="max-w-xs"
          value={name}
          placeholder="レジ2"
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={!enabled || busy}>
          コードを発行
        </Button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 一覧

function DevicesSection({
  devices,
  error,
  onChanged,
}: {
  devices: SquareDevice[] | undefined;
  error: unknown;
  onChanged: () => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="space-y-1">
        <h2 className="font-bold text-xl">登録した端末</h2>
        <p className="text-muted-foreground text-sm">
          ペアリング済みの端末がサインアウトしたら（サインイン画面に戻ったら）、その行の「コードを発行」を押し、出たコードを端末で入力します。同じ端末ならレジで選び直す必要はありません。発行しただけでは端末はサインアウトせず、入力するまでも今のまま決済に使えます。
        </p>
      </div>
      {error ? (
        <p className="text-red-700 text-sm">
          {errorText(error, "一覧を取得できません")}
        </p>
      ) : devices === undefined ? (
        <p className="text-muted-foreground text-sm">読み込み中…</p>
      ) : devices.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          まだ端末がありません。上でコードを発行するか、下で取り込んでください。
        </p>
      ) : (
        // 狭い画面では表だけを横にスクロールさせる（ページごと横にはみ出さない）
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名前</TableHead>
                <TableHead className="w-32">状態</TableHead>
                <TableHead>コード / device_id</TableHead>
                <TableHead className="w-24">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((device) => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  onChanged={onChanged}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function DeviceRow({
  device,
  onChanged,
}: {
  device: SquareDevice;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    const message =
      device.status === "PAIRED"
        ? `${device.name} を一覧から外しますか？\nレジで選べなくなります。端末は Square にサインインしたままなので、使わないなら端末でサインアウトしてください。`
        : `${device.name} を一覧から外しますか？`;
    if (!window.confirm(message)) return;
    try {
      setBusy(true);
      await squareRepository.deleteDevice(device.id);
      onChanged();
    } catch (e) {
      toast(errorText(e, "外せませんでした"));
    } finally {
      setBusy(false);
    }
  };

  const issueCode = async () => {
    try {
      setBusy(true);
      await squareRepository.issueDeviceCode(device.id);
      toast(`${device.name} のコードを発行しました`);
      onChanged();
    } catch (e) {
      toast(errorText(e, "コードを発行できませんでした"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TableRow>
      <TableCell className="font-bold">{device.name}</TableCell>
      <TableCell className="whitespace-nowrap">
        {statusLabel[device.status]}
        {device.status === "PAIRED" && device.code && (
          <div className="text-muted-foreground text-xs">コードの入力待ち</div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          {device.code && (
            <div>
              <div className="font-bold font-mono text-3xl tracking-widest">
                {device.code}
              </div>
              {device.pair_by && (
                <div className="text-muted-foreground text-xs">
                  {timeFormat.format(new Date(device.pair_by))}{" "}
                  まで有効。端末で入力してください
                </div>
              )}
            </div>
          )}
          {device.status === "PAIRED" && (
            <span className="break-all font-mono text-xs">
              {device.device_id}
            </span>
          )}
          {device.status === "EXPIRED" && (
            <span className="text-muted-foreground text-sm">
              外してから発行し直してください
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-2">
          {device.status === "PAIRED" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void issueCode()}
            >
              コードを発行
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => void remove()}
          >
            外す
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Square から取り込む

function ImportSection({
  enabled,
  onImported,
}: {
  enabled: boolean;
  onImported: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const runImport = async () => {
    try {
      setBusy(true);
      const imported = await squareRepository.importDevices();
      toast(
        imported.length === 0
          ? "取り込む端末はありませんでした"
          : `${imported.map((device) => device.name).join("、")} を取り込みました`,
      );
      onImported();
    } catch (e) {
      toast(errorText(e, "取り込めませんでした"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="space-y-1">
        <h2 className="font-bold text-xl">Square から取り込む</h2>
        <p className="text-muted-foreground text-sm">
          Square
          でペアリング済みの端末のうち、この一覧に無いものを取り込みます。以前のコマンド（cmd/square-pair）でペアリングした端末や、一覧から外した端末を戻すときに使います。
        </p>
      </div>
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={!enabled || busy}
          onClick={() => void runImport()}
        >
          ペアリング済みの端末を取り込む
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// device_id を直接登録する

function RegisterSection({ onRegistered }: { onRegistered: () => void }) {
  const [name, setName] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [busy, setBusy] = useState(false);

  const register = async () => {
    if (!name.trim() || !deviceId.trim()) {
      toast("名前と device_id を入力してください");
      return;
    }
    try {
      setBusy(true);
      const device = await squareRepository.registerDevice({
        name: name.trim(),
        deviceId: deviceId.trim(),
      });
      toast(`${device.name} を登録しました`);
      setName("");
      setDeviceId("");
      onRegistered();
    } catch (e) {
      toast(errorText(e, "登録できませんでした"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="space-y-1">
        <h2 className="font-bold text-xl">device_id を直接登録する</h2>
        <p className="text-muted-foreground text-sm">
          ペアリングせずに device_id を登録します。Sandbox
          では実機とペアリングできないので、Square が用意しているテスト用の
          device_id（README を参照）を登録して動作を確かめます。
        </p>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void register();
        }}
      >
        <Input
          className="max-w-xs"
          value={name}
          placeholder="名前"
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          className="max-w-sm font-mono"
          value={deviceId}
          placeholder="device_id"
          maxLength={255}
          onChange={(e) => setDeviceId(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={busy}>
          登録
        </Button>
      </form>
    </section>
  );
}
