import { collection, getDocs, query, where, doc, updateDoc, Timestamp, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Product, SystemSettings, UserProfile } from '../types';
import { differenceInDays } from 'date-fns';
import { formatDate } from '../lib/utils';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const sendAlertToAllChannels = async (
  settings: SystemSettings, 
  message: string, 
  subject: string,
  channels: { sms?: boolean; email?: boolean; push?: boolean }
) => {
  const results = { sms: 0, email: 0, push: 0 };

  // 1. SMS (Twilio)
  if (channels.sms && settings.enableSmsNotifications === true) {
    const phones = [settings.notificationPhone, settings.phoneNumber].filter(Boolean);
    for (const phone of phones) {
      try {
        const response = await fetch('/api/send-sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: phone, message })
        });
        if (response.ok) {
          results.sms++;
        } else {
          const errorData = await response.json();
          console.error(`Twilio SMS Error for ${phone}:`, errorData);
        }
      } catch (err) {
        console.error(`Network error sending SMS to ${phone}:`, err);
      }
    }
  }

  // 1b. Native SMS (Manual)
  if (channels.sms && settings.enableNativeSmsNotifications) {
    const phones = [settings.notificationPhone, settings.phoneNumber].filter(Boolean);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const phone of phones) {
        try {
          const notificationOptions = {
            body: `TAP TO SEND SMS: ${message.substring(0, 100)}...`,
            icon: '/favicon.ico',
            tag: `sms-alert-${phone}`,
            requireInteraction: true,
            badge: '/favicon.ico',
            data: { 
              url: `sms:${phone}?body=${encodeURIComponent(message)}`,
              isSms: true
            }
          };

          if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.ready;
            await registration.showNotification(subject, notificationOptions);
          } else {
            // Fallback for environments without service worker (unlikely in this app)
            const notification = new Notification(subject, notificationOptions);
            notification.onclick = () => {
              window.open(notificationOptions.data.url);
              window.focus();
              notification.close();
            };
          }
        } catch (err) {
          console.error('Error showing native notification:', err);
        }
      }
    } else {
      console.warn('Native SMS enabled but notification permission not granted or Notification API missing.');
    }
  }

  // 2. Email (Gmail)
  if (channels.email && settings.enableEmailNotifications && settings.notificationEmail) {
    try {
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          to: settings.notificationEmail, 
          subject: subject, 
          message: message 
        })
      });
      if (response.ok) results.email++;
    } catch (err) {
      console.error(`Error sending Email to ${settings.notificationEmail}:`, err);
    }
  }

  // 3. Push Notifications
  if (channels.push && settings.enablePushNotifications) {
    try {
      const response = await fetch('/api/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          title: subject, 
          message: message 
        })
      });
      if (response.ok) results.push++;
    } catch (err) {
      console.error(`Error sending Push notification:`, err);
    }
  }

  return results;
};

const sendAlertToUsers = async (
  message: string,
  subject: string,
  type: 'expiry' | 'lowStock' | 'task',
  targetUserId?: string
) => {
  try {
    // 1. Get all active users
    const usersPath = 'users';
    const usersQuery = targetUserId 
      ? query(collection(db, usersPath), where('uid', '==', targetUserId))
      : query(collection(db, usersPath), where('active', '==', true));
    
    const usersSnapshot = await getDocs(usersQuery);
    const users = usersSnapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));

    for (const user of users) {
      const prefs = user.notificationPreferences?.[type];
      if (!prefs) continue;

      // SMS
      if (prefs.sms && user.phone) {
        try {
          await fetch('/api/send-sms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: user.phone, message })
          });
        } catch (err) {
          console.error(`Error sending SMS to user ${user.uid}:`, err);
        }
      }

      // Email
      if (prefs.email && user.email) {
        try {
          await fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: user.email, subject, message })
          });
        } catch (err) {
          console.error(`Error sending Email to user ${user.uid}:`, err);
        }
      }

      // Push (Note: Push is currently global/broadcast in this app, but we could make it targeted)
      // For now, we'll just rely on the global push if the user has it enabled in their browser
    }
  } catch (err) {
    console.error('Error in sendAlertToUsers:', err);
  }
};

