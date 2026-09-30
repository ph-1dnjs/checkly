import { parseApiSearch, pathFits } from "./api-search";

/** What the scenario/suite list search looks at: the listed name and group, plus the description and APIs used. */
export type SearchableScenario = {
  name: string;
  groupPath: string[];
  /** Shown once the scenario is opened. */
  description?: string;
  /** Each step's API as written: `GET /items/{id}` or an operationId. */
  apis: string[];
};

/** Why an item matched when the list doesn't show it (empty = the name or group matched). */
export type ScenarioSearchReason = { description?: true; apis: string[] };

/**
 * Same rules as the API search: space-separated words must all appear; a pasted URL or path finds the
 * scenarios calling that API (base paths of `baseUrls` are dropped). Returns null for no match.
 */
export function scenarioSearch(phrase: string, baseUrls: string[] = []) {
  const searches = [...new Set(["", ...baseUrls])].map(baseUrl => parseApiSearch(phrase, baseUrl));
  const terms = searches[0].terms;
  return (item: SearchableScenario): ScenarioSearchReason | null => {
    if (!terms.length) return { apis: [] };
    const requests = searches.flatMap(search => search.request ? [search.request] : []);
    if (requests.length) {
      const apis = item.apis.filter(api => {
        const [method, path] = api.split(" ");
        return path !== undefined && requests.some(request => (!request.method || request.method === method.toUpperCase()) && pathFits(path, request.segments));
      });
      if (apis.length) return { apis };
    }
    const listed = [item.name, ...item.groupPath].join("\n").toLocaleLowerCase();
    const description = (item.description ?? "").toLocaleLowerCase();
    const apis = item.apis.map(api => api.toLocaleLowerCase());
    if (!terms.every(term => listed.includes(term) || description.includes(term) || apis.some(api => api.includes(term)))) return null;
    const hidden = terms.filter(term => !listed.includes(term));
    return {
      ...(hidden.some(term => description.includes(term)) ? { description: true as const } : {}),
      apis: item.apis.filter(api => hidden.some(term => api.toLocaleLowerCase().includes(term))),
    };
  };
}
