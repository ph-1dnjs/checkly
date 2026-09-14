type Props = {
  label: string;
  detail?: string;
  value?: number;
  max?: number;
  className?: string;
};

/** A reusable progress treatment for work that can take more than a frame. */
export function ProgressBar({ label, detail, value, max = 100, className = "" }: Props) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const determinate = typeof value === "number" && Number.isFinite(value);
  const safeValue = determinate
    ? Math.max(0, Math.min(value, safeMax))
    : undefined;
  const percent = safeValue === undefined ? undefined : (safeValue / safeMax) * 100;
  const classes = ["loading-progress", className].filter(Boolean).join(" ");

  return (
    <div className={classes} role="status" aria-live="polite">
      <div className="loading-progress-head">
        <strong>{label}</strong>
        {detail && <span>{detail}</span>}
      </div>
      <div
        className={`loading-progress-track${determinate ? "" : " indeterminate"}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={safeValue}
        aria-valuetext={percent === undefined ? "진행 중" : `${Math.round(percent)}%`}
      >
        <span style={percent === undefined ? undefined : { width: `${percent}%` }} />
      </div>
    </div>
  );
}
