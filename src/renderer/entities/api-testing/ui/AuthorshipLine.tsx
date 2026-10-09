import { Fragment } from "react";
import { authorshipParts, type AuthoredItem } from "../lib/authorship";

/** Under a scenario or suite title: who made it when and who changed it last (team mode). Nothing when there is nothing to say. */
export function AuthorshipLine({ item }: { item: AuthoredItem }) {
  const parts = authorshipParts(item);
  if (!parts.length) return null;
  return <p className="api-authorship" aria-label="작성 정보">
    {parts.map((part, index) => <Fragment key={index}>
      {index > 0 && <span className="api-authorship-sep"> · </span>}
      <span>{part}</span>
    </Fragment>)}
  </p>;
}
