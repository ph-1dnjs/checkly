import { Button } from "../../shared/ui/Button";
import checklyMark from "../../assets/checkly-mark.png";
import { Wordmark } from "./AuthFields";

type Props = { message: string; retrying: boolean; onRetry: () => void };

/** 시작할 때 로그인 상태를 확인하지 못했을 때(오프라인 등). 로그인 화면 자리에 이유와 다시 시도만 보인다. */
export const AuthUnavailable = ({ message, retrying, onRetry }: Props) => (
  <main className="auth-screen" data-ck-scroll="light">
    <section className="auth-login" data-screen-label="시작 · 연결 실패">
      <div className="auth-login-inner">
        <div className="auth-login-brand">
          <img src={checklyMark} alt="Checkly 마크" />
          <h1>
            <Wordmark />
          </h1>
        </div>
        <div className="auth-unavailable" role="alert">
          <span className="msi" aria-hidden="true">cloud_off</span>
          <p>{message}</p>
        </div>
        <Button className="auth-btn auth-btn-primary" onClick={onRetry} disabled={retrying} aria-busy={retrying} autoFocus>
          {retrying ? "확인하는 중…" : "다시 시도"}
        </Button>
      </div>
    </section>
  </main>
);
