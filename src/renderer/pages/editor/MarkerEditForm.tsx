import { actionLabel, type Action, type Step } from "../../shared/model/scenario";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";

type Props = {
  marker: Step;
  isNew: boolean;
  onChange: (changes: Partial<Step>) => void;
  onSelectUploadFile: () => Promise<string | null>;
  onCancel: () => void;
  onComplete: () => void;
};

const TARGET_PLACEHOLDER: Partial<Record<Action, string>> = {
  goto: "이동 경로 (예: /login)",
  fileUpload: 'css=input[type="file"]',
};

/** 화면 추출 마커 목록에서 선택한 마커 아래에 펼쳐지는 액션 편집 폼 */
export const MarkerEditForm = ({ marker, isNew, onChange, onSelectUploadFile, onCancel, onComplete }: Props) => {
  const labelEmpty = !marker.target.trim();
  const warning = labelEmpty
    ? "라벨이 비어 있으면 완료할 수 없습니다."
    : ["fill", "manualFill", "fileUpload", "select"].includes(marker.action)
      ? "라벨 또는 CSS 대상은 페이지의 실제 입력/선택 요소와 일치해야 합니다. 다르면 실행 단계가 실패할 수 있습니다."
      : marker.action === "expectText"
        ? "실행 후 화면에 표시되어야 하는 텍스트를 라벨에 입력하세요. 찾지 못하면 결과 확인 단계가 실패합니다."
        : "";
  const conditionOn = marker.condition !== undefined;
  return (
    <div className="marker-form" onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
      {isNew && <p className="marker-form-kicker">NEW MARKER · STEP {marker.id}</p>}
      <label className="marker-form-field">
        <span>액션</span>
        <span className="marker-form-select">
          <select value={marker.action} onChange={(event) => onChange({ action: event.target.value as Action })}>
            {Object.entries(actionLabel).map(([value, name]) => (
              <option value={value} key={value}>{name}</option>
            ))}
          </select>
          <span className="msi" aria-hidden="true">expand_more</span>
        </span>
      </label>
      <label className="marker-form-field">
        <span>라벨</span>
        <Input
          mono
          autoFocus
          spellCheck={false}
          value={marker.target}
          invalid={labelEmpty}
          onChange={(event) => onChange({ target: event.target.value })}
          placeholder={TARGET_PLACEHOLDER[marker.action] ?? "대상 라벨 또는 css= 선택자"}
        />
      </label>
      {warning && (
        <div className="marker-form-warn" role="alert">
          <span className="msi" aria-hidden="true">warning</span>
          {warning}
        </div>
      )}
      {marker.action === "manualControl" && (
        <div className="marker-form-note">
          실행 시 별도 Chromium 창이 열립니다. 결제 모달·팝업을 직접 조작한 뒤 앱에서 계속을 선택하세요. 이 시나리오에서는 미리보기와 실패 영상이 저장되지 않습니다.
        </div>
      )}
      {marker.action === "manualResult" && (
        <div className="marker-form-note">
          결제 등 자동 확인이 어려운 단계입니다. 실행 시 최대 5분 동안 성공 또는 실패를 직접 선택합니다.
        </div>
      )}
      <div className="marker-form-field">
        <span id={`marker-condition-${marker.id}`}>실행 조건</span>
        <div className="marker-form-inline">
          <div className="marker-form-yn" role="radiogroup" aria-labelledby={`marker-condition-${marker.id}`}>
            <Button role="radio" aria-checked={conditionOn} className={conditionOn ? "on" : ""} onClick={() => onChange({ condition: marker.condition ?? "" })}>Y</Button>
            <Button role="radio" aria-checked={!conditionOn} className={conditionOn ? "" : "on"} onClick={() => onChange({ condition: undefined })}>N</Button>
          </div>
          {conditionOn && (
            <Input
              mono
              aria-label="실행 조건 텍스트"
              value={marker.condition}
              onChange={(event) => onChange({ condition: event.target.value })}
              placeholder="화면에 보일 때만 실행할 텍스트"
            />
          )}
        </div>
      </div>
      {["fill", "select", "fileUpload"].includes(marker.action) && (
        <label className="marker-form-field">
          <span>{marker.action === "fileUpload" ? "업로드할 파일" : marker.action === "select" ? "선택값" : "입력값"}</span>
          <span className="marker-form-inline">
            <Input
              mono
              spellCheck={false}
              value={marker.value ?? ""}
              onChange={(event) => onChange({ value: event.target.value })}
              placeholder={marker.action === "fileUpload" ? "파일 경로를 입력하거나 선택하세요" : marker.action === "select" ? "옵션 라벨 또는 값" : "입력할 값"}
            />
            {marker.action === "fileUpload" && (
              <Button
                variant="secondary"
                onClick={() => void onSelectUploadFile().then((filePath) => {
                  if (filePath) onChange({ value: filePath });
                })}
              >
                파일 선택
              </Button>
            )}
          </span>
        </label>
      )}
      {["click", "expectText"].includes(marker.action) && (
        <label className="marker-form-field">
          <span>{marker.action === "click" ? "클릭 대상 대기 시간 (초)" : "결과 확인 대기 시간 (초)"}</span>
          <Input
            mono
            type="number"
            min="1"
            value={marker.waitSeconds ?? 10}
            onChange={(event) => onChange({ waitSeconds: Math.max(1, Number(event.target.value) || 10) })}
          />
        </label>
      )}
      {marker.action === "click" && (
        <label className="marker-form-field">
          <span>동일 대상 순서</span>
          <Input
            mono
            type="number"
            min="1"
            title="같은 이름의 클릭 대상이 여러 개면 클릭할 순서를 지정합니다."
            value={marker.occurrence ?? 1}
            onChange={(event) => {
              const occurrence = Math.max(1, Number(event.target.value) || 1);
              onChange({ occurrence: occurrence === 1 ? undefined : occurrence });
            }}
          />
        </label>
      )}
      {["manualFill", "manualControl", "manualResult"].includes(marker.action) && (
        <label className="marker-form-field">
          <span>{marker.action === "manualResult" ? "확인 요청 문구" : "안내 문구"}</span>
          <Input
            value={marker.prompt ?? ""}
            onChange={(event) => onChange(marker.action === "manualFill" ? { prompt: event.target.value, required: true } : { prompt: event.target.value })}
            placeholder={marker.action === "manualControl" ? "예: 테스트 결제를 완료한 뒤 계속을 누르세요" : marker.action === "manualResult" ? "확인할 내용을 적어 주세요" : "실행 중 표시할 안내"}
          />
        </label>
      )}
      <div className="marker-form-actions">
        <Button variant="secondary" onClick={onCancel}>취소</Button>
        <Button variant="primary" disabled={labelEmpty} onClick={onComplete}>완료</Button>
      </div>
    </div>
  );
};
