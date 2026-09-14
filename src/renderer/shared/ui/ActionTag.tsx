import { actionLabel, type Action } from "../model/action";

type Props = {
  action: Action;
  className?: string;
};

export const ActionTag = ({ action, className }: Props) => (
  <span className={["action-tag", className].filter(Boolean).join(" ")} data-action={action}>
    {actionLabel[action]}
  </span>
);
