import { parseGraphDocument } from '../../domain/graph/schema';
import type { InfrastructureGraph } from '../../domain/graph/types';
import { ecommerceStarterTemplate } from './ecommerce-starter';

export { createBaselineGraph } from './baseline';

const load = (doc: unknown, name: string): InfrastructureGraph => {
  const parsed = parseGraphDocument(doc);
  if (!parsed.ok) throw new Error(`Template "${name}" is malformed: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
};

export const TEMPLATES = {
  'ecommerce-starter': () => load(ecommerceStarterTemplate, 'ecommerce-starter'),
} as const;
export type TemplateId = keyof typeof TEMPLATES;
