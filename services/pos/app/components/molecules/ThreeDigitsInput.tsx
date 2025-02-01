import { REGEXP_ONLY_DIGITS } from "input-otp";
import {
  type ComponentPropsWithoutRef,
  type ElementRef,
  forwardRef,
} from "react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../ui/input-otp";

/**
 * 3桁の数字を入力するためのコンポーネント
 */
const ThreeDigitsInput = forwardRef<
  ElementRef<typeof InputOTP>,
  Omit<
    ComponentPropsWithoutRef<typeof InputOTP>,
    "maxLength" | "pattern" | "render"
  >
>(({ ...props }, ref) => {
  return (
    <InputOTP ref={ref} maxLength={3} pattern={REGEXP_ONLY_DIGITS} {...props}>
      <InputOTPGroup>
        <InputOTPSlot index={0} className="font-mono text-3xl" />
        <InputOTPSlot index={1} className="font-mono text-3xl" />
        <InputOTPSlot index={2} className="font-mono text-3xl" />
      </InputOTPGroup>
    </InputOTP>
  );
});

export { ThreeDigitsInput };
