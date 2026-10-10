import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../../shared/ui/Button";
import { errorMessage } from "../auth/model";

type DialogProps = {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  onSubmit?: (event: FormEvent) => void;
  children?: ReactNode;
  footer: ReactNode;
  tone?: "info" | "danger";
};

/** 설정 화면의 떠 있는 창(디자인 "프로젝트 변경" 모달과 같은 틀). Esc로 닫는다. */
export const SettingsDialog = ({ eyebrow, title, description, onClose, onSubmit, children, footer, tone = "info" }: DialogProps) => {
  const titleId = useId();
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="settings-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={onSubmit ?? ((event) => event.preventDefault())}>
        <div className="settings-dialog-head">
          <div className="settings-dialog-eyebrow" data-tone={tone}>
            {eyebrow}
          </div>
          <h2 id={titleId}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {children}
        <div className="settings-dialog-actions">{footer}</div>
      </form>
    </div>
  );
};

type ConfirmProps = {
  eyebrow: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

/** 되돌릴 수 없는 작업(초대코드 재발급, 팀원 내보내기) 확인. 실패하면 창 안에 이유를 보여준다. */
export const ConfirmDialog = ({ eyebrow, title, description, confirmLabel, danger, onConfirm, onClose }: ConfirmProps) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  };
  return (
    <SettingsDialog
      eyebrow={eyebrow}
      title={title}
      description={description}
      tone={danger ? "danger" : "info"}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button variant="default" className="settings-dialog-push" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} disabled={busy} aria-busy={busy} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error && (
        <div className="settings-dialog-body">
          <div className="settings-error" role="alert">
            <span className="msi" aria-hidden="true">error</span>
            {error}
          </div>
        </div>
      )}
    </SettingsDialog>
  );
};
