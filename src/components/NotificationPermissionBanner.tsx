import React, { useState, useEffect } from 'react';
import { Bell, X, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { subscribeToPushNotifications } from '../services/notificationService';
import { cn } from '../lib/utils';

const NotificationPermissionBanner: React.FC = () => {
  const { t } = useTranslation();
  const [showBanner, setShowBanner] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);

  useEffect(() => {
    // Check if browser supports notifications and permission is not yet granted/denied
    if ('Notification' in window) {
      if (Notification.permission === 'default') {
        // Delay showing the banner slightly for better UX
        const timer = setTimeout(() => {
          setShowBanner(true);
        }, 2000);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  const handleEnable = async () => {
    setIsSubscribing(true);
    try {
      const success = await subscribeToPushNotifications();
      if (success) {
        setShowBanner(false);
      }
    } catch (err) {
      console.error('Error enabling notifications:', err);
    } finally {
      setIsSubscribing(false);
    }
  };

  const handleDismiss = () => {
    setShowBanner(false);
    // Optionally store in localStorage to not show again for this session
    sessionStorage.setItem('notification-banner-dismissed', 'true');
  };

  if (sessionStorage.getItem('notification-banner-dismissed') === 'true') {
    return null;
  }

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="bg-blue-600 dark:bg-blue-700 text-white overflow-hidden"
        >
          <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center flex-1 min-w-0">
                <span className="flex p-2 rounded-lg bg-blue-800">
                  <Bell className="h-5 w-5 text-white" aria-hidden="true" />
                </span>
                <p className="ml-3 font-medium text-white truncate">
                  <span className="md:hidden">{t('notifications.enablePromptMobile', { defaultValue: 'Enable alerts for stock and expiry.' })}</span>
                  <span className="hidden md:inline">{t('notifications.enablePromptDesktop', { defaultValue: 'Stay updated! Enable push notifications for low stock and product expiry alerts.' })}</span>
                </p>
              </div>
              <div className="flex items-center space-x-3 rtl:space-x-reverse">
                <button
                  onClick={handleEnable}
                  disabled={isSubscribing}
                  className={cn(
                    "flex items-center justify-center px-4 py-2 border border-transparent rounded-xl shadow-sm text-sm font-bold text-blue-600 bg-white hover:bg-blue-50 transition-all active:scale-95 disabled:opacity-50",
                    isSubscribing && "animate-pulse"
                  )}
                >
                  {isSubscribing ? (
                    <ShieldCheck className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Bell className="h-4 w-4 mr-2" />
                  )}
                  {t('notifications.enableButton', { defaultValue: 'Enable Now' })}
                </button>
                <button
                  onClick={handleDismiss}
                  className="p-2 rounded-md hover:bg-blue-500 focus:outline-none transition-colors"
                >
                  <X className="h-5 w-5 text-white" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default NotificationPermissionBanner;
