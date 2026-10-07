import type { ReactNode } from "react";

type Props = {
  /** Material Symbols 아이콘 이름 */
  icon: string;
  title: string;
  /** 타이틀 오른쪽에 놓이는 헤더 요소. 기본은 우측 정렬이며, 자식에 margin-left:auto를 주면 그 앞까지는 왼쪽에 붙는다. */
  extra?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** 아이콘·타이틀(+extra) 48px 헤더 아래에 화면별 콘텐츠를 채우는 공통 페이지 레이아웃. */
export const PageLayout = ({ icon, title, extra, className, children }: Props) => (
  <div className={className ? `page-layout ${className}` : "page-layout"}>
    <header className="page-layout-header">
      <div className="page-layout-title">
        <span className="msi" aria-hidden="true">{icon}</span>
        <h1>{title}</h1>
      </div>
      {extra && <div className="page-layout-extra">{extra}</div>}
    </header>
    <div className="page-layout-content">{children}</div>
  </div>
);
