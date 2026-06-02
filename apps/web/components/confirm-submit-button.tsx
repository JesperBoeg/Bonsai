"use client";

import type { MouseEvent, ReactNode } from "react";
import { useFormStatus } from "react-dom";

type ConfirmSubmitButtonProps = {
  children: ReactNode;
  className: string;
  confirmationMessage: string;
  pendingLabel: string;
};

export function ConfirmSubmitButton({ children, className, confirmationMessage, pendingLabel }: ConfirmSubmitButtonProps) {
  const { pending } = useFormStatus();

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }

    if (!window.confirm(confirmationMessage)) {
      event.preventDefault();
    }
  }

  return (
    <button className={className} disabled={pending} onClick={handleClick} type="submit">
      {pending ? pendingLabel : children}
    </button>
  );
}