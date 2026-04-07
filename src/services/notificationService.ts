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
  channels: { push?: boolean; email?: boolean; sms?: boolean },
  targetUser?: UserProfile
) => {
  const results = { push: 0, email: 0, sms: 0 };

  // Push Notifications
  if (channels.push && settings.enablePushNotifications) {
    try {
      console.log('Sending push notification to server...');
      const response = await fetch('/api/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          title: subject, 
          message: message 
        })
      });
      
      if (response.ok) {
        results.push++;
        console.log('Push notification sent successfully');
      } else {
        const errorText = await response.text();
        let displayError = errorText;
        try {
          const parsed = JSON.parse(errorText);
          displayError = parsed.error || errorText;
        } catch {
          // Not JSON
        }
        console.error(`Server error sending push: ${response.status} ${displayError}`);
        // We don't throw here to allow other channels to proceed
      }
    } catch (err) {
      console.error(`Network error sending Push notification:`, err);
      if (err instanceof Error) {
        console.error(`Error message: ${err.message}`);
        console.error(`Error stack: ${err.stack}`);
      }
    }
  }

  // Email Notifications
  if (channels.email && settings.enableEmailNotifications && settings.gmailUser && settings.gmailPass) {
    const to = targetUser?.email || settings.gmailUser;
    try {
      console.log(`Sending email to ${to}...`);
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject,
          text: message,
          html: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                  <h2 style="color: #2563eb;">ATR Store Alert</h2>
                  <p>${message}</p>
                  <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                  <p style="font-size: 12px; color: #666;">This is an automated notification from your Inventory Management System.</p>
                </div>`,
          gmailUser: settings.gmailUser,
          gmailPass: settings.gmailPass
        })
      });
      if (response.ok) {
        results.email++;
        console.log('Email sent successfully');
      } else {
        const errorText = await response.text();
        console.error(`Server error sending email: ${response.status} ${errorText}`);
      }
    } catch (err) {
      console.error('Error sending Email:', err);
    }
  }

  // SMS Notifications
  if (channels.sms && settings.enableSmsNotifications && settings.twilioSid && settings.twilioAuthToken && settings.twilioFromNumber) {
    const to = targetUser?.phoneNumber;
    if (to) {
      try {
        console.log(`Sending SMS to ${to}...`);
        const response = await fetch('/api/send-sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to,
            message: `${subject}: ${message}`,
            twilioSid: settings.twilioSid,
            twilioAuthToken: settings.twilioAuthToken,
            twilioFromNumber: settings.twilioFromNumber
          })
        });
        if (response.ok) {
          results.sms++;
          console.log('SMS sent successfully');
        } else {
          const errorText = await response.text();
          console.error(`Server error sending SMS: ${response.status} ${errorText}`);
        }
      } catch (err) {
        console.error('Error sending SMS:', err);
      }
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

    const settingsDoc = await getDoc(doc(db, 'systemSettings', 'default'));
    if (!settingsDoc.exists()) return;
    const settings = settingsDoc.data() as SystemSettings;

    for (const user of users) {
      // Use user's preferences or default to all enabled if not set
      const prefs = user.notificationPreferences?.[type] || { push: true, email: true, sms: true };
      
      await sendAlertToAllChannels(
        settings,
        message,
        subject,
        {
          push: prefs.push && settings[`${type}Push` as keyof SystemSettings] !== false,
          email: prefs.email && settings[`${type}Email` as keyof SystemSettings] !== false,
          sms: prefs.sms && settings[`${type}Sms` as keyof SystemSettings] !== false
        },
        user
      );
    }
  } catch (err) {
    console.error('Error in sendAlertToUsers:', err);
  }
};

export const checkAndSendDailyAlerts = async (force = false) => {
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
    if (!settings.enableExpiryNotifications && !settings.enableLowStockNotifications) {
      console.log('All notifications are disabled.');
      return { success: false, message: 'Notifications are disabled.' };
    }

    // Check if we checked recently (today)
    if (!force && settings.lastNotificationCheck) {
      const lastCheck = settings.lastNotificationCheck.toDate();
      const now = new Date();
      
      // 1. Only run automated checks after 08:30 AM
      const minutes = now.getHours() * 60 + now.getMinutes();
      const targetMinutes = 8 * 60 + 30; // 08:30 AM

      if (minutes < targetMinutes) {
        console.log('Too early for automated alerts. Waiting until 08:30 AM.');
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
    const expiringProducts = settings.enableExpiryNotifications ? products.filter(p => {
      if (!p.expiryDate) return false;
      const expiryDate = p.expiryDate.toDate();
      const daysRemaining = differenceInDays(expiryDate, new Date());
      return daysRemaining <= (p.expiryAlertThreshold || 7);
    }) : [];

    // 4. Filter products with low stock
    const lowStockProducts = settings.enableLowStockNotifications ? products.filter(p => {
      return p.currentStock <= (p.lowStockThreshold || 5);
    }) : [];

    if (expiringProducts.length === 0 && lowStockProducts.length === 0) {
      console.log('No alerts to send.');
      return { success: true, message: 'No alerts to send.', count: 0 };
    }

    // 5. Prepare notification message
    let message = "DAILY INVENTORY ALERT SUMMARY\n\n";
    let hasAlerts = false;

    if (expiringProducts.length > 0) {
      hasAlerts = true;
      message += "EXPIRY ALERTS:\n";
      message += expiringProducts.map(p => 
        `- ${p.name} (Barcode: ${p.barcode}, Expiry: ${p.expiryDate ? formatDate(p.expiryDate.toDate()) : 'N/A'})`
      ).join('\n') + "\n\n";
    }

    if (lowStockProducts.length > 0) {
      hasAlerts = true;
      message += "LOW STOCK ALERTS:\n";
      message += lowStockProducts.map(p => 
        `- ${p.name} (Barcode: ${p.barcode}, Stock: ${p.currentStock}, Threshold: ${p.lowStockThreshold || 5})`
      ).join('\n') + "\n";
    }

    const subject = "Inventory Daily Alerts Summary";

    // 6. Send notifications via all enabled channels
    const results = await sendAlertToAllChannels(settings, message, subject, {
      push: true, // Always send push if triggered
      email: settings.expiryEmail || settings.lowStockEmail || true,
      sms: settings.expirySms || settings.lowStockSms || true
    });

    // Send to individual users based on their preferences
    await sendAlertToUsers(message, subject, 'expiry'); // Using 'expiry' as a general type for daily report

    // 7. Update last check time
    try {
      await updateDoc(doc(db, 'systemSettings', 'default'), {
        lastNotificationCheck: Timestamp.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, settingsPath);
      throw error;
    }

    const summary = [];
    if (results.push > 0) summary.push(`Push (${results.push})`);

    return { 
      success: true, 
      message: summary.length > 0 ? `Daily alerts sent at 08:30 AM.` : 'Daily check completed.', 
      count: expiringProducts.length + lowStockProducts.length 
    };
  } catch (error) {
    console.error('Error in checkAndSendDailyAlerts:', error);
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
      push: settings.lowStockPush ?? true,
      email: settings.lowStockEmail ?? true,
      sms: settings.lowStockSms ?? true
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

    const isUnassigned = !assignedUser;
    const message = isUnassigned
      ? `TASK ALERT: Unassigned task: ${task.title}. Priority: ${task.priority}. Due: ${task.dueDate ? formatDate(task.dueDate.toDate()) : 'N/A'}`
      : `TASK ALERT: Task assigned to ${assignedUser.name}: ${task.title}. Priority: ${task.priority}. Due: ${task.dueDate ? formatDate(task.dueDate.toDate()) : 'N/A'}`;
    
    const subject = isUnassigned ? "Unassigned Task Alert" : "Task Assigned Alert";
    
    await sendAlertToAllChannels(settings, message, subject, {
      push: settings.taskPush ?? true,
      email: settings.taskEmail ?? true,
      sms: settings.taskSms ?? true
    });

    // Send to the assigned user if specified, otherwise to all active users
    await sendAlertToUsers(message, subject, 'task', assignedUser?.uid);
  } catch (error) {
    console.error('Error sending task alert:', error);
  }
};

export const sendTaskCompletionAlert = async (task: any, completedBy: string) => {
  try {
    const settingsDoc = await getDoc(doc(db, 'systemSettings', 'default'));
    if (!settingsDoc.exists()) return;
    const settings = settingsDoc.data() as SystemSettings;
    if (!settings.enableTaskNotifications) return;

    const message = `TASK COMPLETED: ${task.title}. Completed by: ${completedBy}.`;
    const subject = "Task Completed Alert";
    
    await sendAlertToAllChannels(settings, message, subject, {
      push: settings.taskPush ?? true,
      email: settings.taskEmail ?? true,
      sms: settings.taskSms ?? true
    });

    // Send to all active users
    await sendAlertToUsers(message, subject, 'task');
  } catch (error) {
    console.error('Error sending task completion alert:', error);
  }
};

export const subscribeToPushNotifications = async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    console.warn('Push notifications not supported');
    return false;
  }

  try {
    // Check current permission
    let permission = Notification.permission;
    
    if (permission === 'denied') {
      console.warn('Push notification permission denied by user');
      return false;
    }

    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
      return false;
    }

    const registration = await navigator.serviceWorker.ready;
    console.log('Service Worker ready for subscription');
    
    // Get public key from server
    let response;
    let retries = 3;
    while (retries > 0) {
      console.log(`Fetching VAPID key (attempt ${4 - retries}/3)...`);
      response = await fetch('/api/push-key');
      if (response.status === 503) {
        console.log('VAPID keys still initializing, retrying in 2 seconds...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        retries--;
        continue;
      }
      break;
    }

    if (!response || !response.ok) {
      const errorText = response ? await response.text() : 'Network error';
      throw new Error(`Failed to fetch VAPID public key: ${response?.status} ${errorText}`);
    }
    
    const { publicKey } = await response.json();
    if (!publicKey) throw new Error('VAPID public key is empty');
    console.log('VAPID public key received');

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    console.log('Push subscription created:', subscription.endpoint);
    
    // Send subscription to server
    const subscribeResponse = await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });
    
    if (!subscribeResponse.ok) {
      console.error('Failed to save subscription on server:', subscribeResponse.status);
      if (subscribeResponse.status === 404) {
        throw new Error('Push subscription endpoint not found (404). Please ensure the server is running correctly.');
      }
      const errorData = await subscribeResponse.json().catch(() => ({ error: 'Unknown server error' }));
      throw new Error(errorData.error || `Server error: ${subscribeResponse.status}`);
    }
    
    console.log('Push subscription saved on server successfully');
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === 'NotAllowedError') {
      console.warn('Push notification permission denied');
    } else {
      console.error('Failed to subscribe to push notifications:', error);
    }
    return false;
  }
};

export const testPush = async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { success: false, message: 'Push notifications not supported' };
  }

  try {
    // Check if in iframe
    if (window.self !== window.top && Notification.permission === 'default') {
      console.warn('Push notifications might be blocked in the AI Studio preview iframe. Try opening the app in a new tab.');
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    
    if (!subscription) {
      console.log('No active subscription found, attempting to re-subscribe...');
      const subscribed = await subscribeToPushNotifications();
      if (!subscribed) {
        return { success: false, message: 'No active subscription found and failed to re-subscribe. Please ensure you have granted notification permission.' };
      }
      subscription = await registration.pushManager.getSubscription();
    }
    
    if (!subscription) {
      return { success: false, message: 'Failed to retrieve push subscription after re-subscribing.' };
    }
    
    const response = await fetch('/api/test-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription })
    });
    
    if (response.ok) {
      return { success: true, message: 'Test notification sent!' };
    } else {
      const error = await response.json();
      return { success: false, message: error.error || 'Failed to send test notification' };
    }
  } catch (error) {
    console.error('Error testing push notification:', error);
    return { success: false, message: error instanceof Error ? error.message : 'An error occurred' };
  }
};
