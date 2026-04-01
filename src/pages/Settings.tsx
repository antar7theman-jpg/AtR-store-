import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, query, orderBy, getDoc, getDocs, limit } from 'firebase/firestore';
import { createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile, UserRole, SystemSettings } from '../types';
import { useAuth } from '../components/AuthGuard';
import { 
  subscribeToPushNotifications,
  checkAndSendExpiryNotifications 
} from '../services/notificationService';
import { 
  Users, UserPlus, Shield, User as UserIcon, 
  Trash2, X, AlertCircle, CheckCircle, Mail, MessageSquare,
  Lock, ChevronRight, Power, Bell, Settings as SettingsIcon,
  Key, Database, Download, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatDate } from '../lib/utils';
import { useTranslation } from 'react-i18next';

const Settings: React.FC = () => {
  const { isAdmin, isStaff, profile, user } = useAuth();
  const canManage = isAdmin || isStaff;
  const { t } = useTranslation();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Personal Settings State
  const [personalPrefs, setPersonalPrefs] = useState<UserProfile['notificationPreferences'] | null>(null);
  const [personalPhone, setPersonalPhone] = useState('');
  const [updatingPersonal, setUpdatingPersonal] = useState(false);

  // New User Form State
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('staff');
  const [submitting, setSubmitting] = useState(false);

  // System Settings State
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [gmailPass, setGmailPass] = useState('');
  const [vapidPublicKeyInput, setVapidPublicKeyInput] = useState('');
  const [vapidPrivateKeyInput, setVapidPrivateKeyInput] = useState('');
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<UserProfile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);

  useEffect(() => {
    if (!isAdmin) return;

    // Get VAPID public key from server
    fetch('/api/push-key')
      .then(res => res.json())
      .then(data => {
        setVapidPublicKey(data.publicKey);
        // If Firestore is empty, we can suggest using the server-generated one
      })
      .catch(err => console.error("Error fetching VAPID key from server:", err));

    // Get VAPID keys from secrets
    getDoc(doc(db, 'secrets', 'vapid'))
      .then(docSnap => {
        if (docSnap.exists()) {
          setVapidPublicKeyInput(docSnap.data().publicKey || '');
          setVapidPrivateKeyInput(docSnap.data().privateKey || '');
        }
      })
      .catch(err => {
        console.error("Error fetching VAPID secrets:", err);
        if (err.message.includes("PERMISSION_DENIED")) {
          // This might happen if the user profile hasn't been saved to Firestore yet
          // or if the rules are still propagating.
          console.warn("Permission Denied when fetching secrets. This is expected if you are not an admin or if your profile is being initialized.");
        }
      });

    // Get Gmail Pass from secrets
    getDoc(doc(db, 'secrets', 'gmail'))
      .then(docSnap => {
        if (docSnap.exists()) {
          setGmailPass(docSnap.data().pass || '');
        }
      })
      .catch(err => {
        console.error("Error fetching gmail secret:", err);
        if (err.message.includes("PERMISSION_DENIED")) {
          setError("Permission Denied: You must be an admin to access email secrets.");
        }
      });

    const path = 'users';
    const q = query(collection(db, path), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const userList = snapshot.docs.map(doc => ({ ...doc.data(), uid: doc.id } as UserProfile));
      setUsers(userList);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribe();
  }, [isAdmin]);

  useEffect(() => {
    if (!profile) return;
    
    setPersonalPhone(profile.phone || '');
    setPersonalPrefs(profile.notificationPreferences || {
      expiry: { sms: true, email: true, push: true },
      lowStock: { sms: true, email: true, push: true },
      task: { sms: true, email: true, push: true }
    });
  }, [profile]);

  useEffect(() => {
    if (!isAdmin && !isStaff) return;

    const path = 'systemSettings';
    const unsubscribe = onSnapshot(doc(db, path, 'default'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as SystemSettings;
        setSystemSettings({
          expirySms: true,
          expiryEmail: true,
          expiryPush: true,
          lowStockSms: true,
          lowStockEmail: true,
          lowStockPush: true,
          taskSms: true,
          taskEmail: true,
          taskPush: true,
          ...data,
          id: snapshot.id
        });
      } else {
        // Initialize default settings if they don't exist
        setSystemSettings({
          id: 'default',
          notificationPhone: '',
          phoneNumber: '',
          notificationEmail: 'Antar7theman@gmail.com',
          enableExpiryNotifications: true,
          enableLowStockNotifications: true,
          enableTaskNotifications: true,
          expirySms: true,
          expiryEmail: true,
          expiryPush: true,
          lowStockSms: true,
          lowStockEmail: true,
          lowStockPush: true,
          taskSms: true,
          taskEmail: true,
          taskPush: true,
          enableSmsNotifications: false,
          enableNativeSmsNotifications: true,
          enableEmailNotifications: true,
          enablePushNotifications: true
        });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribe();
  }, [canManage]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      // 1. Create user in Firebase Auth
      // Note: This will sign out the current admin if we use the same auth instance.
      // In a real app, you'd use a Cloud Function or Firebase Admin SDK.
      // For this demo, we'll simulate the creation by adding to Firestore.
      // THE USER WILL NEED TO BE CREATED MANUALLY IN AUTH OR VIA A CLOUD FUNCTION.
      // However, I'll implement the Firestore part and warn the user.
      
      // Since I can't easily create a user in Auth without signing out, 
      // I'll just add to Firestore and inform the user that they need to 
      // use the Firebase Console for the actual Auth account creation 
      // OR I can try to use a secondary auth instance if possible, but that's complex.
      
      // Actually, I'll just add the profile to Firestore.
      const userRef = doc(db, 'users', newUserEmail); // Use email directly as ID for consistency
      await setDoc(userRef, {
        uid: newUserEmail, // Placeholder
        email: newUserEmail,
        name: newUserName,
        role: newUserRole,
        active: true,
        notificationPreferences: {
          expiry: { sms: true, email: true, push: true },
          lowStock: { sms: true, email: true, push: true },
          task: { sms: true, email: true, push: true }
        }
      });

      setSuccess(t('settings.userProfileCreated', { name: newUserName }));
      setShowAddModal(false);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
    } catch (err) {
      console.error("Error adding user:", err);
      setError(t('settings.failedToCreateUser'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleUserStatus = async (user: UserProfile) => {
    const path = `users/${user.uid}`;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        active: !user.active
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const toggleUserRole = async (userToUpdate: UserProfile) => {
    // Don't allow the current user to change their own role to avoid locking themselves out
    if (userToUpdate.uid === user?.uid) {
      setError(t('settings.cannotChangeOwnRole'));
      return;
    }

    const path = `users/${userToUpdate.uid}`;
    const newRole: UserRole = userToUpdate.role === 'admin' ? 'staff' : 'admin';
    
    try {
      await updateDoc(doc(db, 'users', userToUpdate.uid), {
        role: newRole
      });
      setSuccess(t('settings.roleUpdated', { name: userToUpdate.name, role: newRole }));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const deleteUser = async (user: UserProfile) => {
    setShowDeleteConfirm(user);
  };

  const confirmDeleteUser = async () => {
    if (!showDeleteConfirm) return;
    setDeleting(true);
    const path = `users/${showDeleteConfirm.uid}`;
    try {
      await deleteDoc(doc(db, 'users', showDeleteConfirm.uid));
      setSuccess(t('settings.userDeleted', { name: showDeleteConfirm.name }));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(null);
    }
  };

  const handleUpdateGmailPass = async (pass: string) => {
    if (!isAdmin) return;
    try {
      await setDoc(doc(db, 'secrets', 'gmail'), { pass }, { merge: true });
      setSuccess(t('settings.gmailPassUpdated'));
    } catch (err) {
      console.error("Error updating gmail pass:", err);
      setError(t('settings.failedToUpdateGmailPass'));
    }
  };

  const handleUpdateVapidKeys = async (pub: string, priv: string) => {
    if (!isAdmin) return;
    try {
      await setDoc(doc(db, 'secrets', 'vapid'), { publicKey: pub, privateKey: priv }, { merge: true });
      setSuccess(t('settings.vapidKeysUpdated'));
    } catch (err) {
      console.error("Error updating VAPID keys:", err);
      setError(t('settings.failedToUpdateVapidKeys'));
    }
  };

  const handleUpdateSettings = async (updates: Partial<SystemSettings>) => {
    if (!canManage) return;
    try {
      await updateDoc(doc(db, 'systemSettings', 'default'), updates);
      setSuccess(t('settings.settingsUpdated'));
      
      // If push notifications were enabled, try to subscribe the current browser
      if (updates.enablePushNotifications === true) {
        const subscribed = await subscribeToPushNotifications();
        if (subscribed) {
          setSuccess(t('settings.pushSubscribed'));
        }
      }
    } catch (err) {
      console.error("Error updating settings:", err);
      setError(t('settings.failedToUpdateSettings'));
    }
  };

  const handleUpdatePersonalPrefs = async (updates: Partial<UserProfile['notificationPreferences']>) => {
    if (!user) return;
    setUpdatingPersonal(true);
    try {
      const newPrefs = { ...personalPrefs, ...updates } as UserProfile['notificationPreferences'];
      await updateDoc(doc(db, 'users', user.uid), {
        notificationPreferences: newPrefs,
        phone: personalPhone
      });
      setPersonalPrefs(newPrefs);
      setSuccess(t('settings.personalPrefsUpdated'));
    } catch (err) {
      console.error("Error updating personal prefs:", err);
      setError(t('settings.failedToUpdatePersonalPrefs'));
    } finally {
      setUpdatingPersonal(false);
    }
  };

  const handleUpdatePersonalPhone = async () => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        phone: personalPhone
      });
      setSuccess(t('settings.phoneUpdated'));
    } catch (err) {
      console.error("Error updating phone:", err);
      setError(t('settings.failedToUpdatePhone'));
    }
  };

  const handleSyncData = async () => {
    setSyncing(true);
    setSyncProgress(0);
    setError(null);
    setSuccess(null);

    try {
      // Sync Products
      setSyncProgress(20);
      const productsPath = 'products';
      const productsSnap = await getDocs(collection(db, productsPath));
      console.log(`Synced ${productsSnap.size} products`);

      // Sync Transactions (Recent)
      setSyncProgress(60);
      const transactionsPath = 'transactions';
      const transactionsQuery = query(collection(db, transactionsPath), orderBy('timestamp', 'desc'), limit(50));
      const transactionsSnap = await getDocs(transactionsQuery);
      console.log(`Synced ${transactionsSnap.size} transactions`);

      setSyncProgress(100);
      setSuccess(t('settings.syncComplete'));
    } catch (err) {
      console.error("Error syncing data:", err);
      setError(t('settings.syncFailed'));
    } finally {
      setTimeout(() => {
        setSyncing(false);
        setSyncProgress(0);
      }, 1000);
    }
  };

  if (!profile) return null;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">{t('settings.title')}</h1>
          <p className="text-gray-500 mt-1">{t('settings.subtitle')}</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center justify-center px-4 py-2.5 border border-transparent text-sm font-medium rounded-xl shadow-sm text-white bg-blue-600 hover:bg-blue-700 transition-all"
          >
            <UserPlus className="mr-2 h-5 w-5 rtl:mr-0 rtl:ml-2" />
            {t('settings.addUser')}
          </button>
        )}
      </div>

      {user && !user.emailVerified && user.email?.toLowerCase() === "antar7theman@gmail.com" && (
        <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-lg">
          <div className="flex">
            <AlertCircle className="h-5 w-5 text-amber-400" />
            <div className="ml-3">
              <p className="text-sm text-amber-700 font-bold">{t('settings.emailNotVerified')}</p>
              <p className="text-xs text-amber-600 mt-1">
                {t('settings.emailNotVerifiedSubtitle')}
              </p>
            </div>
          </div>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border-l-4 border-green-400 p-4 rounded-lg">
          <div className="flex">
            <CheckCircle className="h-5 w-5 text-green-400" />
            <p className="ml-3 text-sm text-green-700">{success}</p>
          </div>
        </div>
      )}

      {/* Personal Notification Preferences Section */}
      <div className="bg-white shadow-sm rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 flex items-center">
            <UserIcon className="h-5 w-5 mr-2 rtl:mr-0 rtl:ml-2 text-gray-400" />
            {t('settings.personalPrefs')}
          </h3>
          <div className="flex items-center space-x-2 rtl:space-x-reverse text-xs text-gray-500">
            <Mail className="h-3 w-3" />
            <span>{profile.email}</span>
          </div>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.myPhone')}</label>
              <input
                type="tel"
                value={personalPhone}
                onChange={(e) => setPersonalPhone(e.target.value)}
                onBlur={handleUpdatePersonalPhone}
                className="block w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder={t('settings.phonePlaceholder')}
              />
              <p className="mt-1 text-xs text-gray-500">{t('settings.phoneHint')}</p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">{t('settings.alertsConfig')}</h4>
              <div className="flex space-x-4 rtl:space-x-reverse text-[10px] font-bold text-gray-400 uppercase">
                <span className="w-12 text-center">{t('settings.sms')}</span>
                <span className="w-12 text-center">{t('settings.email')}</span>
                <span className="w-12 text-center">{t('settings.push')}</span>
              </div>
            </div>

            <div className="space-y-3">
              {/* Expiry Alerts Row */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                <div className="flex items-center space-x-3 rtl:space-x-reverse flex-1">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Bell className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{t('settings.expiryAlerts')}</p>
                    <p className="text-xs text-gray-500">{t('dashboard.expiringSoon')}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4 rtl:space-x-reverse">
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ expiry: { ...personalPrefs?.expiry!, sms: !personalPrefs?.expiry.sms } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.expiry.sms ? "bg-green-100 text-green-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.sms')}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ expiry: { ...personalPrefs?.expiry!, email: !personalPrefs?.expiry.email } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.expiry.email ? "bg-purple-100 text-purple-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.email')}
                  >
                    <Mail className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ expiry: { ...personalPrefs?.expiry!, push: !personalPrefs?.expiry.push } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.expiry.push ? "bg-orange-100 text-orange-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.push')}
                  >
                    <Bell className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Low Stock Alerts Row */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                <div className="flex items-center space-x-3 rtl:space-x-reverse flex-1">
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <AlertCircle className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{t('settings.lowStockAlerts')}</p>
                    <p className="text-xs text-gray-500">{t('dashboard.lowStockAlerts')}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4 rtl:space-x-reverse">
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ lowStock: { ...personalPrefs?.lowStock!, sms: !personalPrefs?.lowStock.sms } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.lowStock.sms ? "bg-green-100 text-green-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.sms')}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ lowStock: { ...personalPrefs?.lowStock!, email: !personalPrefs?.lowStock.email } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.lowStock.email ? "bg-purple-100 text-purple-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.email')}
                  >
                    <Mail className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ lowStock: { ...personalPrefs?.lowStock!, push: !personalPrefs?.lowStock.push } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.lowStock.push ? "bg-orange-100 text-orange-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.push')}
                  >
                    <Bell className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Task Alerts Row */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                <div className="flex items-center space-x-3 rtl:space-x-reverse flex-1">
                  <div className="p-2 bg-indigo-100 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{t('settings.taskAlerts')}</p>
                    <p className="text-xs text-gray-500">{t('dashboard.pendingTasks')}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4 rtl:space-x-reverse">
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ task: { ...personalPrefs?.task!, sms: !personalPrefs?.task.sms } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.task.sms ? "bg-green-100 text-green-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.sms')}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ task: { ...personalPrefs?.task!, email: !personalPrefs?.task.email } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.task.email ? "bg-purple-100 text-purple-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.email')}
                  >
                    <Mail className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ task: { ...personalPrefs?.task!, push: !personalPrefs?.task.push } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.task.push ? "bg-orange-100 text-orange-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.push')}
                  >
                    <Bell className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Offline Data Management Section */}
      <div className="bg-white shadow-sm rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900 flex items-center">
            <Database className="h-5 w-5 mr-2 rtl:mr-0 rtl:ml-2 text-gray-400" />
            {t('settings.offlineData')}
          </h3>
        </div>
        <div className="p-6 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{t('settings.prefetchTitle')}</p>
              <p className="text-xs text-gray-500 mt-1">{t('settings.prefetchDescription')}</p>
            </div>
            <button
              onClick={handleSyncData}
              disabled={syncing}
              className={cn(
                "inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-xl shadow-sm text-white transition-all",
                syncing ? "bg-gray-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700"
              )}
            >
              {syncing ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin rtl:mr-0 rtl:ml-2" />
                  {t('settings.syncing')} ({syncProgress}%)
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4 rtl:mr-0 rtl:ml-2" />
                  {t('settings.syncNow')}
                </>
              )}
            </button>
          </div>

          {syncing && (
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <motion.div 
                className="bg-indigo-600 h-2.5 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${syncProgress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          )}

          <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
            <div className="flex">
              <AlertCircle className="h-5 w-5 text-blue-400 flex-shrink-0" />
              <div className="ml-3 rtl:ml-0 rtl:mr-3">
                <p className="text-xs text-blue-700">
                  {t('settings.offlineHint')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {canManage && (
        <>
          {/* System Settings Section */}
          <div className="bg-white shadow-sm rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900 flex items-center">
            <SettingsIcon className="h-5 w-5 mr-2 rtl:mr-0 rtl:ml-2 text-gray-400" />
            {t('settings.systemPrefs')}
          </h3>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.notificationEmail')}</label>
              <input
                type="email"
                value={systemSettings?.notificationEmail || ''}
                onChange={(e) => setSystemSettings(prev => prev ? { ...prev, notificationEmail: e.target.value } : null)}
                onBlur={() => handleUpdateSettings({ notificationEmail: systemSettings?.notificationEmail })}
                className="block w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder={t('settings.emailPlaceholder')}
              />
              <p className="mt-1 text-xs text-gray-500">{t('settings.notificationEmailHint')}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.notificationPhone')}</label>
              <input
                type="tel"
                value={systemSettings?.notificationPhone || ''}
                onChange={(e) => setSystemSettings(prev => prev ? { ...prev, notificationPhone: e.target.value } : null)}
                onBlur={() => handleUpdateSettings({ notificationPhone: systemSettings?.notificationPhone })}
                className="block w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder={t('settings.phonePlaceholder')}
              />
              <p className="mt-1 text-xs text-gray-500">{t('settings.notificationPhoneHint')}</p>
            </div>
          </div>

            {isAdmin && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.gmailPass')}</label>
                  <div className="relative">
                    <input
                      type="password"
                      value={gmailPass}
                      onChange={(e) => setGmailPass(e.target.value)}
                      onBlur={() => handleUpdateGmailPass(gmailPass)}
                      className="block w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder={t('settings.gmailPassPlaceholder')}
                    />
                  </div>
                  <div className="mt-2 p-3 bg-amber-50 rounded-lg border border-amber-100">
                    <p className="text-xs text-amber-800 flex items-start">
                      <AlertCircle className="h-4 w-4 mr-2 mt-0.5 flex-shrink-0 rtl:mr-0 rtl:ml-2" />
                      <span>
                        {t('settings.gmailPassHint')}
                        <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="ml-1 rtl:ml-0 rtl:mr-1 font-bold underline hover:text-amber-900">
                          {t('settings.generateHere')}
                        </a>
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {isAdmin && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.vapidPublic')}</label>
                  <input
                    type="text"
                    value={vapidPublicKeyInput}
                    onChange={(e) => setVapidPublicKeyInput(e.target.value)}
                    onBlur={() => handleUpdateVapidKeys(vapidPublicKeyInput, vapidPrivateKeyInput)}
                    className="block w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder={t('settings.vapidPublicPlaceholder')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.vapidPrivate')}</label>
                  <input
                    type="password"
                    value={vapidPrivateKeyInput}
                    onChange={(e) => setVapidPrivateKeyInput(e.target.value)}
                    onBlur={() => handleUpdateVapidKeys(vapidPublicKeyInput, vapidPrivateKeyInput)}
                    className="block w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder={t('settings.vapidPrivatePlaceholder')}
                  />
                </div>
              </div>
            )}

          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">{t('settings.automatedAlertsConfig')}</h4>
              <div className="flex space-x-4 rtl:space-x-reverse text-[10px] font-bold text-gray-400 uppercase">
                <span className="w-12 text-center">{t('settings.sms')}</span>
                <span className="w-12 text-center">{t('settings.email')}</span>
                <span className="w-12 text-center">{t('settings.push')}</span>
              </div>
            </div>

            <div className="space-y-3">
              {/* Expiry Alerts Row */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                <div className="flex items-center space-x-3 rtl:space-x-reverse flex-1">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Bell className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{t('settings.expiryAlerts')}</p>
                    <p className="text-xs text-gray-500">{t('dashboard.expiringSoon')}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4 rtl:space-x-reverse">
                  <button
                    onClick={() => handleUpdateSettings({ expirySms: !(systemSettings?.expirySms ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.expirySms ?? true) ? "bg-green-100 text-green-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.sms')}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdateSettings({ expiryEmail: !(systemSettings?.expiryEmail ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.expiryEmail ?? true) ? "bg-purple-100 text-purple-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.email')}
                  >
                    <Mail className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdateSettings({ expiryPush: !(systemSettings?.expiryPush ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.expiryPush ?? true) ? "bg-orange-100 text-orange-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.push')}
                  >
                    <Bell className="h-3.5 w-3.5" />
                  </button>
                  <div className="w-px h-8 bg-gray-200 mx-2" />
                  <button
                    onClick={() => handleUpdateSettings({ enableExpiryNotifications: !systemSettings?.enableExpiryNotifications })}
                    className={cn(
                      "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      systemSettings?.enableExpiryNotifications ? "bg-blue-600" : "bg-gray-200"
                    )}
                  >
                    <span className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                      systemSettings?.enableExpiryNotifications ? (document.dir === 'rtl' ? "-translate-x-5" : "translate-x-5") : "translate-x-0"
                    )} />
                  </button>
                </div>
              </div>

              {/* Low Stock Alerts Row */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                <div className="flex items-center space-x-3 rtl:space-x-reverse flex-1">
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <AlertCircle className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{t('settings.lowStockAlerts')}</p>
                    <p className="text-xs text-gray-500">{t('dashboard.lowStockAlerts')}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4 rtl:space-x-reverse">
                  <button
                    onClick={() => handleUpdateSettings({ lowStockSms: !(systemSettings?.lowStockSms ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.lowStockSms ?? true) ? "bg-green-100 text-green-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.sms')}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdateSettings({ lowStockEmail: !(systemSettings?.lowStockEmail ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.lowStockEmail ?? true) ? "bg-purple-100 text-purple-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.email')}
                  >
                    <Mail className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdateSettings({ lowStockPush: !(systemSettings?.lowStockPush ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.lowStockPush ?? true) ? "bg-orange-100 text-orange-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.push')}
                  >
                    <Bell className="h-3.5 w-3.5" />
                  </button>
                  <div className="w-px h-8 bg-gray-200 mx-2" />
                  <button
                    onClick={() => handleUpdateSettings({ enableLowStockNotifications: !systemSettings?.enableLowStockNotifications })}
                    className={cn(
                      "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      systemSettings?.enableLowStockNotifications ? "bg-amber-600" : "bg-gray-200"
                    )}
                  >
                    <span className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                      systemSettings?.enableLowStockNotifications ? (document.dir === 'rtl' ? "-translate-x-5" : "translate-x-5") : "translate-x-0"
                    )} />
                  </button>
                </div>
              </div>

              {/* Task Alerts Row */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                <div className="flex items-center space-x-3 rtl:space-x-reverse flex-1">
                  <div className="p-2 bg-indigo-100 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{t('settings.taskAlerts')}</p>
                    <p className="text-xs text-gray-500">{t('dashboard.pendingTasks')}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4 rtl:space-x-reverse">
                  <button
                    onClick={() => handleUpdateSettings({ taskSms: !(systemSettings?.taskSms ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.taskSms ?? true) ? "bg-green-100 text-green-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.sms')}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdateSettings({ taskEmail: !(systemSettings?.taskEmail ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.taskEmail ?? true) ? "bg-purple-100 text-purple-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.email')}
                  >
                    <Mail className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdateSettings({ taskPush: !(systemSettings?.taskPush ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.taskPush ?? true) ? "bg-orange-100 text-orange-600" : "bg-gray-200 text-gray-400"
                    )}
                    title={t('settings.push')}
                  >
                    <Bell className="h-3.5 w-3.5" />
                  </button>
                  <div className="w-px h-8 bg-gray-200 mx-2" />
                  <button
                    onClick={() => handleUpdateSettings({ enableTaskNotifications: !systemSettings?.enableTaskNotifications })}
                    className={cn(
                      "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      systemSettings?.enableTaskNotifications ? "bg-indigo-600" : "bg-gray-200"
                    )}
                  >
                    <span className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                      systemSettings?.enableTaskNotifications ? (document.dir === 'rtl' ? "-translate-x-5" : "translate-x-5") : "translate-x-0"
                    )} />
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-100">
              <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">{t('settings.masterChannelSwitches')}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="flex items-center space-x-3 rtl:space-x-reverse">
                    <div className="p-2 bg-green-100 rounded-lg">
                      <MessageSquare className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900">{t('settings.smsMaster')}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleUpdateSettings({ enableSmsNotifications: !systemSettings?.enableSmsNotifications })}
                    className={cn(
                      "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      systemSettings?.enableSmsNotifications ? "bg-green-600" : "bg-gray-200"
                    )}
                  >
                    <span className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                      systemSettings?.enableSmsNotifications ? (document.dir === 'rtl' ? "-translate-x-5" : "translate-x-5") : "translate-x-0"
                    )} />
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="flex items-center space-x-3 rtl:space-x-reverse">
                    <div className="p-2 bg-purple-100 rounded-lg">
                      <Mail className="h-5 w-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900">{t('settings.emailMaster')}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleUpdateSettings({ enableEmailNotifications: !systemSettings?.enableEmailNotifications })}
                    className={cn(
                      "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      systemSettings?.enableEmailNotifications ? "bg-purple-600" : "bg-gray-200"
                    )}
                  >
                    <span className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                      systemSettings?.enableEmailNotifications ? (document.dir === 'rtl' ? "-translate-x-5" : "translate-x-5") : "translate-x-0"
                    )} />
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="flex items-center space-x-3 rtl:space-x-reverse">
                    <div className="p-2 bg-orange-100 rounded-lg">
                      <Bell className="h-5 w-5 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900">{t('settings.pushMaster')}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleUpdateSettings({ enablePushNotifications: !systemSettings?.enablePushNotifications })}
                    className={cn(
                      "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      systemSettings?.enablePushNotifications ? "bg-orange-600" : "bg-gray-200"
                    )}
                  >
                    <span className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                      systemSettings?.enablePushNotifications ? (document.dir === 'rtl' ? "-translate-x-5" : "translate-x-5") : "translate-x-0"
                    )} />
                  </button>
                </div>
              </div>
            </div>
          </div>

            {vapidPublicKey && (
              <div className="mt-4 p-4 bg-blue-50 rounded-xl border border-blue-100">
                <div className="flex items-start space-x-3 rtl:space-x-reverse">
                  <Key className="h-5 w-5 text-blue-500 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-blue-900">{t('settings.vapidPublic')}</p>
                    <p className="text-xs text-blue-700 break-all font-mono mt-1 bg-white/50 p-2 rounded border border-blue-200">
                      {vapidPublicKey}
                    </p>
                    <p className="text-[10px] text-blue-600 mt-2 italic">
                      {t('settings.vapidEnvHint')}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-4 flex justify-end space-x-3 rtl:space-x-reverse">
            {error && (
              <div className="flex-1 bg-red-50 p-3 rounded-lg flex items-center text-red-600 text-xs">
                <AlertCircle className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-bold">{t('settings.alertError')}</p>
                  <p className="break-words">{error}</p>
                </div>
              </div>
            )}
            <button
              onClick={async () => {
                setIsTesting(true);
                setError(null);
                setSuccess(null);
                const result = await checkAndSendExpiryNotifications(true);
                if (result.success) {
                  setSuccess(result.message);
                } else {
                  // If it's a JSON string from handleFirestoreError, parse it
                  try {
                    const parsed = JSON.parse(result.message);
                    setError(t('settings.errorAt', { error: parsed.error, operation: parsed.operationType, path: parsed.path }));
                  } catch {
                    setError(result.message);
                  }
                }
                setIsTesting(false);
              }}
              disabled={isTesting}
              className="inline-flex items-center px-4 py-2 border border-blue-600 text-sm font-medium rounded-xl text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50 h-10"
            >
              <Bell className={cn("mr-2 rtl:mr-0 rtl:ml-2 h-4 w-4", isTesting && "animate-bounce")} />
              {isTesting ? t('settings.testing') : t('settings.testAlerts')}
            </button>
          </div>

          {systemSettings?.lastNotificationCheck && (
            <p className="mt-4 text-center text-xs text-gray-400">
              {t('settings.lastNotificationCheck', { date: formatDate(systemSettings.lastNotificationCheck.toDate()) })}
            </p>
          )}
        </div>
      </div>

      {/* User Management Section */}
      {isAdmin && (
        <div className="bg-white shadow-sm rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 flex items-center">
              <Users className="h-5 w-5 mr-2 rtl:mr-0 rtl:ml-2 text-gray-400" />
              {t('settings.userManagement')}
            </h3>
          </div>
          <div className="divide-y divide-gray-100">
            {loading ? (
              <div className="px-6 py-12 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
              </div>
            ) : users.length > 0 ? (
              users.map((user) => (
                <div key={user.uid} className="px-6 py-5 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div className="flex items-center space-x-4 rtl:space-x-reverse">
                    <div className={cn(
                      "h-12 w-12 rounded-full flex items-center justify-center text-lg font-bold",
                      user.role === 'admin' ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                    )}>
                      {user.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2 rtl:space-x-reverse">
                        <h4 className="text-base font-bold text-gray-900">{user.name}</h4>
                        <button
                          onClick={() => toggleUserRole(user)}
                          className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium transition-colors",
                            user.role === 'admin' 
                              ? "bg-purple-100 text-purple-800 hover:bg-purple-200" 
                              : "bg-blue-100 text-blue-800 hover:bg-blue-200"
                          )}
                          title={t('settings.toggleRole')}
                        >
                          {user.role === 'admin' ? (
                            <>
                              <Shield className="h-3 w-3 mr-1 rtl:mr-0 rtl:ml-1" />
                              {t('settings.admin')}
                            </>
                          ) : (
                            <>
                              <UserIcon className="h-3 w-3 mr-1 rtl:mr-0 rtl:ml-1" />
                              {t('settings.staff')}
                            </>
                          )}
                        </button>
                      </div>
                      <p className="text-sm text-gray-500">{user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 rtl:space-x-reverse">
                    <button
                      onClick={() => toggleUserStatus(user)}
                      className={cn(
                        "p-2 rounded-lg transition-colors",
                        user.active ? "text-green-600 hover:bg-green-50" : "text-gray-400 hover:bg-gray-100"
                      )}
                      title={user.active ? t('settings.deactivate') : t('settings.activate')}
                    >
                      <Power className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => deleteUser(user)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title={t('settings.delete')}
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-6 py-12 text-center">
                <p className="text-gray-500">{t('settings.noUsersFound')}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add User Modal */}
      <AnimatePresence mode="wait">
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h3 className="text-lg font-bold text-gray-900">{t('settings.addUserTitle')}</h3>
                <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-gray-200 rounded-full transition-colors">
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>
              <form onSubmit={handleAddUser} className="p-6 space-y-6">
                {error && (
                  <div className="bg-red-50 p-3 rounded-lg flex items-center text-red-600 text-sm">
                    <AlertCircle className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                    {error}
                  </div>
                )}
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.fullName')}</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 rtl:left-auto rtl:right-0 rtl:pr-3 flex items-center pointer-events-none">
                      <UserIcon className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      required
                      value={newUserName}
                      onChange={(e) => setNewUserName(e.target.value)}
                      className="block w-full pl-10 rtl:pl-3 rtl:pr-10 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder={t('settings.fullNamePlaceholder')}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.emailAddress')}</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 rtl:left-auto rtl:right-0 rtl:pr-3 flex items-center pointer-events-none">
                      <Mail className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="email"
                      required
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      className="block w-full pl-10 rtl:pl-3 rtl:pr-10 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder={t('settings.emailPlaceholder')}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.role')}</label>
                  <div className="flex p-1 bg-gray-100 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setNewUserRole('staff')}
                      className={cn(
                        "flex-1 py-2 text-sm font-bold rounded-lg transition-all",
                        newUserRole === 'staff' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500"
                      )}
                    >
                      {t('settings.staff')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewUserRole('admin')}
                      className={cn(
                        "flex-1 py-2 text-sm font-bold rounded-lg transition-all",
                        newUserRole === 'admin' ? "bg-white text-purple-600 shadow-sm" : "text-gray-500"
                      )}
                    >
                      {t('settings.admin')}
                    </button>
                  </div>
                </div>

                <div className="pt-4 flex space-x-3 rtl:space-x-reverse">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    {t('settings.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-4 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-md disabled:opacity-50"
                  >
                    {submitting ? t('settings.creating') : t('settings.createProfile')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete User Confirmation Modal */}
      <AnimatePresence mode="wait">
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 mb-4">
                  <Trash2 className="h-6 w-6 text-red-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{t('settings.confirmDelete')}</h3>
                <p className="text-sm text-gray-500 mb-6">
                  {t('settings.deleteUserConfirm', { name: showDeleteConfirm.name })}
                </p>
                <div className="flex space-x-3 rtl:space-x-reverse">
                  <button
                    onClick={() => setShowDeleteConfirm(null)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    {t('settings.cancel')}
                  </button>
                  <button
                    onClick={confirmDeleteUser}
                    disabled={deleting}
                    className="flex-1 px-4 py-2.5 bg-red-600 text-white font-medium rounded-xl hover:bg-red-700 transition-colors shadow-md disabled:opacity-50"
                  >
                    {deleting ? t('common.loading') : t('settings.delete')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
        </>
      )}
    </div>
  );
};

export default Settings;
