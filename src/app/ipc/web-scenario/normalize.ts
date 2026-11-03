import { randomUUID } from 'node:crypto';
import { routePath, migrateLegacyUrl, parseMarkdown, splitScenarioBlocks, type Scenario, type Step } from './scenario';

export const isUuid = (value: string | undefined): value is string => !!value && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);

/** DB에 이미 저장된 ID의 소속. 다른 문서의 시나리오 ID나 다른 시나리오의 단계 ID는 새로 부여한다. */
export type SavedOwners = { documentId?: string; scenarios?: Map<string, string>; steps?: Map<string, string> };

/** 이전 문서는 최초 조회 때 UUID를 부여한다. 이후에는 본문에 있는 ID로 좌표를 찾는다. */
export const normalizeDocument = (source: string, positions: string, newDocument = false, owners: SavedOwners = {}) => {
  // 이전 좌표는 `제목\nurl` 키로 저장돼 있어 `url:` 줄을 없애기 전 값으로 찾는다.
  const legacy = parseMarkdown(source);
  const markdown = splitScenarioBlocks(source).map(migrateLegacyUrl).join('\n\n');
  const store = JSON.parse(positions) as Record<string, Partial<Step>[]>;
  const seen = new Set<string>();
  const uniqueId = (id?: string, foreign = false) => {
    const value = !newDocument && !foreign && isUuid(id) && !seen.has(id) ? id : randomUUID();
    seen.add(value);
    return value;
  };
  const scenarios = parseMarkdown(markdown).map((scenario, index): Scenario => {
    const savedDocument = owners.scenarios?.get(scenario.id);
    const id = uniqueId(scenario.id, savedDocument !== undefined && savedDocument !== owners.documentId);
    const legacyUrl = legacy[index]?.url ?? '';
    const points = [...(store[scenario.id] ?? store[`${scenario.title}\n${legacyUrl}`] ?? [])];
    return { ...scenario, id, code: scenario.code || `TC_${index + 1}`, sortOrder: index,
      steps: scenario.steps.map(step => {
        const pointIndex = points.findIndex(point => step.databaseId && point.databaseId ? step.databaseId === point.databaseId :
          point.action === step.action && (step.action === 'goto' && point.target ? routePath(point.target) : point.target) === step.target && point.value === step.value &&
          point.prompt === step.prompt && point.condition === step.condition && point.waitSeconds === step.waitSeconds &&
          (point.occurrence ?? 1) === (step.occurrence ?? 1));
        const point = pointIndex < 0 ? undefined : points.splice(pointIndex, 1)[0];
        const owner = step.databaseId ? owners.steps?.get(step.databaseId) : undefined;
        return { ...step, databaseId: uniqueId(step.databaseId, owner !== undefined && owner !== id), x: point?.x === undefined ? undefined : Math.round(point.x * 10) / 10, y: point?.y === undefined ? undefined : Math.round(point.y * 10) / 10, color: point?.color,
          markerViewport: point?.markerViewport ?? (point?.x === undefined ? undefined : 'desktop'),
          markerPageUrl: point?.markerPageUrl ?? (point?.x === undefined ? undefined : legacyUrl) };
      }),
    };
  });
  const blocks = splitScenarioBlocks(markdown).map((block, index) => {
    const scenario = scenarios[index];
    let stepIndex = 0;
    const lines = block.trim().split('\n').filter(line => !/^\s*(id|code):/.test(line));
    lines.splice(1, 0, `id: ${scenario.id}`, `code: ${scenario.code}`);
    return lines.map(line => /^(Given|When|Then|And|But|If)\s+/i.test(line.trim())
      ? `${line.replace(/\s*<!-- step:[a-f0-9-]{36} -->/g, '')} <!-- step:${scenario.steps[stepIndex++].databaseId} -->` : line).join('\n');
  });
  return { scenarios, markdown: blocks.join('\n\n'), positions: JSON.stringify(Object.fromEntries(scenarios.map(scenario => [scenario.id,
    scenario.steps.filter(step => step.x !== undefined && step.y !== undefined),
  ]))) };
};
