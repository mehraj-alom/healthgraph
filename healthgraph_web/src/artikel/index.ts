import { ARTIKEL_A } from './artikel_a';
import { ARTIKEL_B } from './artikel_b';
import { ARTIKEL_C } from './artikel_c';
import { ARTIKEL_D } from './artikel_d';
import { ARTIKEL_E } from './artikel_e';
import type { Artikel } from './artikel_a';

export const ARTIKEL: Artikel[] = [...ARTIKEL_A, ...ARTIKEL_B, ...ARTIKEL_C, ...ARTIKEL_D, ...ARTIKEL_E];
export type { Artikel };
