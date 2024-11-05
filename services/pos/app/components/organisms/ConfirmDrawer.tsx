import { type ComponentProps, useEffect, useRef } from "react";
import type { Drawer as DrawerPrimitive } from "vaul";
import { Button } from "../ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";

const sleep = (time: number) =>
  new Promise((resolve) => setTimeout(resolve, time)); //timeはミリ秒

type props = ComponentProps<typeof DrawerPrimitive.Root> & {
  focus: boolean;
  children: React.ReactNode;
  onConfirm: () => void;
};

const ConfirmDrawer = ({ children, focus, onConfirm, ...props }: props) => {
  const buttonRef = useRef<HTMLButtonElement>(null);

  /**
   * OK
   */
  useEffect(() => {
    console.log("use eefect");
    const wait = async () => {
      await sleep(3000);
    };
    wait();
    if (focus) {
      buttonRef.current?.focus();
      console.log("focue executed");
    }
  }, [focus]);

  return (
    <Drawer open={focus} {...props}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-center">送信しますか？</DrawerTitle>
        </DrawerHeader>
        {children}
        <DrawerFooter className="flex items-center justify-center">
          <Button
            ref={buttonRef}
            onClick={onConfirm}
            className="w-1/2 bg-orange-600"
          >
            送信
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

export { ConfirmDrawer };
