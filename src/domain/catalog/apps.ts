/**
 * Applications a customer runs (ADR 0016). Servers choose which apps they run; scenarios
 * define each app's traffic. Kept as a small fixed catalog so configs can be validated.
 */
export const APP_IDS = ['shop', 'orders'] as const;
export type AppId = (typeof APP_IDS)[number];

/** The app every single-app scenario and pre-existing config refers to. */
export const DEFAULT_APP: AppId = 'shop';
