import { useEffect, useState, type ChangeEvent } from "react";
import { SettingRow, Switch } from "./SettingsSection";
import type { ResolutionPreset } from "../../shared/model/windowSettings";

// 설정 "앱" 섹션의 창 행(화면 꽉 채우기·창 크기). 상태와 로직을 이 파일 안에서 전부 책임지므로,
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
    <>
      <SettingRow
        label="화면 꽉 채우기"
        action={<Switch label="화면 꽉 채우기" on={fillScreenOnStartup} onToggle={toggleFillScreenOnStartup} />}
      >
        <span className="setting-hint">실행할 때 창을 화면 크기에 맞춰 최대화합니다(전체화면 아님)</span>
      </SettingRow>
      <SettingRow
        label="창 크기"
        disabled={fillScreenOnStartup}
        action={
          <span className="setting-select">
            <select
              aria-label="창 크기"
              value={`${resolution.width}x${resolution.height}`}
              disabled={fillScreenOnStartup}
              onChange={changeResolution}
            >
              {resolutionPresets.map((preset) => (
                <option key={`${preset.width}x${preset.height}`} value={`${preset.width}x${preset.height}`}>
                  {preset.label}
                </option>
              ))}
            </select>
            <span className="msi" aria-hidden="true">expand_more</span>
          </span>
        }
      >
        {fillScreenOnStartup && <span className="setting-hint warn">꽉 채우기가 켜져 있어 적용되지 않습니다</span>}
      </SettingRow>
    </>
  );
};
