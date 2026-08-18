import { useEffect, useMemo, useState } from 'react'

type Action = 'goto' | 'fill' | 'manualFill' | 'click' | 'select' | 'expectText'
type Step = { id: string; action: Action; target: string; value?: string; required?: boolean; prompt?: string; connected?: boolean }
type Scenario = { id: string; title: string; url: string; steps: Step[] }

declare global {
  interface Window {
    electronAPI?: {
      getAppVersion: () => Promise<string>
      loadScenarioMarkdown?: () => Promise<string | null>
      saveScenarioMarkdown?: (markdown: string) => Promise<void>
      inspectScenario?: (scenario: Scenario) => Promise<Array<{ id: string; connected: boolean }>>
      runQa?: (scenario: Scenario) => Promise<{ status: string; log: string[] }>
      submitManualInput?: (value: string) => Promise<void>
      cancelQa?: () => Promise<void>
      onManualInputRequired?: (callback: (step: Step) => void) => () => void
    }
  }
}

const seed: Scenario = {
  id: 'login-qa', title: '로그인', url: 'https://example.com/login',
  steps: [
    { id: '1', action: 'goto', target: '/login', connected: true },
    { id: '2', action: 'fill', target: '이메일', value: 'qa@example.com', connected: true },
    { id: '3', action: 'manualFill', target: '인증번호', prompt: '인증번호를 입력해 주세요.', required: true, connected: true },
    { id: '4', action: 'click', target: '로그인 버튼', connected: true },
    { id: '5', action: 'expectText', target: '대시보드', connected: false }
  ]
}

const label: Record<Action, string> = { goto: '페이지 이동', fill: '입력', manualFill: '수동 입력', click: '클릭', select: '선택', expectText: '결과 확인' }
const actionText = (step: Step) => step.action === 'manualFill'
  ? `${step.target} 수동 입력${step.prompt ? ` [${step.prompt}]` : ''}`
  : step.action === 'goto' ? `${step.target} 페이지로 이동`
    : step.action === 'fill' ? `${step.target}에 '${step.value || ''}' 입력`
      : step.action === 'select' ? `${step.target}에서 '${step.value || ''}' 선택`
      : `${step.target} ${label[step.action]}`

const markdownFor = (scenario: Scenario) => [
  `# 시나리오: ${scenario.title}`,
  `url: ${scenario.url}`,
  '',
  ...scenario.steps.map((step, i) => `${i === 0 ? 'Given' : 'And'} ${actionText(step)}`)
].join('\n')

