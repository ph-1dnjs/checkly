import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "text" | "default" | "plain";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

const VARIANT_CLASS_NAME: Record<ButtonVariant, string> = {
  primary: "button button-primary",
  secondary: "button button-secondary",
  danger: "button danger",
  text: "button button-text-import",
  default: "button",
  plain: "",
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = "plain", className, type = "button", ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={[VARIANT_CLASS_NAME[variant], className].filter(Boolean).join(" ") || undefined}
      {...rest}
    />
  ),
);

Button.displayName = "Button";
