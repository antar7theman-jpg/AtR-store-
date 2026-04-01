import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, CloudOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { db } from '../firebase';
import { onSnapshotsInSync } from 'firebase/firestore';

const OfflineStatus: React.FC = () => {
  const { t } = useTranslation();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showStatus, setShowStatus] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowStatus(true);
      setTimeout(() => setShowStatus(false), 3000);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setShowStatus(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Listen for Firestore sync status
    const unsubscribe = onSnapshotsInSync(db, () => {
      // This fires when all snapshots are in sync with the server
      // We can use this to show a brief "Synced" message if we were syncing
      setIsSyncing(false);
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, []);

  // We can't easily detect "syncing" state from Firestore directly without a lot of boilerplate
  // but we can at least show the online/offline status clearly.

  return (
    <AnimatePresence>
      {(!isOnline || showStatus) && (
        <motion.div
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -50, opacity: 0 }}
          className={`fixed top-16 left-0 right-0 z-[60] flex justify-center pointer-events-none`}
        >
          <div className={`px-4 py-2 rounded-full shadow-lg flex items-center space-x-2 rtl:space-x-reverse text-sm font-medium ${
            isOnline ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-amber-100 text-amber-800 border border-amber-200'
          }`}>
            {isOnline ? (
              <>
                <Wifi className="h-4 w-4" />
                <span>{t('common.online')}</span>
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4" />
                <span>{t('common.offlineMode')}</span>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OfflineStatus;
