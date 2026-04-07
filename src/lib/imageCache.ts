import { get, set, del } from 'idb-keyval';

/**
 * A simple image cache using IndexedDB to store base64 or Blobs.
 * This allows for "faster" UI by showing local images while they upload
 * and provides offline support for images.
 */
export const ImageCache = {
  /**
   * Store an image in the local cache.
   * @param key The unique key (e.g., product ID or task ID)
   * @param data The image data (base64 or Blob)
   */
  async save(key: string, data: string | Blob): Promise<void> {
    try {
      await set(`img_cache_${key}`, data);
    } catch (err) {
      console.warn('Failed to save image to local cache:', err);
    }
  },

  /**
   * Retrieve an image from the local cache.
   * @param key The unique key
   */
  async get(key: string): Promise<string | Blob | undefined> {
    try {
      return await get(`img_cache_${key}`);
    } catch (err) {
      console.warn('Failed to get image from local cache:', err);
      return undefined;
    }
  },

  /**
   * Remove an image from the local cache.
   * @param key The unique key
   */
  async delete(key: string): Promise<void> {
    try {
      await del(`img_cache_${key}`);
    } catch (err) {
      console.warn('Failed to delete image from local cache:', err);
    }
  }
};
