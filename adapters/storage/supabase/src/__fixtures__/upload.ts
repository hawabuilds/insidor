/**
 * Supabase Storage's reply to an object upload, in its documented shape (`{ Key, Id }`). Hand
 * written: nothing was uploaded to make this test.
 */
export const UPLOADED = (key: string) => ({ Key: `launch-metadata/${key}`, Id: '00000000-0000-0000-0000-000000000000' });

/** A 1×1 transparent PNG. */
export const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
