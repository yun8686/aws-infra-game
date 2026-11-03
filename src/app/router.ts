import { useSyncExternalStore } from 'react';

export const PROJECT_TABS = ['brief', 'architecture', 'monitor', 'results'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

export type Route =
  { readonly name: 'projects' } | { readonly name: 'project'; readonly id: string; readonly tab: ProjectTab };

/** Hash routes so the browser back button works without a server: #/ and #/p/<id>/<tab>. */
export const parseRoute = (hash: string): Route => {
  const m = /^#\/p\/([^/]+)(?:\/([a-z]+))?$/.exec(hash);
  if (m?.[1]) {
    const tab = (PROJECT_TABS as readonly string[]).includes(m[2] ?? '') ? (m[2] as ProjectTab) : 'brief';
    return { name: 'project', id: decodeURIComponent(m[1]), tab };
  }
  return { name: 'projects' };
};

export const routeHref = (route: Route): string =>
  route.name === 'projects' ? '#/' : `#/p/${encodeURIComponent(route.id)}/${route.tab}`;

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
