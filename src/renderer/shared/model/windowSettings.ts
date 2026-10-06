export type WindowSettings = {
  fillScreenOnStartup: boolean;
  width: number;
  height: number;
};

export type ResolutionPreset = { label: string; width: number; height: number };

export type WindowSettingsBridge = {
  getSettings: () => Promise<WindowSettings>;
  getResolutionPresets: () => Promise<ResolutionPreset[]>;
  setFillScreenOnStartup: (fillScreenOnStartup: boolean) => Promise<WindowSettings>;
  setResolution: (size: { width: number; height: number }) => Promise<WindowSettings>;
};
