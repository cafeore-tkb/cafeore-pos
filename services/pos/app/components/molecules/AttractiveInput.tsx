import {
  type ChangeEventHandler,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useFocusRef } from "../functional/useFocusRef";
import { Input, type InputProps } from "../ui/input";

type props = InputProps & {
  onTextSet: (text: string) => void;
  focus: boolean;
};

/**
 * focus が true のときに自動でフォーカスを当てる input
 */
const AttractiveInput = ({ focus, onTextSet, ...props }: props) => {
  const [text, setText] = useState("");
  const DOMRef = useFocusRef<HTMLInputElement>(focus);

  const onChangeHandler: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setText(event.target.value),
    [],
  );

  /**
   * FIXME #412 stateの更新にはuseEffectを使わない
   * https://ja.react.dev/learn/you-might-not-need-an-effect#notifying-parent-components-about-state-changes
   */
  useEffect(() => {
    onTextSet(text);
  }, [text, onTextSet]);

  return (
    <Input value={text} onChange={onChangeHandler} ref={DOMRef} {...props} />
  );
};

export { AttractiveInput };
