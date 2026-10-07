import { useCallback, useEffect, useMemo, useState } from "react";
import { parseMarkdown, type Scenario } from "../../../shared/model/scenario";

export type ScenarioFileEntry = { name: string; path: string; updatedAt: string };

export const pickKeyOf = (filePath: string, scenario: Scenario) =>
  `${filePath}::${scenario.id}`;

/**
 * 시나리오 폴더 목록과 실행 대상 선택을 시나리오 작업공간 전체가 함께 쓴다.
 * 편집 탭의 파일 목록, 실행 탭의 대상 선택, 헤더의 선택 개수가 같은 상태를 본다.
 */
export const useScenarioFolder = () => {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [files, setFiles] = useState<ScenarioFileEntry[]>([]);
  const [fileCache, setFileCache] = useState<Record<string, Scenario[]>>({});
  const [loadingFolder, setLoadingFolder] = useState(true);
  const [pickedKeys, setPickedKeys] = useState<Set<string>>(new Set());

  const applyFolderResult = async (result: {
    folderPath: string | null;
    files: ScenarioFileEntry[];
  }) => {
    setFolderPath(result.folderPath);
    const entries = await Promise.all(
      result.files.map(async (file) => {
        const markdown = await window.electronAPI.readScenarioFile(file.path);
        return { file, scenarios: markdown ? parseMarkdown(markdown, file.path) : [] };
      }),
    );
    // 시나리오 단계가 하나도 없는 파일은 파일 목록에서 제외한다.
    const withSteps = entries.filter(({ scenarios }) =>
      scenarios.some((scenario) => scenario.steps.length > 0),
    );
    setFiles(withSteps.map(({ file }) => file));
    setFileCache(
      Object.fromEntries(withSteps.map(({ file, scenarios }) => [file.path, scenarios])),
    );
  };

  const loadWith = async (
    request: () => Promise<{ folderPath: string | null; files: ScenarioFileEntry[] }>,
  ) => {
    setLoadingFolder(true);
    try {
      await applyFolderResult(await request());
    } finally {
      setLoadingFolder(false);
    }
  };

  const refreshFolder = useCallback(
    () => loadWith(() => window.electronAPI.listScenarioFolder()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const chooseFolder = useCallback(
    () => loadWith(() => window.electronAPI.chooseScenarioFolder()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    void refreshFolder();
  }, [refreshFolder]);

  const pickedCountByFile = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const file of files) {
      counts[file.path] = (fileCache[file.path] ?? []).filter((scenario) =>
        pickedKeys.has(pickKeyOf(file.path, scenario)),
      ).length;
    }
    return counts;
  }, [files, fileCache, pickedKeys]);
  const pickedCount = Object.values(pickedCountByFile).reduce(
    (total, count) => total + count,
    0,
  );

  return {
    folderPath,
    files,
    fileCache,
    loadingFolder,
    refreshFolder,
    chooseFolder,
    pickedKeys,
    setPickedKeys,
    pickedCountByFile,
    pickedCount,
  };
};

export type ScenarioFolderState = ReturnType<typeof useScenarioFolder>;
