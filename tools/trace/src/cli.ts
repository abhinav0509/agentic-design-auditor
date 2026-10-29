// Usage: node tools/trace/src/cli.ts <vitest.json> <requirements.yaml>
import { readFileSync } from 'node:fs';
import { coveredIds, parseRegistry, uncovered, unknownIds } from './trace.ts';

const [reportPath, registryPath] = process.argv.slice(2);
if (!reportPath || !registryPath) {
  console.error('usage: trace <vitest.json> <requirements.yaml>');
  process.exit(2);
}

const registry = parseRegistry(readFileSync(registryPath, 'utf8'));
const covered = coveredIds(JSON.parse(readFileSync(reportPath, 'utf8')));
const missing = uncovered(registry, covered);
const unknown = unknownIds(registry, covered);

for (const r of missing)
  console.error(`missing test: ${r.id} (phase ${String(r.phase)}) ${r.text}`);
for (const id of unknown) console.error(`unknown requirement id in tests: ${id}`);

const inPhase = registry.requirements.filter((r) => r.phase <= registry.currentPhase).length;
console.log(
  `trace: phase ${String(registry.currentPhase)}, ${String(inPhase - missing.length)}/${String(inPhase)} in-phase requirements covered`,
);
if (missing.length > 0 || unknown.length > 0) process.exitCode = 1;