export const checkAndSendExpiryNotifications = async (force = false) => {
  const settingsPath = 'systemSettings/default';
  const productsPath = 'products';

  try {
    // 1. Get System Settings
    const settingsDoc = await getDoc(doc(db, 'systemSettings', 'default'));
    if (!settingsDoc.exists()) {
      console.log('No system settings found. Skipping notifications.');
      return { success: false, message: 'No system settings found.' };
    }

    const settings = settingsDoc.data() as SystemSettings;
    if (!settings.enableExpiryNotifications) {
      console.log('Expiry notifications are disabled.');
      return { success: false, message: 'Notifications are disabled.' };
    }

    // Check if we checked recently (today)
    if (!force && settings.lastNotificationCheck) {
      const lastCheck = settings.lastNotificationCheck.toDate();
      const now = new Date();
      
      // 1. Only run automated checks after 08:00 AM
      if (now.getHours() < 8) {
        console.log('Too early for automated alerts. Waiting until 08:00 AM.');
        return { success: true, message: 'Too early for automated alerts.', count: 0, skipped: true };
      }

      // 2. Only run once per calendar day
      if (lastCheck.toDateString() === now.toDateString()) {
        console.log('Already checked today. Skipping automated check.');
        return { success: true, message: 'Already checked today.', count: 0, skipped: true };
      }
    }

    // 2. Get all products
    let productsSnapshot;
    try {
      productsSnapshot = await getDocs(collection(db, productsPath));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, productsPath);
      throw error;
    }
    
    const products = productsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));

    // 3. Filter products nearing expiry
    const expiringProducts = products.filter(p => {
      if (!p.expiryDate) return false;
      const expiryDate = p.expiryDate.toDate();
      const daysRemaining = differenceInDays(expiryDate, new Date());
      return daysRemaining <= (p.expiryAlertThreshold || 7); // Default to 7 days if not set
    });

    if (expiringProducts.length === 0) {
      console.log('No products nearing expiry.');
      return { success: true, message: 'No products nearing expiry.', count: 0 };
    }

    // 4. Prepare notification message
    const productList = expiringProducts.map(p => 
      `- ${p.name} (Barcode: ${p.barcode}, Expiry: ${p.expiryDate ? formatDate(p.expiryDate.toDate()) : 'N/A'})`
    ).join('\n');

    const message = `EXPIRY ALERT: The following products are nearing expiry:\n${productList}`;
    const subject = "Inventory Expiry Alert";

    // 5. Send notifications via all enabled channels
    const results = await sendAlertToAllChannels(settings, message, subject, {
      sms: settings.expirySms ?? true,
      email: settings.expiryEmail ?? true,
      push: settings.expiryPush ?? true
    });

    // Send to individual users based on their preferences
    await sendAlertToUsers(message, subject, 'expiry');

    // 6. Update last check time
    try {
      await updateDoc(doc(db, 'systemSettings', 'default'), {
        lastNotificationCheck: Timestamp.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, settingsPath);
      throw error;
    }

    const summary = [];
    if (results.sms > 0) summary.push(`Twilio SMS (${results.sms})`);
    if (settings.enableNativeSmsNotifications) summary.push(`Native SMS (Manual)`);
    if (results.email > 0) summary.push(`Email (${results.email})`);
    if (results.push > 0) summary.push(`Push (${results.push})`);

    return { 
      success: true, 
      message: summary.length > 0 ? `Notifications sent via: ${summary.join(', ')}.` : 'Failed to send notifications. Check server logs.', 
      count: expiringProducts.length 
    };
  } catch (error) {
    console.error('Error in checkAndSendExpiryNotifications:', error);
    return { success: false, message: error instanceof Error ? error.message : 'An error occurred while sending notifications.' };
  }
};

export const sendLowStockAlert = async (product: Product) => {
  try {
    const settingsDoc = await getDoc(doc(db, 'systemSettings', 'default'));
    if (!settingsDoc.exists()) return;
    const settings = settingsDoc.data() as SystemSettings;
    if (!settings.enableLowStockNotifications) return;

    const message = `LOW STOCK ALERT: ${product.name} (Barcode: ${product.barcode}) is low on stock. Current: ${product.currentStock}, Threshold: ${product.lowStockThreshold || 5}`;
    const subject = "Low Stock Alert";
    
    await sendAlertToAllChannels(settings, message, subject, {
      sms: settings.lowStockSms ?? true,
      email: settings.lowStockEmail ?? true,
      push: settings.lowStockPush ?? true
    });

    // Send to individual users based on their preferences
    await sendAlertToUsers(message, subject, 'lowStock');
  } catch (error) {
    console.error('Error sending low stock alert:', error);
  }
};

export const sendTaskAlert = async (task: any, assignedUser?: any) => {
  try {
    const settingsDoc = await getDoc(doc(db, 'systemSettings', 'default'));
    if (!settingsDoc.exists()) return;
    const settings = settingsDoc.data() as SystemSettings;
    if (!settings.enableTaskNotifications) return;

    const message = `TASK ALERT: New task assigned: ${task.title}. Priority: ${task.priority}. Due: ${task.dueDate ? formatDate(task.dueDate.toDate()) : 'N/A'}`;
    const subject = "New Task Assigned";
    
    await sendAlertToAllChannels(settings, message, subject, {
      sms: settings.taskSms ?? true,
      email: settings.taskEmail ?? true,
      push: settings.taskPush ?? true
    });

    // Send to the assigned user specifically if provided, otherwise all active users
    await sendAlertToUsers(message, subject, 'task', assignedUser?.uid);
  } catch (error) {
    console.error('Error sending task alert:', error);
  }
};

export const subscribeToPushNotifications = async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push notifications not supported');
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    
    // Get public key from server
    const response = await fetch('/api/push-key');
    const { publicKey } = await response.json();
    
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    
    // Send subscription to server
    await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });
    
    return true;
  } catch (error) {
    console.error('Failed to subscribe to push notifications:', error);
    return false;
  }
};
