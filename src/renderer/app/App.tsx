import { useEffect, useState } from 'react'

declare global {
  interface Window {
    electronAPI: {
      getAppVersion: () => Promise<string>
    }
  }
}

export const App = (): JSX.Element => {
  const [version, setVersion] = useState('…')

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setVersion)
  }, [])

  return (
    <main>
      <p className="eyebrow">Electron · React · Playwright</p>
      <h1>Checkly</h1>
      <p>브라우저 QA 데스크톱 앱의 기본 환경이 준비되었습니다.</p>
      <p className="version">v{version}</p>
    </main>
  )
}
