import { Button } from "../../shared/ui/Button";

export const Toggle = ({
  on,
  onToggle,
  label,
  hint,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  hint: string;
}) => (
  <div className="settings-row">
    <div>
      <div className="settings-row-label">{label}</div>
      <div className="settings-row-hint">{hint}</div>
    </div>
    <Button
      className={`settings-toggle${on ? " on" : ""}`}
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      aria-label={label}
    >
      <i />
    </Button>
  </div>
);
