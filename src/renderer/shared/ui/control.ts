import type { CSSProperties } from "react";

/**
 * 버튼·인풋이 가질 수 있는 크기는 두 가지뿐이다.
 * - large: 시작 화면(로그인·가입) 같은 폼 중심 화면의 44px 컨트롤
 * - small: 그 외 작업 화면 전체의 32px 컨트롤
 * 높이는 styles/controls.css가 소유하므로 다른 크기를 만들지 않는다.
 */
export type ControlSize = "large" | "small";

/** 크기를 정하는 속성은 inline style로도 바꾸지 못하게 막는다. */
export type ControlStyle = Omit<
  CSSProperties,
  "height" | "minHeight" | "maxHeight" | "blockSize" | "minBlockSize" | "maxBlockSize" | "fontSize" | "lineHeight" | "padding" | "paddingTop" | "paddingBottom"
>;

export const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ") || undefined;
