import { type ComponentType } from "react";
import { requestBodyValue } from "./swagger-request";

export type SwaggerMap = {
  get: (key: string, notSetValue?: unknown) => unknown;
  keySeq?: () => { toArray: () => unknown[] };
  toJS?: () => unknown;
};

export type SwaggerSystem = {
  getComponent: (name: string) => ComponentType<any>;
  layoutActions: { show: (key: string[], shown: boolean) => void; updateFilter: (filter: string) => void };
  specActions: {
    changeParam: (pathMethod: string[], name: string, location: string, value: unknown) => unknown;
    execute: (args: { path: string; method: string }) => unknown;
    setRequest: (path: string, method: string, request: Record<string, unknown>) => unknown;
    setMutatedRequest?: (path: string, method: string, request: Record<string, unknown>) => unknown;
    setResponse: (path: string, method: string, response: Record<string, unknown>) => unknown;
  };
  specSelectors: {
    taggedOperations: () => SwaggerMap;
    operationWithMeta: (path: string, method: string) => SwaggerMap;
    parameterValues: (pathMethod: string[], isXml?: boolean) => SwaggerMap;
  };
  oas3Selectors?: { requestBodyValue: (path: string, method: string) => unknown };
  oas3Actions?: { setRequestBodyValue: (args: { value: string; pathMethod: string[] }) => unknown };
};

export type Selection = { path: string; method: string };
export type SwaggerDeepLinkKey = ["operations-tag", string] | ["operations", string, string];
export type MutableRef<T> = { current: T };
export type SwaggerComponent = ComponentType<any>;
