import { useEffect } from 'react';
import { checkAndSendDailyAlerts, subscribeToPushNotifications } from '../services/notificationService';
import { useAuth } from './AuthGuard';

export default function NotificationManager() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    const setupNotifications = async () => {
      // 1. Check if in iframe (AI Studio preview)
      const isInIframe = window.self !== window.top;
      if (isInIframe && Notification.permission === 'default') {
        console.warn('Browser notifications might be blocked in the AI Studio preview iframe. If they don\'t work, try opening the app in a new tab.');
      }

      // 2. Request Browser Notification Permission
      if ('Notification' in window && Notification.permission === 'default') {
        try {
          const result = await Notification.requestPermission();
          console.log('Notification permission result:', result);
        } catch (err) {
          console.error('Error requesting notification permission:', err);
        }
      }

      // 3. Register Service Worker if needed
      if ('serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.register('/sw.js', {
            scope: '/'
          });
          console.log('Service Worker registered:', registration.scope);
          
          // Wait for registration to be ready
          await navigator.serviceWorker.ready;
          
          // 4. Subscribe to Push Notifications if permission granted
          if (Notification.permission === 'granted') {
            const existingSub = await registration.pushManager.getSubscription();
            if (!existingSub) {
              console.log('No existing subscription found, subscribing...');
              try {
                await subscribeToPushNotifications();
              } catch (subErr) {
                console.error('Failed to subscribe to push notifications:', subErr);
              }
            } else {
              // Refresh subscription on server just in case
              console.log('Existing subscription found, refreshing on server...');
              await fetch('/api/push-subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(existingSub)
              }).catch(err => console.warn('Failed to refresh subscription on server:', err));
            }
          }
        } catch (err) {
          console.error('Service Worker registration or subscription failed:', err);
        }
      }

      // 4. Run initial daily alerts check
      try {
        const result = await checkAndSendDailyAlerts();
        console.log('Initial daily alerts check result:', result);
      } catch (err) {
        console.error('Error in initial daily alerts check:', err);
      }
    };

    setupNotifications();

    // 5. Setup periodic check (every hour)
    const interval = setInterval(async () => {
      try {
        await checkAndSendDailyAlerts();
      } catch (err) {
        console.error('Error in periodic daily alerts check:', err);
      }
    }, 1000 * 60 * 60); // Check every hour instead of 12 hours

    return () => clearInterval(interval);
  }, [user]);

  return null;
}
