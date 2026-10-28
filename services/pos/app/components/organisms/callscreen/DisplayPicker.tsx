import { MonitorUp } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import {
  type ScreenDetailed,
  pickCompanionScreen,
  pickTargetScreen,
  screenName,
  useScreenDetails,
} from "~/lib/screens";

/** どこに出すか */
export type PresentChoice = {
  /** 全画面にする画面。null なら今の画面 */
  target: ScreenDetailed | null;
  /** 設定の画面を小窓で開く画面。null なら開かない */
  companion: ScreenDetailed | null;
  /** 出す画面の名前（小窓に出す） */
  name: string;
};

const THIS_SCREEN: PresentChoice = {
  target: null,
  companion: null,
  name: "この画面",
};

/**
 * 呼び出し画面を出す先のディスプレイを選び、全画面で出す。
 * 画面を選べる（Window Management API の）ブラウザでは、つないでいる画面を並べて選ばせる。
 * 選べないブラウザ・外部ディスプレイが無いときは、今の画面で全画面にする
 */
export function DisplayPicker({
  onPresent,
}: {
  onPresent: (choice: PresentChoice) => void;
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

  let body: React.ReactNode;
  if (!document.fullscreenEnabled) {
    body = (
      <p className="text-red-700 text-sm">
        このブラウザでは全画面にできません。PC 版の Chrome・Edge
        で開いてください。
      </p>
    );
  } else if (screens && currentScreen) {
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
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() =>
              onPresent({
                target,
                companion: pickCompanionScreen(screens, target, currentScreen),
                name: screenName(target, targetIndex),
              })
            }
          >
            <MonitorUp className="mr-2 h-4 w-4" aria-hidden="true" />
            {screenName(target, targetIndex)}に全画面で出す
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
          <ThisScreenButton onPresent={onPresent} />
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            初めて押すと、ブラウザが「ウィンドウの管理」の許可を聞きます。許可すると、つないでいるディスプレイから出す先を選べます。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void request()}>ディスプレイを調べる</Button>
            <ThisScreenButton onPresent={onPresent} />
          </div>
        </>
      );
  } else if (supported) {
    body = (
      <>
        <NotExtended />
        <ThisScreenButton onPresent={onPresent} />
      </>
    );
  } else {
    body = (
      <>
        <p className="text-muted-foreground text-sm">
          このブラウザは出す先のディスプレイを選べません（PC 版の Chrome・Edge
          なら選べます）。このウィンドウを外部ディスプレイへ動かしてから押してください。
        </p>
        <ThisScreenButton onPresent={onPresent} />
      </>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="space-y-1">
        <h2 className="font-semibold text-lg">外部ディスプレイに出す</h2>
        <p className="text-muted-foreground text-sm">
          呼び出し画面を選んだディスプレイに全画面で出します。手元の画面には、この設定の画面を小窓で開きます（PC
          版の
          Chrome・Edge）。表示をやめるときは、小窓の「表示をやめる」を押すか、外部ディスプレイの側で
          Esc を押します。
        </p>
      </div>
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
  onPresent,
}: {
  onPresent: (choice: PresentChoice) => void;
}) {
  return (
    <Button variant="outline" onClick={() => onPresent(THIS_SCREEN)}>
      この画面で全画面にする
    </Button>
  );
}
