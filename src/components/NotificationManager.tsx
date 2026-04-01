import { useEffect } from 'react';
import { checkAndSendExpiryNotifications, subscribeToPushNotifications } from '../services/notificationService';
import { useAuth } from './AuthGuard';

export default function NotificationManager() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    const setupNotifications = async () => {
      // 1. Request Browser Notification Permission
      if ('Notification' in window && Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
          console.log('Notification permission:', Notification.permission);
        } catch (err) {
          console.error('Error requesting notification permission:', err);
        }
      }

      // 2. Register Service Worker if needed
      if ('serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.register('/sw.js');
          console.log('Service Worker registered:', registration.scope);
          
          // 3. Subscribe to Push Notifications if permission granted
          if (Notification.permission === 'granted') {
            await subscribeToPushNotifications();
          }
        } catch (err) {
          console.error('Service Worker registration failed:', err);
        }
      }

      // 4. Run initial expiry check
      try {
        const result = await checkAndSendExpiryNotifications();
        console.log('Initial expiry check result:', result);
      } catch (err) {
        console.error('Error in initial expiry check:', err);
      }
    };

    setupNotifications();

    // 5. Setup periodic check (every 12 hours)
    const interval = setInterval(async () => {
      try {
        await checkAndSendExpiryNotifications();
      } catch (err) {
        console.error('Error in periodic expiry check:', err);
      }
    }, 1000 * 60 * 60 * 12);

    return () => clearInterval(interval);
  }, [user]);

  return null;
}
