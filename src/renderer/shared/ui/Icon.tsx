import type { ReactNode } from "react";

export type IconName =
  | "add"
  | "add_link"
  | "arrow_back"
  | "auto_fix_high"
  | "check"
  | "check_circle"
  | "close"
  | "content_copy"
  | "data_object"
  | "delete"
  | "drag_indicator"
  | "dynamic_form"
  | "edit"
  | "error"
  | "expand_more"
  | "info"
  | "link"
  | "more_horiz"
  | "play_arrow"
  | "play_circle"
  | "refresh"
  | "save"
  | "settings"
  | "stop_circle"
  | "unfold_less"
  | "unfold_more"
  | "warning";

const CONTENT: Record<IconName, ReactNode> = {
  add: <path d="M11 5h2v14h-2zM5 11h14v2H5z" />,
  add_link: <>
    <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1Z" />
    <path d="M8 13h8v-2H8v2Z" />
    <path d="M17 7h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5Z" />
    <path d="M17 1h-2v3h-3v2h3v3h2V6h3V4h-3V1Z" />
  </>,
  arrow_back: <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2Z" />,
  auto_fix_high: <>
    <path d="m14.7 4.3 5 5L9.5 19.5H4.5v-5L14.7 4.3Zm-8.8 11v2.2h2.2l8.8-8.8-2.2-2.2-8.8 8.8Z" />
    <path d="M5 3v4M3 5h4m13 9v4m-2-2h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
  </>,
  check: <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" />,
  check_circle: <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9Z" />,
  close: <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />,
  content_copy: <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1Zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2Zm0 16H8V7h11v14Z" />,
  data_object: <>
    <path d="M7 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2v-2H5V6h2V4Zm10 0v2h2v12h-2v2h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2Z" />
    <path d="m9 9 3 3-3 3m6-6-3 3 3 3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </>,
  delete: <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z" />,
  drag_indicator: <>
    <circle cx="9" cy="6" r="1.35" />
    <circle cx="15" cy="6" r="1.35" />
    <circle cx="9" cy="12" r="1.35" />
    <circle cx="15" cy="12" r="1.35" />
    <circle cx="9" cy="18" r="1.35" />
    <circle cx="15" cy="18" r="1.35" />
  </>,
  dynamic_form: <>
    <rect x="4" y="4" width="6" height="4" rx=".7" />
    <rect x="14" y="4" width="6" height="4" rx=".7" />
    <rect x="4" y="12" width="6" height="4" rx=".7" />
    <rect x="14" y="12" width="6" height="4" rx=".7" />
    <path d="M7 8v4m10-4v4M10 6h4M10 14h4" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </>,
  edit: <path d="m4 16.5-.5 3.5 3.5-.5L18.81 7.19a2 2 0 0 0 0-2.83l-1.17-1.17a2 2 0 0 0-2.83 0L4 16.5Zm2.1 1.1.29-1.99 8.72-8.72 1.99 1.99-8.72 8.72-2.28.32Z" />,
  error: <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z" />,
  expand_more: <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />,
  info: <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z" />,
  link: <>
    <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1Z" />
    <path d="M8 13h8v-2H8v2Z" />
    <path d="M17 7h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5Z" />
  </>,
  more_horiz: <path d="M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />,
  play_arrow: <path d="m8 5 11 7-11 7V5Z" />,
  play_circle: <>
    <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z" />
    <path d="m10 8 5.5 4-5.5 4V8Z" />
  </>,
  refresh: <path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z" />,
  save: <path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4Zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm3-10H5V5h10v4Z" />,
  settings: <>
    <path d="m19.43 12.98.04-.98-.04-.98 2.11-1.65-2-3.46-2.49 1a7.1 7.1 0 0 0-1.7-.98L15 3h-4l-.35 2.93a7.1 7.1 0 0 0-1.7.98l-2.49-1-2 3.46 2.11 1.65-.04.98.04.98-2.11 1.65 2 3.46 2.49-1c.52.4 1.09.73 1.7.98L11 21h4l.35-2.93a7.1 7.1 0 0 0 1.7-.98l2.49 1 2-3.46-2.11-1.65ZM13 15.5A3.5 3.5 0 1 1 13 8a3.5 3.5 0 0 1 0 7.5Z" />
  </>,
  unfold_less: <path d="M7.41 18.59 8.83 20 12 16.83 15.17 20l1.41-1.41L12 14l-4.59 4.59Zm9.18-13.18L15.17 4 12 7.17 8.83 4 7.41 5.41 12 10l4.59-4.59Z" />,
  unfold_more: <path d="M12 5.83 15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83Zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17Z" />,
  stop_circle: <>
    <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z" />
    <rect x="9" y="9" width="6" height="6" rx=".8" />
  </>,
  warning: <path d="M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z" />,
};

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return <svg className={className ? `app-icon ${className}` : "app-icon"} aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">{CONTENT[name]}</svg>;
}
