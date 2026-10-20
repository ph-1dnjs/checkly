import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cx, type ControlSize, type ControlStyle } from "./control";

/**
 * primary: 화면의 주 CTA(한 화면에 하나) · secondary: 일반 동작 · danger: 삭제·중지
 * ghost: 테두리 없는 보조 동작·아이콘 버튼
 * plain: 버튼 모양이 아닌 클릭 영역(탭, 목록 행, 메뉴 항목, 토큰 등). 크기·모양을 주지 않는다.
 */
export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type BaseProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style">;

type StyledProps = BaseProps & {
  variant: ButtonVariant;
  /** 기본값 small. large·small 외의 크기는 없다. */
  size?: ControlSize;
  /** 아이콘만 있는 정사각형 버튼 */
  iconOnly?: boolean;
  style?: ControlStyle;
};

type PlainProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "plain";
  size?: never;
  iconOnly?: never;
};

export type ButtonProps = StyledProps | PlainProps;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => {
  if (props.variant === undefined || props.variant === "plain") {
    const { variant: _variant, type = "button", ...rest } = props;
    return <button ref={ref} type={type} {...rest} />;
  }
  const { variant, size = "small", iconOnly, className, type = "button", ...rest } = props;
  return (
    <button
      ref={ref}
      type={type}
      className={cx("ck-btn", `ck-btn--${size}`, `ck-btn--${variant}`, iconOnly && "ck-btn--icon", className)}
      {...rest}
    />
  );
});

Button.displayName = "Button";
