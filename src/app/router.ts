import { useSyncExternalStore } from 'react';

export const PROJECT_TABS = ['brief', 'architecture', 'monitor', 'results'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

export type Route =
  | { readonly name: 'projects' }
  | { readonly name: 'project'; readonly id: string; readonly tab: ProjectTab; readonly focus?: string };

/**
 * Hash routes so the browser back button works without a server. The format uses only ASCII
 * letters, digits and hyphens so it also survives hosts that restrict fragments (Claude artifacts):
 *   #projects                       project list
 *   #p--<projectId>--<tab>          project tab
 *   #p--<projectId>--<tab>--<node>  editor focused on a resource
 * Ids may contain single hyphens; `--` is the separator.
 */
const SAFE_ID = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

export const parseRoute = (hash: string): Route => {
  const parts = hash.replace(/^#/, '').split('--');
  if (parts[0] === 'p' && parts[1] && SAFE_ID.test(parts[1])) {
    const tab = (PROJECT_TABS as readonly string[]).includes(parts[2] ?? '')
      ? (parts[2] as ProjectTab)
      : 'brief';
    const focus = parts[3] && SAFE_ID.test(parts[3]) ? parts[3] : undefined;
    return { name: 'project', id: parts[1], tab, ...(focus ? { focus } : {}) };
  }
  return { name: 'projects' };
};

export const routeHref = (route: Route): string =>
  route.name === 'projects'
    ? '#projects'
    : `#p--${route.id}--${route.tab}${route.focus ? `--${route.focus}` : ''}`;

export const navigate = (route: Route, replace = false): void => {
  const href = routeHref(route);
  if (replace) window.location.replace(href);
  else window.location.hash = href;
};

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export const useRoute = (): Route => parseRoute(useSyncExternalStore(subscribe, () => window.location.hash));
