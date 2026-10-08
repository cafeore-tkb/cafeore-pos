import { usePrintStation } from "~/label/PrintStation";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { PrinterStatus } from "./PrinterStatus";

/**
 * 「この端末で印刷する」の切り替えと、プリンターの接続状態。
 * 印刷にした端末だけがプリンターにつなぎ、レジ・マスター・CaOS が積んだ印刷キューを順に印刷する（端末ごとの設定）
 */
export const PrintStationControl = () => {
  const { enabled, setEnabled, printerStatus, reconnect } = usePrintStation();
  return (
    <div className="flex items-center gap-2">
      <Switch
        id="print-station"
        checked={enabled}
        onCheckedChange={setEnabled}
      />
      <Label htmlFor="print-station">この端末で印刷する</Label>
      {enabled && printerStatus && <PrinterStatus status={printerStatus} />}
      {enabled && printerStatus === "disconnected" && (
        <Button type="button" size="sm" variant="outline" onClick={reconnect}>
          再接続
        </Button>
      )}
    </div>
  );
};
