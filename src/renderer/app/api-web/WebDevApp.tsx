import { useState } from "react";
import { ApiTestingPage } from "../../pages/api-testing/ApiTestingPage";
import { webBridge } from "./web-bridge";
import { BottomNavigation } from "../../widgets/BottomNavigation";
import type { ApiRunAction } from "../../pages/api-testing/useRunAction";

export function WebDevApp() {
  const [action, setAction] = useState<ApiRunAction | null>(null);
  const [notice, setNotice] = useState("");
  return <main className="workspace">
    <section className="content">
      <p className="api-web-dev-banner" role="status">웹 개발 모드 · 앱 데이터와 별도 저장 · 계정 기억 미지원 {notice}</p>
      <ApiTestingPage bridge={webBridge} onRunAction={setAction} />
    </section>
    <BottomNavigation route="api-testing" running={false} apiRunAction={action}
      onNavigate={route => setNotice(route === "api-testing" ? "" : "· 이 메뉴는 Electron 앱에서 사용할 수 있습니다.")}
      onRun={() => action?.run()} onCancel={() => {}} />
  </main>;
}
