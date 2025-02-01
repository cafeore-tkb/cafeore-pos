import {
  type ChangeEventHandler,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useFocusRef } from "../functional/useFocusRef";
import { Textarea, type TextareaProps } from "../ui/textarea";

type props = TextareaProps & {
  onTextSet: (text: string) => void;
  focus: boolean;
};

/**
 * focus が true のときに自動でフォーカスを当てる textarea
 */
const AttractiveTextArea = ({ focus, onTextSet, ...props }: props) => {
  const [text, setText] = useState("");
  const DOMRef = useFocusRef<HTMLTextAreaElement>(focus);

  const onChangeHandler: ChangeEventHandler<HTMLTextAreaElement> = useCallback(
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
    <Textarea value={text} onChange={onChangeHandler} ref={DOMRef} {...props} />
  );
};

export { AttractiveTextArea };
