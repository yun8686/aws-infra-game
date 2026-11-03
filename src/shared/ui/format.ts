const nf = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });

export const credits = (n: number): string => `${nf.format(Math.round(n))} cr`;
export const percent = (x: number, digits = 1): string => `${(x * 100).toFixed(digits)}%`;
export const ms = (n: number): string => `${nf.format(Math.round(n))} ms`;
