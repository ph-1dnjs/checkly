# 병렬 작업과 작은 커밋

작업자마다 별도 브랜치와 작업 디렉터리를 사용합니다. 같은 checkout을 공유하면 다른 작업자의 변경사항이 함께 스테이징될 수 있습니다.

```bash
git fetch origin
git worktree add ../checkly-my-feature -b codex/my-feature origin/main
```

`origin/main`은 실제 PR 대상 브랜치에 맞춥니다. 이미 진행 중인 작업은 현재 브랜치에서 마무리하고 다음 작업부터 분리합니다.

## 수정 범위

- 시나리오 복제 UI와 스타일: `src/renderer/pages/editor/DuplicateScenarioModal.tsx`, `duplicate-scenario.css`
- 복제 값 변환과 이름 생성: `src/renderer/shared/model/scenario-duplication.ts`
- 공통 액션 표시: `src/renderer/shared/ui/ActionTag.tsx`
- 기능별 테스트: `tests/<feature>.spec.ts`

새 기능은 해당 기능의 파일에 구현하고 `App.tsx`, `ScenarioEditorPage.tsx`, 공통 모델과 전역 CSS 수정은 연결에 필요한 범위로 제한합니다. 같은 파일을 수정해야 하면 담당 범위를 먼저 맞춥니다. 기능 변경에 전체 포맷팅이나 관계없는 정리를 섞지 않습니다. 의존성을 바꿀 때만 `package.json`과 `package-lock.json`을 함께 커밋합니다.

## 커밋과 통합

1. `git diff`로 변경을 확인하고 파일 또는 `git add -p`로 하나의 목적만 스테이징합니다.
2. `git diff --cached`와 `git diff --cached --check`로 누락·불필요한 변경을 확인합니다.
3. 각 커밋은 필요한 코드·스타일·관련 테스트를 포함하고, 뒤에 올 커밋 없이도 빌드할 수 있게 만듭니다.
4. PR 전에 `git fetch origin` 후 대상 브랜치를 통합합니다. 개인 브랜치의 미공유 커밋은 rebase할 수 있고, 여러 사람이 사용하는 브랜치는 merge로 통합해 공유 이력을 보존합니다.
5. 충돌은 양쪽 변경 의도를 확인해 해결하고 아래 검증을 다시 실행합니다. 공유 브랜치에는 강제 push하지 않습니다.

```bash
npx tsc --noEmit --types node,electron
npm run build
npm test
git diff --check
```

renderer 타입 검사에는 `Electron.WebviewTag`에 필요한 Electron 타입을 명시합니다. GitHub의 `CI / verify` 작업도 동일한 타입 검사·빌드·브라우저 테스트를 수행합니다. 병합 전 통과를 강제하려면 저장소 관리자가 대상 브랜치 보호 규칙에서 이 검사를 필수로 지정해야 합니다.

파일 분리와 CI는 텍스트 충돌 및 동작 회귀 위험을 줄입니다. 동일한 코드 구간을 동시에 바꾸는 충돌까지 자동으로 방지하지는 않습니다.
