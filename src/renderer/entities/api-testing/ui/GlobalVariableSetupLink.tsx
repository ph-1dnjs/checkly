/** Displays a missing value; the containing feature decides how to configure it. */
export function GlobalVariableSetupLink({ name, onConfigure }: { name: string; onConfigure: (name: string) => void }) {
  return <button type="button" className="api-global-variable-setup-link" title={`${name} 전역변수 설정`} aria-label={`${name} 전역변수 설정하기`} onClick={event => { event.stopPropagation(); onConfigure(name); }}>설정하기</button>;
}