const scenarioHeader = /^#{1,3}\s*시나리오:\s*(.+)$|^Scenario:\s*(.+)$/i
const parseMarkdown = (markdown: string): Scenario[] => {
  const blocks = markdown.split(/(?=^#{1,3}\s*시나리오:|^Scenario:)/im).filter(Boolean)
  return blocks.map((block, index) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    const title = lines[0].match(scenarioHeader)?.[1] || lines[0].match(scenarioHeader)?.[2] || `시나리오 ${index + 1}`
    const url = lines.find((line) => line.startsWith('url:'))?.slice(4).trim() || seed.url
    const steps = lines.filter((line) => /^(Given|When|Then|And|But)\s+/i.test(line)).map((line, stepIndex): Step => {
      const text = line.replace(/^(Given|When|Then|And|But)\s+/i, '')
      const manual = text.match(/^(.+?)\s+수동 입력(?:\s*\[(.+)\])?$/)
      const fill = text.match(/^(.+?)에\s+'(.*)'\s+입력/)
      const select = text.match(/^(.+?)에서\s+'(.*)'\s+선택/)
      if (manual) return { id: String(stepIndex + 1), action: 'manualFill', target: manual[1], prompt: manual[2], required: true, connected: true }
      if (fill) return { id: String(stepIndex + 1), action: 'fill', target: fill[1], value: fill[2], connected: true }
      if (select) return { id: String(stepIndex + 1), action: 'select', target: select[1], value: select[2], connected: true }
      if (text.includes('페이지로 이동')) return { id: String(stepIndex + 1), action: 'goto', target: text.replace(/\s+페이지로 이동.*/, ''), connected: true }
      if (text.includes('보인다')) return { id: String(stepIndex + 1), action: 'expectText', target: text.replace(/\s+텍스트가 보인다.*/, ''), connected: false }
      return { id: String(stepIndex + 1), action: 'click', target: text.replace(/\s+(버튼을 )?클릭.*/, ''), connected: true }
    })
    return { id: `scenario-${index}`, title, url, steps }
  })
}
const replaceScenarioBlock = (markdown: string, title: string, replacement: string): string => {
  const starts = [...markdown.matchAll(/^#{1,3}\s*시나리오:\s*(.+)$|^Scenario:\s*(.+)$/gim)]
  const matchIndex = starts.findIndex((match) => (match[1] || match[2])?.trim() === title)
  if (matchIndex < 0) return `${markdown.trim()}\n\n${replacement}`
  const start = starts[matchIndex].index ?? 0
  const end = starts[matchIndex + 1]?.index ?? markdown.length
  return `${markdown.slice(0, start)}${replacement}\n\n${markdown.slice(end).trimStart()}`.trim()
}
const initialMarkdown = `${markdownFor(seed)}\n\n# 시나리오: 주문 조회\nurl: https://example.com/orders\n\nGiven /orders 페이지로 이동한다\nThen 주문 목록 텍스트가 보인다`

export const App = (): JSX.Element => {
  const [version, setVersion] = useState('…')
  const [scenario, setScenario] = useState<Scenario>(seed)
  const [sourceMarkdown, setSourceMarkdown] = useState(initialMarkdown)
  const [page, setPage] = useState<'scenarios' | 'editor' | 'run'>('scenarios')
  const [selectedId, setSelectedId] = useState('3')
  const [editing, setEditing] = useState<Step | null>(null)
  const [manual, setManual] = useState<Step | null>(null)
  const [manualValue, setManualValue] = useState('')
  const [running, setRunning] = useState(false)
  const [runLog, setRunLog] = useState<string[]>([])
  const [notice, setNotice] = useState('')

  useEffect(() => { window.electronAPI?.getAppVersion().then(setVersion) }, [])
  useEffect(() => {
    const restore = (stored: string | null): void => {
      if (!stored) return
      setSourceMarkdown(stored)
      const [first] = parseMarkdown(stored)
      if (first) setScenario(first)
    }
    if (window.electronAPI?.loadScenarioMarkdown) { window.electronAPI.loadScenarioMarkdown().then(restore); return }
    restore(window.localStorage.getItem('autoqa-scenarios'))
  }, [])
  useEffect(() => window.electronAPI?.onManualInputRequired?.((step) => {
    setManual(step); setRunLog((logs) => [...logs, `단계 ${step.id}: ${step.target} 수동 입력 대기`])
  }), [])
  useEffect(() => {
    if (page !== 'editor' || !window.electronAPI?.inspectScenario) return
    window.electronAPI.inspectScenario(scenario).then((matches) => {
      updateSteps(scenario.steps.map((step) => ({ ...step, connected: matches.find((match) => match.id === step.id)?.connected ?? false })))
    }).catch(() => setNotice('대상 페이지를 확인하지 못했습니다. 기존 연결 정보를 유지합니다.'))
  // 마커 편집 진입 시점의 연결 상태만 재검사한다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])
  const selected = useMemo(() => scenario.steps.find((s) => s.id === selectedId), [scenario.steps, selectedId])
  const persistScenario = async () => {
    const next = replaceScenarioBlock(sourceMarkdown, scenario.title, markdownFor(scenario))
    setSourceMarkdown(next)
    if (window.electronAPI?.saveScenarioMarkdown) await window.electronAPI.saveScenarioMarkdown(next)
    else window.localStorage.setItem('autoqa-scenarios', next)
    setNotice('변경사항을 기존 시나리오 블록에 저장했습니다.')
  }
  const loadMarkdown = async () => {
    const scenarios = parseMarkdown(sourceMarkdown)
    if (!scenarios.length) { setNotice('불러올 수 있는 시나리오 제목과 단계를 확인해 주세요.'); return }
    setScenario(scenarios[0]); setSelectedId(scenarios[0].steps[0]?.id ?? '')
    if (window.electronAPI?.saveScenarioMarkdown) await window.electronAPI.saveScenarioMarkdown(sourceMarkdown)
    else window.localStorage.setItem('autoqa-scenarios', sourceMarkdown)
    setNotice(`${scenarios.length}개 시나리오를 불러왔습니다. 첫 시나리오를 마커로 편집할 수 있습니다.`)
  }
  const updateSteps = (steps: Step[]) => setScenario((current) => ({ ...current, steps: steps.map((s, i) => ({ ...s, id: String(i + 1) })) }))
  const deleteStep = (id: string) => {
    updateSteps(scenario.steps.filter((step) => step.id !== id))
    setSelectedId(String(Math.max(1, Number(id) - 1)))
  }
  const saveStep = () => {
    if (!editing) return
    updateSteps(scenario.steps.map((step) => step.id === editing.id ? editing : step))
    setEditing(null)
  }
  const addStep = () => {
    const next: Step = { id: String(scenario.steps.length + 1), action: 'click', target: '새 요소', connected: true }
    updateSteps([...scenario.steps, next]); setSelectedId(next.id); setEditing(next)
  }
  const beginRun = async () => {
    setPage('run'); setRunning(true); setRunLog(['기본 URL 상태 점검 완료', '시나리오 실행을 시작했습니다.'])
    if (window.electronAPI?.runQa) {
      window.electronAPI.runQa(scenario).then((result) => {
        setRunLog((logs) => [...logs, ...result.log, result.status === 'passed' ? '시나리오 통과' : result.status === 'cancelled' ? '실행 취소됨' : '실행 실패'])
        setRunning(false)
      })
      return
    }
    const manualStep = scenario.steps.find((step) => step.action === 'manualFill')
    if (manualStep) { setTimeout(() => { setManual(manualStep); setRunLog((logs) => [...logs, `단계 ${manualStep.id}: ${manualStep.target} 수동 입력 대기`]) }, 450); return }
    await finishRun()
  }
  const finishRun = async () => {
    const result = await window.electronAPI?.runQa?.(scenario)
    setRunLog((logs) => [...logs, ...(result?.log ?? ['단계 실행 완료']), result?.status === 'failed' ? '실행 실패' : '시나리오 통과'])
    setRunning(false)
  }
  const continueManual = async () => {
    if (!manual || (manual.required && !manualValue.trim())) return
    await window.electronAPI?.submitManualInput?.(manualValue)
    setRunLog((logs) => [...logs, `단계 ${manual.id}: ${manual.target} 수동 입력 — 완료`])
    setManualValue(''); setManual(null)
    if (!window.electronAPI?.runQa) await finishRun()
  }
  const cancelRun = async () => {
    await window.electronAPI?.cancelQa?.(); setManual(null); setRunning(false)
    setRunLog((logs) => [...logs, '실행이 취소되었습니다. 이후 단계는 실행하지 않았습니다.'])
  }

  return <main className="workspace">
    <header className="workspace-header"><a className="brand" href="#" onClick={() => setPage('scenarios')}><span className="brand-mark">◒</span>AutoQA</a><span className="header-status"><i /> 로컬 실행 준비됨</span><span className="version">v{version}</span></header>
    <div className="workspace-body">
      <aside className="sidebar"><button className={page === 'scenarios' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('scenarios')}>▦ 시나리오</button><button className={page === 'editor' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('editor')}>⌖ 화면 추출</button><button className={page === 'run' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('run')}>▷ 실행 콘솔</button><div className="sidebar-bottom">대상 URL<br /><strong>{scenario.url}</strong></div></aside>
      <section className="content">
        {page === 'scenarios' && <>
          <div className="page-title"><div><p className="eyebrow">SCENARIO LIBRARY</p><h1>시나리오</h1><p>저장된 흐름을 불러와 텍스트 또는 화면 마커로 수정합니다.</p></div><button className="button button-primary" onClick={() => setPage('editor')}>+ 시나리오 작성</button></div>
          <article className="scenario-card"><div className="scenario-icon">✓</div><div className="scenario-info"><span className="tag">custom</span><h2>{scenario.title}</h2><p>{scenario.steps.length}개 단계 · 마지막 수정됨: 방금 전</p></div><div className="scenario-actions"><button className="button button-secondary" onClick={() => setPage('editor')}>마커 편집</button><button className="button button-primary" onClick={beginRun}>실행</button></div></article>
          <section className="markdown-panel"><div className="panel-heading"><h2>시나리오 미리보기</h2><button className="text-button" onClick={() => navigator.clipboard?.writeText(markdownFor(scenario))}>복사</button></div><pre>{markdownFor(scenario)}</pre></section>
          <section className="markdown-panel"><div className="panel-heading"><h2>Markdown 불러오기</h2><button className="text-button" onClick={loadMarkdown}>적용 후 마커 편집</button></div><textarea className="markdown-source" value={sourceMarkdown} onChange={(event) => setSourceMarkdown(event.target.value)} aria-label="시나리오 Markdown 원본" /></section>
        </>}
        {page === 'editor' && <>
          <div className="page-title compact"><div><p className="eyebrow">MARKER EDITOR</p><h1>{scenario.title} 마커 편집</h1><p>복원된 마커를 선택해 액션과 순서를 수정하세요.</p></div><div><button className="button button-secondary" onClick={() => { updateSteps([]); setSelectedId('') }}>전체 초기화</button> <button className="button button-primary" onClick={async () => { await persistScenario(); setPage('scenarios') }}>변경사항 저장</button></div></div>
          {notice && <div className="notice">✓ {notice}</div>}
          <div className="editor-grid"><section className="browser-canvas"><div className="browser-bar"><span>● ● ●</span><input value={scenario.url} onChange={(e) => setScenario({ ...scenario, url: e.target.value })} aria-label="대상 URL" /></div><div className="mock-page"><webview className="target-frame" src={scenario.url} aria-label="시나리오 대상 페이지" /><div className="page-fallback"><div className="mock-logo">Electron 대상 페이지</div><p>데스크톱 웹뷰에서 대상 URL을 열었습니다. 연결 상태는 Playwright로 확인합니다.</p></div>{scenario.steps.map((step) => step.connected && <button key={step.id} className={'marker marker-' + step.id + (selectedId === step.id ? ' selected' : '')} onClick={() => setSelectedId(step.id)} aria-label={`${step.id}번 ${step.target} 마커`}>{step.id}</button>)}</div></section>
          <aside className="step-panel"><div className="panel-heading"><h2>실행 단계</h2><span>{scenario.steps.length}개</span></div><ol className="step-list">{scenario.steps.map((step) => <li key={step.id} className={selectedId === step.id ? 'selected' : ''}><button onClick={() => setSelectedId(step.id)}><b>{step.id}</b><span><strong>{label[step.action]}</strong>{step.target}<small>{step.connected ? '연결됨' : '미연결 단계'}</small></span></button><button className="delete-button" onClick={() => deleteStep(step.id)} aria-label={`${step.id}번 단계 삭제`}>×</button></li>)}</ol><button className="add-step" onClick={addStep}>+ 새 마커 추가</button><button className="button button-secondary full" onClick={() => updateSteps(scenario.steps.slice(0, -1))}>마지막 마커 삭제</button></aside></div>
          {selected && <section className="step-editor"><div><p className="eyebrow">SELECTED MARKER · {selected.id}</p><h2>{selected.target}</h2></div><div className="edit-controls"><label>액션<select value={editing?.action ?? selected.action} onChange={(e) => setEditing({ ...(editing ?? selected), action: e.target.value as Action })}>{Object.entries(label).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label><label>라벨<input value={editing?.target ?? selected.target} onChange={(e) => setEditing({ ...(editing ?? selected), target: e.target.value })} /></label>{['fill', 'select'].includes(editing?.action ?? selected.action) && <label>값<input value={editing?.value ?? selected.value ?? ''} onChange={(e) => setEditing({ ...(editing ?? selected), value: e.target.value })} /></label>}{(editing?.action ?? selected.action) === 'manualFill' && <><label>안내 문구<input value={editing?.prompt ?? selected.prompt ?? ''} onChange={(e) => setEditing({ ...(editing ?? selected), prompt: e.target.value })} /></label><label className="toggle">필수<input type="checkbox" checked={editing?.required ?? selected.required ?? false} onChange={(e) => setEditing({ ...(editing ?? selected), required: e.target.checked })} /></label></>}<label>연결 상태<select value={String(editing?.connected ?? selected.connected ?? false)} onChange={(e) => setEditing({ ...(editing ?? selected), connected: e.target.value === 'true' })}><option value="true">연결됨</option><option value="false">미연결 단계 유지</option></select></label><button className="button button-secondary" onClick={() => { updateSteps(scenario.steps.map((step) => step.id === selected.id ? { ...step, connected: true } : step)); setEditing(null) }}>현재 요소에 재연결</button><button className="button button-primary" onClick={() => { if (editing) saveStep(); else setEditing(selected) }}>{editing ? '수정 완료' : '수정'}</button></div></section>}
        </>}
        {page === 'run' && <>
          <div className="page-title"><div><p className="eyebrow">RUN CONSOLE</p><h1>QA 실행</h1><p>{running ? '브라우저 상태를 유지하며 실행 중입니다.' : '실행할 시나리오를 선택하세요.'}</p></div>{running ? <button className="button danger" onClick={cancelRun}>실행 취소</button> : <button className="button button-primary" onClick={beginRun}>▶ 실행 시작</button>}</div>
          <div className="run-layout"><section className="run-main"><div className="run-state"><span className={running ? 'pulse' : 'check'}>{running ? '◌' : '✓'}</span><div><strong>{manual ? '수동 입력 대기 중' : running ? '시나리오 실행 중' : '실행 준비됨'}</strong><p>{manual ? `${manual.target} 값을 기다리고 있습니다.` : `${scenario.title} · ${scenario.steps.length}개 단계`}</p></div></div><div className="progress"><span style={{ width: running ? '58%' : '100%' }} /></div><div className="log-box" aria-live="polite">{runLog.length ? runLog.map((log, i) => <p key={i}><time>{String(i + 9).padStart(2, '0')}:24</time>{log}</p>) : <p className="muted">실행 로그가 여기에 표시됩니다.</p>}</div></section><aside className="run-side"><h2>실행 설정</h2><label>브라우저<select><option>Chromium</option><option>Firefox</option></select></label><label>워커 수<select><option>1</option></select></label><label className="toggle"><input type="checkbox" defaultChecked /> 헤드리스 실행</label><label className="toggle"><input type="checkbox" /> 실패 즉시 중단</label></aside></div>
        </>}
      </section>
    </div>
    {manual && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="manual-title"><div className="manual-modal"><span className="manual-icon">⌨</span><p className="eyebrow">EXECUTION PAUSED · STEP {manual.id}</p><h2 id="manual-title">수동 입력이 필요합니다</h2><p>{manual.prompt || `${manual.target}를 입력해 주세요.`}</p><label>{manual.target}<input autoFocus type="password" value={manualValue} onChange={(e) => setManualValue(e.target.value)} placeholder="입력값" onKeyDown={(e) => e.key === 'Enter' && continueManual()} /></label><p className="security-note">입력값은 이번 실행에만 사용되며 시나리오, 로그, 리포트에 저장되지 않습니다.</p><div className="modal-actions"><button className="button button-secondary" onClick={cancelRun}>실행 취소</button><button className="button button-primary" onClick={continueManual} disabled={manual.required && !manualValue.trim()}>입력 후 계속</button></div></div></div>}
  </main>
}
