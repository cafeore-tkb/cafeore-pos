import { Textarea, type TextareaProps } from "common/components/ui/textarea";
import {
  type ChangeEventHandler,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useFocusRef } from "../functional/useFocusRef";

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

  useEffect(() => {
    onTextSet(text);
  }, [text, onTextSet]);

  return (
    <Textarea
      value={text}
      onChange={onChangeHandler}
      ref={DOMRef}
      disabled={!focus}
      {...props}
    />
  );
};

export { AttractiveTextArea };
