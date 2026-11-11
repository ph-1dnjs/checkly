import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "../../shared/ui/Button";
import checklyMark from "../../assets/checkly-mark.png";

export const RECORDER_STORE_URL = "https://chromewebstore.google.com/detail/afadfmcbnohkeoghelpfcpjkefngkold?utm_source=item-share-cb";

const SLIDE_MS = 5000;
/** 이만큼(px) 끌어야 드래그로 본다. 그보다 짧으면 안의 링크 클릭으로 둔다. */
const DRAG_START = 6;
/** 카드 너비 대비 이 비율 넘게 끌면 다음·이전 장으로 넘긴다. */
const SWIPE_RATIO = 0.18;

const SLIDES = [
  { name: "Checkly Recorder", tone: "brand" },
  { name: "Checkly", tone: "plain" },
] as const;

const RECORDER_FEATURES = [
  { icon: "videocam", title: "오류 순간 자동 기록", body: "오류 전후 화면이 알아서 남아요" },
  { icon: "account_tree", title: "API 기록까지 함께", body: "그 구간의 요청·응답도 남아요" },
  { icon: "group", title: "팀에 바로 공유", body: "서버 탭에서 팀이 함께 확인" },
];

const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

type Drag = { pointerId: number; startX: number; dx: number; active: boolean };

/**
 * 설정 맨 아래 배너. Checkly Recorder 홍보와 앱 소개를 가로로 밀어 넘긴다.
 * 5초마다 자동으로 넘기고, 끌어서 넘길 수 있다. 마우스를 올리거나 포커스가 들어오면 멈추고,
 * 동작 줄이기 설정에서는 자동으로 넘기지 않는다.
 */
export const BrandCarousel = ({ version }: { version: string }) => {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragX, setDragX] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const paused = hovered || focused || dragX !== null;

  useEffect(() => {
    if (paused || prefersReducedMotion()) return;
    const timer = window.setTimeout(() => setIndex((value) => (value + 1) % SLIDES.length), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [index, paused]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, dx: 0, active: false };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.dx = event.clientX - current.startX;
    if (!current.active && Math.abs(current.dx) < DRAG_START) return;
    if (!current.active) {
      current.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    // 첫 장에서 오른쪽, 마지막 장에서 왼쪽으로는 고무줄처럼 덜 끌린다.
    const atEdge = (index === 0 && current.dx > 0) || (index === SLIDES.length - 1 && current.dx < 0);
    setDragX(atEdge ? current.dx / 3 : current.dx);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!current.active) return;
    suppressClick.current = true;
    const width = viewport.current?.clientWidth || 1;
    if (Math.abs(current.dx) > width * SWIPE_RATIO) {
      setIndex((value) => Math.min(SLIDES.length - 1, Math.max(0, value + (current.dx < 0 ? 1 : -1))));
    }
    setDragX(null);
  };

  const slide = (at: number) => ({
    className: "settings-banner-slide",
    "data-tone": SLIDES[at].tone,
    "aria-hidden": at !== index || undefined,
    inert: at !== index || undefined,
    role: "group",
    "aria-roledescription": "슬라이드",
    "aria-label": `${at + 1} / ${SLIDES.length}: ${SLIDES[at].name}`,
  });

  const offset = dragX === null ? `-${index * 100}%` : `calc(-${index * 100}% + ${dragX}px)`;

  return (
    <section
      className="settings-brand-footer"
      data-tone={SLIDES[index].tone}
      aria-roledescription="캐러셀"
      aria-label="Checkly 소개"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div
        ref={viewport}
        className="settings-banner-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        onDragStart={(event) => event.preventDefault()}
      >
        <div
          className="settings-banner-track"
          data-dragging={dragX !== null || undefined}
          style={{ transform: `translateX(${offset})` }}
          aria-live={paused ? "polite" : "off"}
        >
          <div {...slide(0)}>
            <div className="settings-recorder-head">
              <span className="settings-recorder-logo" aria-hidden="true">
                <img src={checklyMark} alt="" />
              </span>
              <div className="settings-recorder-copy">
                <div className="settings-recorder-title">Checkly Recorder가 나왔어요</div>
                <div className="settings-recorder-sub">테스트하는 브라우저에서 오류를 바로 잡아 팀에 넘기세요.</div>
              </div>
              <a className="settings-recorder-cta" href={RECORDER_STORE_URL} target="_blank" rel="noreferrer">
                바로가기
                <span className="msi" aria-hidden="true">arrow_outward</span>
              </a>
            </div>
            <ul className="settings-recorder-features">
              {RECORDER_FEATURES.map((feature) => (
                <li key={feature.title}>
                  <span className="msi" aria-hidden="true">{feature.icon}</span>
                  <strong>{feature.title}</strong>
                  <span>{feature.body}</span>
                </li>
              ))}
            </ul>
            <div className="settings-recorder-note">
              <span className="msi" aria-hidden="true">key</span>
              이 프로젝트 코드로 바로 로그인돼요
            </div>
          </div>
          <div {...slide(1)}>
            <img className="settings-brand-mark" src={checklyMark} alt="Checkly 마크" />
            <div className="settings-brand-wordmark">
              Check<span>ly</span>
            </div>
            <div className="settings-brand-tagline">반복되는 확인을 대신 맡습니다</div>
            <div className="settings-brand-version">{version}</div>
          </div>
        </div>
      </div>
      <div className="settings-brand-dots">
        {SLIDES.map((item, at) => (
          <Button
            key={item.name}
            className="settings-brand-dot"
            aria-label={`${at + 1}번째 슬라이드: ${item.name}`}
            aria-current={at === index || undefined}
            onClick={() => setIndex(at)}
          />
        ))}
      </div>
    </section>
  );
};
