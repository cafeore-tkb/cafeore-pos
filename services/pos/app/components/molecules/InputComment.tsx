import { useState } from "react";
import { Input } from "../ui/input";
import { WithId, OrderEntity } from "@cafeore/common";

type props = {
  order: WithId<OrderEntity>;
  addComment: (order: WithId<OrderEntity>, descComment: string) => void; // これをコンポーネントの中で呼び出す
};

export const InputComment = ({ order, addComment }: props) => {
  const [descComment, setDescComment] = useState("");

  return (
    <div className="my-2">
      <Input
        id="comment"
        name="comment"
        type="string"
        value={descComment}
        placeholder="追記"
        onChange={(e) => {
          setDescComment(e.target.value);
        }}
        onKeyDown={(e) => {
          // MacOSではIME確定時のEnterでもkey === "Enter"が発火してしまう
          // deprecatedではあるがkeyCodeを使う
          if (e.keyCode === 13) {
            addComment(order, descComment);
            setDescComment("");
          }
        }}
      />
    </div>
  );
};
