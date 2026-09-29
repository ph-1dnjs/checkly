export type ApiRunAction = { run: () => void; disabled: boolean; label?: string };
export type OnRunAction = (action: ApiRunAction | null) => void;
