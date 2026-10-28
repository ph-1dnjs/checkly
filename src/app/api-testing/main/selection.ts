import { isDeepStrictEqual } from "node:util";
import type { Json } from "../shared/scenario";
import type { Selection } from "../shared/selection";
import { atPointer } from "./variables";

/** Selection errors describe the rule, never response values. */
export class SelectionError extends Error {}

export function selectArray(value: Json | undefined, selection: Selection): Json {
  if (!Array.isArray(value)) throw new SelectionError("응답 선별 실패: 대상이 배열이 아닙니다.");
  let items = value;
  if (selection.where) {
    const { pointer, equals } = selection.where;
    items = items.filter(item => isDeepStrictEqual(atPointer(item, pointer), equals));
  }
  if (selection.limit !== undefined) items = items.slice(0, selection.limit);
  if (selection.minItems !== undefined && items.length < selection.minItems)
    throw new SelectionError(`응답 선별 실패: 조건에 맞는 항목이 ${items.length}개입니다. 최소 ${selection.minItems}개가 필요합니다.`);
  if (selection.map !== undefined) {
    const pointer = selection.map;
    items = items.map(item => {
      const mapped = atPointer(item, pointer);
      if (mapped === undefined) throw new SelectionError(`응답 선별 실패: 선택 항목에 ${pointer || "전체 값"} 경로가 없습니다.`);
      return mapped;
    });
  }
  if (selection.index !== undefined) {
    if (selection.index >= items.length) throw new SelectionError(`응답 선별 실패: ${selection.index + 1}번째 항목이 없습니다.`);
    return items[selection.index];
  }
  return items;
}
