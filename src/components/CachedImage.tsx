import React, { useState, useEffect } from 'react';
import { ImageCache } from '../lib/imageCache';

interface CachedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  cacheKey: string;
  src: string;
}

/**
 * A component that tries to load an image from the local IndexedDB cache first,
 * then falls back to the provided src URL.
 */
export const CachedImage: React.FC<CachedImageProps> = ({ cacheKey, src, ...props }) => {
  const [displaySrc, setDisplaySrc] = useState<string>(src);

  useEffect(() => {
    let isMounted = true;

    const checkCache = async () => {
      if (!cacheKey) return;
      
      const cached = await ImageCache.get(cacheKey);
      if (cached && isMounted) {
        if (typeof cached === 'string') {
          setDisplaySrc(cached);
        } else if (cached instanceof Blob) {
          setDisplaySrc(URL.createObjectURL(cached));
        }
      }
    };

    checkCache();

    return () => {
      isMounted = false;
    };
  }, [cacheKey]);

  // Update displaySrc if the remote src changes (e.g., after upload completes)
  useEffect(() => {
    if (src) {
      setDisplaySrc(src);
    }
  }, [src]);

  return <img src={displaySrc} {...props} referrerPolicy="no-referrer" />;
};
