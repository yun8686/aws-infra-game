import { parseGraphDocument } from '../../domain/graph/schema';
import type { InfrastructureGraph } from '../../domain/graph/types';
import { ecommerceStarterTemplate } from './ecommerce-starter';

export { createBaselineGraph } from './baseline';

const load = (doc: unknown, name: string): InfrastructureGraph => {
  const parsed = parseGraphDocument(doc);
  if (!parsed.ok) throw new Error(`Template "${name}" is malformed: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
};

/** Mission 2: same starter, but both servers run the shop and order management together. */
const twoAppsTemplate = (): unknown => {
  const doc = structuredClone(ecommerceStarterTemplate) as {
    nodes: Record<string, { serviceType: string; config: Record<string, unknown> }>;
  };
  for (const node of Object.values(doc.nodes)) {
    if (node.serviceType === 'compute.ec2') node.config = { ...node.config, apps: ['shop', 'orders'] };
  }
  return doc;
};

export const TEMPLATES = {
  'ecommerce-starter': () => load(ecommerceStarterTemplate, 'ecommerce-starter'),
  'ecommerce-two-apps': () => load(twoAppsTemplate(), 'ecommerce-two-apps'),
} as const;
export type TemplateId = keyof typeof TEMPLATES;
