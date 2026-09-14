type Props = {
  label: string;
  className?: string;
};

/** Use for short, indeterminate reads; long-running work should use ProgressBar. */
export function LoadingSpinner({ label, className = "" }: Props) {
  const classes = ["loading-spinner-label", className].filter(Boolean).join(" ");
  return (
    <p className={classes} role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </p>
  );
}
