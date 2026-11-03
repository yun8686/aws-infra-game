import type { AppId } from '../catalog/apps';
import type { ConnectionId, NodeId } from '../graph/types';
import type { Bottleneck, BottleneckCause } from './types';

/** One observation of pressure or failure within a single step. */
export interface StepIssue {
  readonly cause: BottleneckCause;
  readonly nodeIds: readonly NodeId[];
  readonly connectionIds: readonly ConnectionId[];
  /** Failed requests per second attributed to this cause in the step. */
  readonly failedRps: number;
  readonly pressure: number;
  /** Applications whose requests this concerns (empty = node-level, e.g. high utilization). */
  readonly appIds: readonly AppId[];
}

const CAUSE_ORDER: readonly BottleneckCause[] = [
  'sg_blocked',
  'no_database',
  'db_unavailable',
  'compute_unavailable',
  'no_healthy_targets',
  'unhealthy_target',
  'db_connections',
  'db_capacity',
  'compute_saturated',
  'db_high_utilization',
  'compute_high_utilization',
];

/**
 * Merge per-step issues into windows per (cause, nodes, connections), most impactful first.
 * Windows separated by at most `gapSteps` quiet steps are merged so that workload noise does not
 * fragment one episode into many.
 */
export const aggregateBottlenecks = (
  issuesByStep: readonly (readonly StepIssue[])[],
  stepSec: number,
  gapSteps = 2,
): Bottleneck[] => {
  const open = new Map<string, { b: Bottleneck; lastStep: number }>();
  const closed: Bottleneck[] = [];
  issuesByStep.forEach((issues, step) => {
    for (const issue of issues) {
      const key = `${issue.cause}|${issue.nodeIds.join(',')}|${issue.connectionIds.join(',')}|${issue.appIds.join(',')}`;
      const current = open.get(key);
      const failed = issue.failedRps * stepSec;
      if (current && step - current.lastStep <= gapSteps + 1) {
        current.b = {
          ...current.b,
          endMinute: (step * stepSec) / 60,
          peak: Math.max(current.b.peak, issue.pressure),
          failedRequests: current.b.failedRequests + failed,
        };
        current.lastStep = step;
      } else {
        if (current) closed.push(current.b);
        open.set(key, {
          lastStep: step,
          b: {
            cause: issue.cause,
            nodeIds: issue.nodeIds,
            connectionIds: issue.connectionIds,
            appIds: issue.appIds,
            startMinute: (step * stepSec) / 60,
            endMinute: (step * stepSec) / 60,
            peak: issue.pressure,
            failedRequests: failed,
          },
        });
      }
    }
  });
  for (const { b } of open.values()) closed.push(b);
  return closed.sort(
    (a, b) =>
      b.failedRequests - a.failedRequests ||
      CAUSE_ORDER.indexOf(a.cause) - CAUSE_ORDER.indexOf(b.cause) ||
      a.startMinute - b.startMinute ||
      (a.nodeIds.join() < b.nodeIds.join() ? -1 : 1),
  );
};
