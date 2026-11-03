/**
 * Headless simulation runner for balancing and debugging.
 *   npm run sim -- [--template ecommerce-starter] [--scenario tv-spike] [--seed 1] [--set node.path=value ...] [--json]
 *   npm run sim -- --mission tv-spike [--set ...]   (uses the mission's template, scenario and seed, then evaluates)
 * Example: npm run sim -- --set web-1.size=large --set db-1.instanceClass=db.large
 */
import {
  MISSIONS,
  SCENARIOS,
  TEMPLATES,
  type MissionId,
  type ScenarioId,
  type TemplateId,
} from '../src/content';
import { evaluateMission } from '../src/game';
import { updateConfig } from '../src/model';
import { simulate } from '../src/sim';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const sets = args.flatMap((a, i) => (a === '--set' && args[i + 1] ? [args[i + 1] as string] : []));

const missionId = opt('mission', '') as MissionId | '';
const mission = missionId ? MISSIONS[missionId] : undefined;
const templateId = (
  mission?.initialDiagram.kind === 'template'
    ? mission.initialDiagram.templateId
    : opt('template', 'ecommerce-starter')
) as TemplateId;
const scenarioId = (mission?.scenarioId ?? opt('scenario', 'tv-spike')) as ScenarioId;
const seed = mission?.seed ?? Number(opt('seed', '1'));

let diagram = TEMPLATES[templateId]();
for (const s of sets) {
  const [lhs, raw] = s.split('=') as [string, string];
  const [nodeId, ...path] = lhs.split('.');
  const node = nodeId ? (diagram.resources[nodeId] ?? diagram.links[nodeId]) : undefined;
  if (!node || path.length === 0) throw new Error(`Bad --set ${s}`);
  const config = structuredClone(node.config) as Record<string, unknown>;
  let cursor = config;
  for (const key of path.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
  const value =
    raw === 'true' ? true : raw === 'false' ? false : Number.isNaN(Number(raw)) ? raw : Number(raw);
  cursor[path[path.length - 1] as string] = value;
  const r = updateConfig(diagram, node.id, config);
  if (!r.ok) throw new Error(`Rejected ${s}: ${r.finding.code}`);
  diagram = r.diagram;
}

const result = simulate({ diagram, scenario: SCENARIOS[scenarioId], seed });
if (!result.ok) {
  console.error(JSON.stringify(result.error, null, 2));
  process.exit(1);
}
const r = result.value;
if (args.includes('--json')) {
  console.log(JSON.stringify(r, null, 2));
} else {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`scenario=${r.scenarioId} seed=${r.seed} hash=${r.inputHash}`);
  console.log(
    `errorRate=${pct(r.summary.errorRate)} peakErrorRate=${pct(r.summary.peakErrorRate)} ` +
      `availability=${pct(r.summary.availability)} meanLatency=${r.summary.meanLatencyMs.toFixed(0)}ms ` +
      `p95Latency=${r.summary.p95LatencyMs.toFixed(0)}ms`,
  );
  console.log(
    `cost: run=${r.cost.runCost.toFixed(1)}cr hourly=${r.cost.baselineHourly.toFixed(1)}cr ` +
      `monthly≈${r.cost.projectedMonthly.toFixed(0)}cr`,
  );
  for (const b of r.bottlenecks.slice(0, 8)) {
    console.log(
      `  ${b.cause.padEnd(26)} ${b.nodeIds.join(',').padEnd(10)} min ${b.startMinute}-${b.endMinute} ` +
        `peak=${b.peak.toFixed(2)} failed=${b.failedRequests.toFixed(0)}`,
    );
  }
}

if (mission && !args.includes('--json')) {
  const e = evaluateMission(mission, r);
  console.log(`mission ${mission.id}: ${e.passed ? 'PASSED' : 'FAILED'} score=${e.overallScore}`);
  for (const d of e.dimensions) {
    const checks = d.checks
      .map((c) => `${c.metric}=${c.actual.toFixed(3)} ${c.comparator} ${c.target}`)
      .join(', ');
    console.log(
      `  ${d.dimension.padEnd(13)} ${d.passed ? 'pass' : 'FAIL'} ${String(d.score).padStart(3)}  ${checks}`,
    );
  }
  if (e.learningTopics.length > 0) console.log(`  topics: ${e.learningTopics.join(', ')}`);
}
