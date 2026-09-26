import { z } from 'zod';

const libraryIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
export type LibraryId = string & { readonly __libraryId: unique symbol };
export function parseLibraryId(value: unknown): LibraryId { return libraryIdSchema.parse(value) as LibraryId; }
export function createLibraryId(): LibraryId { return parseLibraryId(globalThis.crypto.randomUUID()); }
