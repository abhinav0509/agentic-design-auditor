// `pnpm demo`: a local-only page over the demo pipeline. Listens on 127.0.0.1; nothing is persisted.
import { DomainError } from '@beacon/core';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import {
  afterHtml,
  closeBrowser,
  decideOn,
  listCases,
  pageHtml,
  reviseValue,
  runCase,
  SCENARIOS,
  type Scenario,
} from './pipeline.ts';

const PORT = Number(process.env.PORT ?? 4173);
const INDEX = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
// Previews are untrusted pages: no scripts, no network, sandboxed iframe on the client side too.
const PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

const isScenario = (s: unknown): s is Scenario => typeof s === 'string' && s in SCENARIOS;

async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) raw += String(chunk);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string') throw new Error(`${name} must be a string`);
  return v;
};

async function route(req: http.IncomingMessage): Promise<[number, string, string]> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const json = (v: unknown): [number, string, string] => [
    200,
    'application/json',
    JSON.stringify(v),
  ];
  if (req.method === 'GET' && url.pathname === '/') return [200, 'text/html', INDEX];
  if (req.method === 'GET' && url.pathname === '/api/cases')
    return json({ cases: listCases(), scenarios: SCENARIOS });
  if (req.method === 'GET' && url.pathname === '/preview') {
    const scenario = url.searchParams.get('scenario');
    const html = url.searchParams.has('run')
      ? afterHtml(url.searchParams.get('run') ?? '')
      : pageHtml(url.searchParams.get('case') ?? '', isScenario(scenario) ? scenario : 'fix');
    return [200, 'text/html', html ?? 'no fixed page for this run'];
  }
  if (req.method === 'POST' && url.pathname === '/api/run') {
    const b = await body(req);
    if (!isScenario(b.scenario)) throw new Error('unknown scenario');
    return json(await runCase(str(b.caseId, 'caseId'), b.scenario));
  }
  if (req.method === 'POST' && url.pathname === '/api/decide') {
    const b = await body(req);
    const base = { key: str(b.key, 'key'), expectedVersion: Number(b.expectedVersion) };
    const input =
      b.action === 'approve'
        ? { action: 'approve' as const, ...base }
        : b.action === 'reject'
          ? { action: 'reject' as const, ...base, reason: str(b.reason ?? '', 'reason') }
          : { action: 'answer' as const, ...base, answer: str(b.answer, 'answer') };
    return json(decideOn(str(b.runId, 'runId'), input));
  }
  if (req.method === 'POST' && url.pathname === '/api/revise') {
    const b = await body(req);
    return json(reviseValue(str(b.runId, 'runId'), str(b.value, 'value')));
  }
  return [404, 'text/plain', 'not found'];
}

const server = http.createServer((req, res) => {
  route(req).then(
    ([status, type, text]) => {
      const headers: Record<string, string> = { 'content-type': `${type}; charset=utf-8` };
      if (req.url?.startsWith('/preview')) headers['content-security-policy'] = PREVIEW_CSP;
      res.writeHead(status, headers).end(text);
    },
    (e: unknown) => {
      const error = e instanceof DomainError ? e.code : e instanceof Error ? e.message : String(e);
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error }));
    },
  );
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Beacon demo: http://localhost:${String(PORT)}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    server.close();
    void closeBrowser().finally(() => process.exit(0));
  });
