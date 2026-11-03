/**
 * Game-balance numbers (see docs/SIMULATION_MODEL.md).
 * These are teaching assumptions, NOT AWS capacity or pricing data.
 */
export const BALANCE = {
  version: 1,
  instance: {
    small: { capacityRps: 50, costPerHour: 1 },
    medium: { capacityRps: 100, costPerHour: 2 },
    large: { capacityRps: 200, costPerHour: 4 },
    xlarge: { capacityRps: 400, costPerHour: 8 },
  },
  database: {
    'db.small': { capacityQps: 300, maxConnections: 60, costPerHour: 3 },
    'db.medium': { capacityQps: 600, maxConnections: 120, costPerHour: 6 },
    'db.large': { capacityQps: 1200, maxConnections: 250, costPerHour: 12 },
    'db.xlarge': { capacityQps: 2400, maxConnections: 500, costPerHour: 24 },
  },
  provisionedStorage: { capacityMultiplier: 1.5, costMultiplier: 1.5 },
  multiAzCostMultiplier: 2,
  alb: { costPerHour: 2 },
  cloudWatch: { costPerHour: 0.5, costPerAlarmHour: 0.1 },
  latency: {
    albMs: 5,
    computeMs: 30,
    dbPerQueryMs: 4,
    timeoutMs: 5000,
    maxUtilizationForQueueing: 0.9,
  },
  queueSeconds: 5,
  highUtilization: 0.85,
  availabilityErrorRateThreshold: 0.05,
  hoursPerMonth: 730,
} as const;
