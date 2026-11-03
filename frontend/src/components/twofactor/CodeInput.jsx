import { REGEXP_ONLY_DIGITS } from "input-otp";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

/** Six boxes for a six-digit code. One real input underneath, so paste, the phone's "from messages" suggestion and password managers work. */
export function CodeInput({ value, onChange, onComplete, label, testId, id, disabled, autoFocus }) {
  return (
    <InputOTP
      id={id} maxLength={6} value={value} onChange={onChange} onComplete={onComplete} pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric" autoComplete="one-time-code" aria-label={label} data-testid={testId} disabled={disabled} autoFocus={autoFocus}
      pushPasswordManagerStrategy="none" containerClassName="gap-0">
      <InputOTPGroup className="gap-1.5 sm:gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <InputOTPSlot key={i} index={i}
            className="h-12 w-10 sm:w-11 rounded-lg border text-xl font-semibold bg-background first:rounded-lg last:rounded-lg first:border" />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
