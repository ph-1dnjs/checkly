import type { Json } from "../../../app/api-testing/shared/scenario";

function record(value: Json | undefined): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function ResponseDefinitions({ responses }: { responses: Json }) {
  return <section className="api-response-definitions" aria-label="Responses 응답 명세"><h3>Responses <small>응답 명세</small></h3>
    <table className="api-doc-table"><thead><tr><th>Code</th><th>Description</th></tr></thead><tbody>
      {Object.entries(record(responses)).map(([code, raw]) => {
        const response = record(raw);
        return <tr key={code}><td><code>{code}</code></td><td>
          <p>{typeof response.description === "string" ? response.description : "설명 없음"}</p>
          {Object.entries(record(response.content)).map(([mediaType, rawMedia]) => {
            const media = record(rawMedia);
            return <div key={mediaType}><small>{mediaType}</small>
              {media.example !== undefined && <details><summary>Example Value</summary><pre>{JSON.stringify(media.example, null, 2)}</pre></details>}
              {media.examples !== undefined && <details><summary>Examples</summary><pre>{JSON.stringify(media.examples, null, 2)}</pre></details>}
              {media.schema !== undefined && <details><summary>Schema</summary><pre>{JSON.stringify(media.schema, null, 2)}</pre></details>}
            </div>;
          })}
          {response.headers !== undefined && <details><summary>Headers</summary><pre>{JSON.stringify(response.headers, null, 2)}</pre></details>}
          {response.$ref && <code>{String(response.$ref)}</code>}
        </td></tr>;
      })}
    </tbody></table>
  </section>;
}
