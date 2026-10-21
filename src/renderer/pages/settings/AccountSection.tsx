import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import { errorMessage, NICKNAME_HINT, NICKNAME_PATTERN, PASSWORD_MIN, type AuthAccount } from "../auth/model";
import { SettingsSheet } from "./SettingsDialog";
import { SavedNote, SettingRow } from "./SettingsSection";

type Modal = "nick" | "password" | null;

/** 내 계정: 닉네임·비밀번호. 바꾸는 입력은 작은 창에서 받고, 끝나면 행 아래에 잠깐 알린다. */
export const AccountSection = ({ account }: { account: AuthAccount }) => {
  const [modal, setModal] = useState<Modal>(null);
  const [done, setDone] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const finish = (message: string) => {
    setModal(null);
    setDone(message);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(""), 2400);
  };
  const openModal = (next: Modal) => {
    setDone("");
    setModal(next);
  };

  return (
    <>
      <SettingRow
        label="닉네임"
        action={
          <Button variant="secondary" className="setting-chip" aria-haspopup="dialog" aria-label="닉네임 변경" onClick={() => openModal("nick")}>
            변경
          </Button>
        }
      >
        <span className="setting-mono">{account.session.nickname}</span>
      </SettingRow>
      <SettingRow
        label="비밀번호"
        action={
          <Button variant="secondary" className="setting-chip" aria-haspopup="dialog" aria-label="비밀번호 변경" onClick={() => openModal("password")}>
            변경
          </Button>
        }
      >
        <span className="setting-dots" aria-hidden="true">••••••••</span>
      </SettingRow>
      {done && (
        <div className="setting-row-note">
          <SavedNote text={done} />
        </div>
      )}
      {modal === "nick" && <NicknameSheet account={account} onClose={() => setModal(null)} onDone={finish} />}
      {modal === "password" && <PasswordSheet account={account} onClose={() => setModal(null)} onDone={finish} />}
    </>
  );
};

type SheetProps = { account: AuthAccount; onClose: () => void; onDone: (message: string) => void };

const SheetError = ({ text }: { text: string }) =>
  text ? (
    <div className="settings-error" role="alert">
      <span className="msi" aria-hidden="true">error</span>
      {text}
    </div>
  ) : null;

const NicknameSheet = ({ account, onClose, onDone }: SheetProps) => {
  const { session, bridge } = account;
  const [draft, setDraft] = useState(session.nickname);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nick = draft.trim();
  const changed = !!nick && nick !== session.nickname;
  const valid = NICKNAME_PATTERN.test(nick);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !changed || !valid) return;
    setBusy(true);
    setError("");
    try {
      account.updateSession(await bridge.changeNickname(nick));
      onDone("닉네임을 변경했습니다");
    } catch (reason) {
      setError(errorMessage(reason, "닉네임을 바꾸지 못했습니다."));
      setBusy(false);
    }
  };

  return (
    <SettingsSheet
      title="닉네임 변경"
      onClose={onClose}
      onSubmit={submit}
      footer={<SheetFooter cta="저장" disabled={!changed || !valid || busy} busy={busy} onCancel={onClose} />}
    >
      <label className="settings-sheet-field">
        <span>새 닉네임</span>
        <Input
          mono
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
          placeholder="새 닉네임을 입력해주세요"
          maxLength={20}
          spellCheck={false}
          autoComplete="off"
          autoFocus
        />
        <small data-tone={changed && !valid ? "fail" : undefined}>{NICKNAME_HINT}</small>
      </label>
      <SheetError text={error} />
    </SettingsSheet>
  );
};

const PasswordSheet = ({ account, onClose, onDone }: SheetProps) => {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const short = !!next && next.length < PASSWORD_MIN;
  const mismatch = !!confirm && confirm !== next;
  const ok = !!current && next.length >= PASSWORD_MIN && confirm === next;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !ok) return;
    setBusy(true);
    setError("");
    try {
      await account.bridge.changePassword({ currentPassword: current, newPassword: next });
      onDone("비밀번호를 변경했습니다");
    } catch (reason) {
      setError(errorMessage(reason, "비밀번호를 바꾸지 못했습니다."));
      setBusy(false);
    }
  };

  const fields = [
    ["현재 비밀번호", current, setCurrent, "current-password", "현재 비밀번호를 입력해주세요"],
    ["새 비밀번호", next, setNext, "new-password", `새 비밀번호를 입력해주세요 (${PASSWORD_MIN}자 이상)`],
    ["새 비밀번호 확인", confirm, setConfirm, "new-password", "새 비밀번호를 한 번 더 입력해주세요"],
  ] as const;

  return (
    <SettingsSheet
      title="비밀번호 변경"
      onClose={onClose}
      onSubmit={submit}
      footer={<SheetFooter cta="변경" disabled={!ok || busy} busy={busy} onCancel={onClose} />}
    >
      {fields.map(([label, value, setter, autoComplete, placeholder], index) => (
        <label key={label} className="settings-sheet-field">
          <span>{label}</span>
          <Input
            type="password"
            value={value}
            onChange={(event) => {
              setter(event.target.value);
              setError("");
            }}
            placeholder={placeholder}
            autoComplete={autoComplete}
            aria-invalid={index === 2 && mismatch}
            autoFocus={index === 0}
          />
          {index === 2 && (short || mismatch) && (
            <small data-tone="fail">
              {short ? `새 비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다` : "새 비밀번호가 일치하지 않습니다"}
            </small>
          )}
        </label>
      ))}
      <SheetError text={error} />
    </SettingsSheet>
  );
};

const SheetFooter = ({ cta, disabled, busy, onCancel }: { cta: string; disabled: boolean; busy: boolean; onCancel: () => void }) => (
  <>
    <Button variant="secondary" onClick={onCancel}>
      취소
    </Button>
    <Button type="submit" variant="primary" disabled={disabled} aria-busy={busy}>
      {cta}
    </Button>
  </>
);
