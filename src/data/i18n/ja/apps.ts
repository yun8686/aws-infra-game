import type { AppId } from '../../../domain/catalog/apps';

export const APP_TEXT_JA: { readonly [K in AppId]: { readonly name: string; readonly short: string } } = {
  shop: { name: 'ショップ画面', short: 'ショップ' },
  orders: { name: '受注管理', short: '受注' },
};

export const appName = (id: string): string => (id in APP_TEXT_JA ? APP_TEXT_JA[id as AppId].name : id);
