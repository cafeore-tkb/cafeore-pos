import { useSubmit } from "@remix-run/react";

type props = {
  disableFirebase: boolean;
};

export const useFlaggedSubmit = ({ disableFirebase }: props) => {
  if (disableFirebase) {
    return () => {
      console.warn(
        "`disableFirebase`が有効なため\nFirebase に接続せず、データの送信は行われません",
      );
    };
  }
  const submit = useSubmit();
  return submit;
};
