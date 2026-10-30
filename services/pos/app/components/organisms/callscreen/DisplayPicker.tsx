import { MonitorUp } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import {
  type WindowBounds,
  currentScreenBounds,
} from "~/lib/callscreen-window";
import {
  type ScreenDetailed,
  pickTargetScreen,
  screenName,
  useScreenDetails,
} from "~/lib/screens";

/**
 * 呼び出し画面を出す先のディスプレイを選び、呼び出し画面の窓をそこいっぱいに開く（lib/callscreen-window）。
 * 画面を選べる（Window Management API の）ブラウザでは、つないでいる画面を並べて選ばせる。
 * 選べないブラウザ・外部ディスプレイが無いときは、今の画面に開く（外部ディスプレイへは手で動かす）
 */
export function DisplayPicker({
  open,
  soundReady,
  onShow,
  onClose,
}: {
  /** 呼び出し画面の窓が開いているか */
  open: boolean;
  /** 呼び出し画面の窓で音を鳴らせるか */
  soundReady: boolean;
  onShow: (bounds: WindowBounds) => void;
  onClose: () => void;
}) {
  const {
    supported,
    extended,
    permission,
    screens,
    currentScreen,
    failed,
    request,
  } = useScreenDetails();
  const [selected, setSelected] = useState<ScreenDetailed | null>(null);
  const verb = open ? "移す" : "出す";

  let body: React.ReactNode;
  if (screens && currentScreen) {
    // 選んだ画面を外したら、既定に戻す
    const target =
      selected && screens.includes(selected)
        ? selected
        : pickTargetScreen(screens, currentScreen);
    const targetIndex = screens.indexOf(target);
    body = (
      <>
        <RadioGroup
          value={String(targetIndex)}
          onValueChange={(value) => setSelected(screens[Number(value)] ?? null)}
          className="gap-3"
        >
          {screens.map((screen, index) => (
            <div
              key={`${index}:${screen.label}`}
              className="flex items-center gap-3"
            >
              <RadioGroupItem id={`screen-${index}`} value={String(index)} />
              <Label
                htmlFor={`screen-${index}`}
                className="flex flex-wrap items-center gap-2"
              >
                <span>{screenName(screen, index)}</span>
                <span className="font-normal text-muted-foreground text-xs tabular-nums">
                  {screen.width}×{screen.height}
                </span>
                {screen === currentScreen && <Tag>この窓のある画面</Tag>}
                {screen.isInternal && <Tag>本体の画面</Tag>}
              </Label>
            </div>
          ))}
        </RadioGroup>
        {screens.length < 2 && <NotExtended />}
        <div>
          <Button onClick={() => onShow(target)}>
            <MonitorUp className="mr-2 h-4 w-4" aria-hidden="true" />
            {screenName(target, targetIndex)}に{verb}
          </Button>
        </div>
      </>
    );
  } else if (supported && extended) {
    body =
      permission === "denied" || failed ? (
        <>
          <p className="text-red-700 text-sm">
            ブラウザが「ウィンドウの管理」を許可していないので、出す先を選べません。アドレスバーの左のアイコン（サイトの情報）から許可してください。
          </p>
          <ThisScreenButton verb={verb} onShow={onShow} />
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            初めて押すと、ブラウザが「ウィンドウの管理」の許可を聞きます。許可すると、つないでいるディスプレイから出す先を選べます。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void request()}>ディスプレイを調べる</Button>
            <ThisScreenButton verb={verb} onShow={onShow} />
          </div>
        </>
      );
  } else if (supported) {
    body = (
      <>
        <NotExtended />
        <ThisScreenButton verb={verb} onShow={onShow} />
      </>
    );
  } else {
    body = (
      <>
        <p className="text-muted-foreground text-sm">
          このブラウザは出す先のディスプレイを選べません（PC 版の Chrome・Edge
          なら選べます）。開いた窓を外部ディスプレイへ動かして、広げてください。
        </p>
        <ThisScreenButton verb={verb} onShow={onShow} />
      </>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="space-y-1">
        <h2 className="font-semibold text-lg">外部ディスプレイに出す</h2>
        <p className="text-muted-foreground text-sm">
          呼び出し画面を新しい窓で開き、選んだディスプレイいっぱいに広げます。この設定の画面はこのタブに残るので、出している間も
          CM と音を変えられます。窓の枠を消すには、呼び出し画面の窓で F11（Mac
          は ⌃⌘F）を押してください。
        </p>
      </div>
      {open && (
        <div className="space-y-2 rounded-md bg-emerald-50 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-emerald-600 px-2 py-0.5 font-medium text-white text-xs">
              表示中
            </span>
            <p className="text-sm">呼び出し画面の窓を開いています</p>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={onClose}
            >
              窓を閉じる
            </Button>
          </div>
          {!soundReady && (
            <p className="font-semibold text-amber-800 text-sm">
              まだ音が鳴りません。外部ディスプレイの呼び出し画面を一度クリックしてください（ブラウザは、その窓をクリックするまで音を鳴らさせません）。続けてその窓で
              F11（Mac は ⌃⌘F）を押すと、窓の枠が消えます。
            </p>
          )}
        </div>
      )}
      {body}
    </section>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-stone-300 px-2 py-px font-normal text-stone-700 text-xs">
      {children}
    </span>
  );
}

function NotExtended() {
  return (
    <p className="text-muted-foreground text-sm">
      外部ディスプレイが見つかりません。つないで、OS
      の設定で「拡張」にしてください（「ミラー」では 1
      つの画面として扱われます）。
    </p>
  );
}

function ThisScreenButton({
  verb,
  onShow,
}: {
  verb: string;
  onShow: (bounds: WindowBounds) => void;
}) {
  return (
    <Button variant="outline" onClick={() => onShow(currentScreenBounds())}>
      この画面に{verb}
    </Button>
  );
}
