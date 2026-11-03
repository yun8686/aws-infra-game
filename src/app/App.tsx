import { useEffect, useMemo } from 'react';
import { ProjectScreen } from '../features/projects/ProjectScreen';
import { ProjectsScreen } from '../features/projects/ProjectsScreen';
import { AppStoreContext } from './AppContext';
import { IndexedDbProjectRepository } from './persistence/indexedDbRepository';
import type { ProjectRepository } from './persistence/repository';
import { useRoute } from './router';
import { startAutosave } from './store/autosave';
import { createAppStore } from './store/projectStore';
import './app.css';

/** Side-effecting dependencies live at module scope; the domain never reads the clock itself. */
const systemClock = (): number => Date.now();
const randomId = (): string => crypto.randomUUID();

export function App({ repo }: { readonly repo?: ProjectRepository }) {
  const repository = useMemo(() => repo ?? new IndexedDbProjectRepository(), [repo]);
  const store = useMemo(
    () => createAppStore({ repo: repository, now: systemClock, newId: randomId }),
    [repository],
  );

  useEffect(() => {
    void store.getState().init();
    const autosave = startAutosave(store, repository);
    const flush = () => void autosave.flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      autosave.dispose();
    };
  }, [store, repository]);

  const route = useRoute();
  return (
    <AppStoreContext.Provider value={store}>
      {route.name === 'project' ? <ProjectScreen projectId={route.id} tab={route.tab} /> : <ProjectsScreen />}
    </AppStoreContext.Provider>
  );
}
