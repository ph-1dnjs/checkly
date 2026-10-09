import type { ApiAuthorship } from "../../../../app/api-testing/shared/workspace";

/** What the list row and detail header need; names are there only in team mode. */
export type AuthoredItem = ApiAuthorship & { updatedAt?: string };

const pad = (value: number) => String(value).padStart(2, "0");

/** "10/09 14:20" in local time (the year only when it is not this year). */
export function shortDateTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const day = `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
  return `${date.getFullYear() === now.getFullYear() ? day : `${date.getFullYear()}/${day}`} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "방금" · "3분 전" · "2시간 전" · "어제" · "4일 전", then the date. */
export function relativeTime(iso: string, now = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "방금";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}시간 전`;
  const days = Math.floor(seconds / 86_400);
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  return shortDateTime(iso, now).split(" ")[0];
}

/** List row: "hyewon · 3분 전" (who changed it last, team mode only). */
export function lastEditedText(item: AuthoredItem, now = new Date()): string {
  return item.updatedBy && item.updatedAt ? `${item.updatedBy} · ${relativeTime(item.updatedAt, now)}` : "";
}

/**
 * Detail header parts: "minsu 작성 · 10/09 14:20", "hyewon 수정 · 3분 전" (only once changed after
 * it was made). File mode has no names, so nothing shows there.
 */
export function authorshipParts(item: AuthoredItem, now = new Date()): string[] {
  const parts: string[] = [];
  if (item.createdBy) parts.push(item.createdAt ? `${item.createdBy} 작성 · ${shortDateTime(item.createdAt, now)}` : `${item.createdBy} 작성`);
  const edited = item.updatedAt && (!item.createdAt || Math.abs(Date.parse(item.updatedAt) - Date.parse(item.createdAt)) > 1000);
  if (item.updatedBy && item.updatedAt && (edited || !item.createdBy)) parts.push(`${item.updatedBy} 수정 · ${relativeTime(item.updatedAt, now)}`);
  return parts;
}
