import { createContext, useContext } from 'react';
import { useStore, type StoreApi } from 'zustand';
import type { AppState } from './store/projectStore';

export const AppStoreContext = createContext<StoreApi<AppState> | null>(null);

export function useAppStore<T>(selector: (s: AppState) => T): T {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error('AppStoreContext missing');
  return useStore(store, selector);
}

/** The store itself, for calling actions without subscribing to state. */
export function useAppStoreApi(): StoreApi<AppState> {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error('AppStoreContext missing');
  return store;
}
