import type { SopDocumentId } from '@orbit/contracts';

import type { SopDocumentRow } from '../schema';

export interface SopDocumentRecord {
  readonly id: SopDocumentId;
  readonly title: string;
  /** Exactly what the user originally wrote. */
  readonly sourceText: string;
  /** Whether Orbit may propose repairs for agents published from this document. */
  readonly recoveryEnabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function toSopDocumentRecord(row: SopDocumentRow): SopDocumentRecord {
  return {
    id: row.id,
    title: row.title,
    sourceText: row.sourceText,
    recoveryEnabled: row.recoveryEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
