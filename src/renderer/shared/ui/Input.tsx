import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Button } from "./Button";
import { cx, type ControlSize, type ControlStyle } from "./control";

/** 글자를 입력하는 인풋만 다룬다. checkbox·radio·range·file은 이 컴포넌트를 쓰지 않는다. */
export type InputType = "text" | "password" | "email" | "search" | "url" | "tel" | "number" | "date" | "datetime-local" | "time" | "month" | "week";

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type" | "style"> & {
  /** 기본값 small. large·small 외의 크기는 없다. */
  size?: ControlSize;
  type?: InputType;
  /** 코드·식별자·경로처럼 D2Coding으로 보여 줄 값 */
  mono?: boolean;
  invalid?: boolean;
  /** 인풋 안쪽 앞(검색 아이콘 등) */
  leading?: ReactNode;
  /** 인풋 안쪽 뒤(표시 토글, 단위 등) */
  trailing?: ReactNode;
  /** leading·trailing이 있을 때 바깥 틀에 붙는 클래스 */
  wrapperClassName?: string;
  style?: ControlStyle;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ size = "small", type = "text", mono, invalid, leading, trailing, wrapperClassName, className, style, ...rest }, ref) => {
    const field = (
      <input
        ref={ref}
        type={type}
        aria-invalid={invalid || undefined}
        className={cx("ck-input", `ck-input--${size}`, mono && "ck-input--mono", className)}
        style={leading || trailing ? undefined : style}
        {...rest}
      />
    );
    if (!leading && !trailing) return field;
    return (
      <span
        className={cx("ck-input-wrap", `ck-input-wrap--${size}`, Boolean(leading) && "has-leading", Boolean(trailing) && "has-trailing", wrapperClassName)}
        style={style}
      >
        {leading && <span className="ck-input-leading">{leading}</span>}
        {field}
        {trailing && <span className="ck-input-trailing">{trailing}</span>}
      </span>
    );
  },
);

Input.displayName = "Input";

type PasswordInputProps = Omit<InputProps, "type" | "trailing"> & {
  /** 확인 칸과 표시 상태를 공유할 때 넘긴다. 없으면 자체 상태를 쓴다. */
  visible?: boolean;
  onToggleVisible?: () => void;
  /** 표시/숨기기 버튼 이름에 쓴다. */
  subject?: string;
};

/** 표시/숨기기 아이콘 버튼이 붙은 비밀번호 입력 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ visible, onToggleVisible, subject = "비밀번호", disabled, ...rest }, ref) => {
    const [ownVisible, setOwnVisible] = useState(false);
    const shown = visible ?? ownVisible;
    const label = shown ? `${subject} 숨기기` : `${subject} 표시`;
    return (
      <Input
        ref={ref}
        type={shown ? "text" : "password"}
        autoComplete="current-password"
        disabled={disabled}
        {...rest}
        trailing={
          <Button
            className="ck-input-toggle"
            onClick={() => (onToggleVisible ? onToggleVisible() : setOwnVisible((value) => !value))}
            aria-pressed={shown}
            aria-label={label}
            title={label}
            disabled={disabled}
          >
            <span className="msi" aria-hidden="true">{shown ? "visibility_off" : "visibility"}</span>
          </Button>
        }
      />
    );
  },
);

PasswordInput.displayName = "PasswordInput";
