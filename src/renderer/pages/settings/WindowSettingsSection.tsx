import { useEffect, useState, type ChangeEvent } from "react";
import { Toggle } from "./Toggle";
import type { ResolutionPreset } from "../../shared/model/windowSettings";

// 설정 화면의 "WINDOW" 그룹. 상태와 로직을 이 파일 안에서 전부 책임지므로,
// 이 기능을 바꿀 때 SettingsPage.tsx는 건드릴 필요가 없다.
export const WindowSettingsSection = () => {
  const [fillScreenOnStartup, setFillScreenOnStartup] = useState(false);
  const [resolution, setResolution] = useState({ width: 1200, height: 800 });
  const [resolutionPresets, setResolutionPresets] = useState<ResolutionPreset[]>([]);

  useEffect(() => {
    void window.electronAPI.windowSettings.getSettings().then((settings) => {
      setFillScreenOnStartup(settings.fillScreenOnStartup);
      setResolution({ width: settings.width, height: settings.height });
    });
    void window.electronAPI.windowSettings
      .getResolutionPresets()
      .then(setResolutionPresets);
  }, []);

  const toggleFillScreenOnStartup = () => {
    setFillScreenOnStartup((value) => {
      const next = !value;
      void window.electronAPI.windowSettings.setFillScreenOnStartup(next);
      return next;
    });
  };

  const changeResolution = (event: ChangeEvent<HTMLSelectElement>) => {
    const [width, height] = event.target.value.split("x").map(Number);
    setResolution({ width, height });
    void window.electronAPI.windowSettings.setResolution({ width, height });
  };

  return (
    <div className="settings-group">
      <div className="settings-group-label">
        <span>WINDOW</span>
        <i />
      </div>
      <Toggle
        label="화면 꽉 채우기"
        hint="앱을 실행할 때 창(타이틀바·작업표시줄 유지)을 화면 크기에 맞춰 최대화합니다. 전체화면 모드는 아닙니다"
        on={fillScreenOnStartup}
        onToggle={toggleFillScreenOnStartup}
      />
      <div className="settings-row">
        <div>
          <div className="settings-row-label">창 해상도</div>
          <div className="settings-row-hint">
            화면 꽉 채우기가 꺼져 있을 때 적용되는 창 크기입니다
          </div>
        </div>
        <div className="settings-row-value">
          <select
            aria-label="창 해상도"
            value={`${resolution.width}x${resolution.height}`}
            disabled={fillScreenOnStartup}
            onChange={changeResolution}
          >
            {resolutionPresets.map((preset) => (
              <option
                key={`${preset.width}x${preset.height}`}
                value={`${preset.width}x${preset.height}`}
              >
                {preset.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
