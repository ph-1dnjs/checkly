import type { Scenario } from "../../shared/model/scenario";

type Props = { scenarios: Scenario[]; onCreate: () => void; onEdit: (scenario: Scenario) => void; onRun: (scenario: Scenario) => void };

export const ScenarioLibraryPage = ({ scenarios, onCreate, onEdit, onRun }: Props) => (
  <>
    <div className="page-title library-title"><div><p className="eyebrow">SCENARIO LIBRARY</p><h1>시나리오</h1></div><button className="button button-primary" onClick={onCreate}>+ 새 시나리오</button></div>
    <div className="library-filters"><button className="active">전체 <span>{scenarios.length}</span></button><button>최근 수정</button><span>RECENT</span></div>
    <section className="scenario-library-list" aria-label="시나리오 목록">
      {scenarios.map((scenario, index) => (
        <article key={scenario.id}>
          <div className="library-name"><strong>{scenario.title}</strong><small>{scenario.title}.md · {scenario.url}</small></div>
          <div className="library-tape" aria-hidden="true">{Array.from({ length: 8 }, (_, tapeIndex) => <i key={tapeIndex} className={tapeIndex === index % 8 ? "pending" : ""} />)}</div>
          <span className="library-steps">{scenario.steps.length}개 단계</span>
          <span className="library-updated">방금 전</span>
          <div className="library-actions"><button onClick={() => onEdit(scenario)}>편집</button><button aria-label={`${scenario.title} 실행`} onClick={() => onRun(scenario)}>▷</button></div>
        </article>
      ))}
    </section>
  </>
);
