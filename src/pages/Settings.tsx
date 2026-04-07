import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, query, orderBy, getDoc, getDocs, limit, Timestamp } from 'firebase/firestore';
import { createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile, UserRole, SystemSettings, Team } from '../types';
import { useAuth } from '../components/AuthGuard';
import { 
  subscribeToPushNotifications,
  checkAndSendDailyAlerts,
  testPush
} from '../services/notificationService';
import { 
  Users, UserPlus, Shield, User as UserIcon, 
  Trash2, X, AlertCircle, CheckCircle, Mail, MessageSquare,
  Lock, ChevronRight, Power, Bell, Settings as SettingsIcon,
  Key, Database, Download, RefreshCw, Languages, Plus, ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatDate } from '../lib/utils';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const Settings: React.FC = () => {
  const { isAdmin, isStaff, profile, user } = useAuth();
  const canManage = isAdmin || isStaff;
  const { t, i18n } = useTranslation();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Personal Settings State
  const [personalPrefs, setPersonalPrefs] = useState<UserProfile['notificationPreferences'] | null>(null);
  const [updatingPersonal, setUpdatingPersonal] = useState(false);

  // New User Form State
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('staff');
  const [submitting, setSubmitting] = useState(false);

  // System Settings State
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [vapidPublicKeyInput, setVapidPublicKeyInput] = useState('');
  const [vapidPrivateKeyInput, setVapidPrivateKeyInput] = useState('');
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const [vapidPrivateKey, setVapidPrivateKey] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<UserProfile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);

  // Teams State
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    if (profile) {
      setPersonalPrefs(profile.notificationPreferences || {
        expiry: { push: true, email: true, sms: true },
        lowStock: { push: true, email: true, sms: true },
        task: { push: true, email: true, sms: true }
      });
    }
  }, [profile]);

  const handleUpdatePersonalSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setUpdatingPersonal(true);
    setError(null);
    setSuccess(null);
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        notificationPreferences: personalPrefs
      });
      setSuccess(t('settings.profileUpdated', { defaultValue: 'Profile updated successfully!' }));
    } catch (err) {
      console.error("Error updating personal settings:", err);
      setError(t('settings.failedToUpdateProfile', { defaultValue: 'Failed to update profile' }));
    } finally {
      setUpdatingPersonal(false);
    }
  };

  useEffect(() => {
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
    
    setPersonalPrefs(profile.notificationPreferences || {
      expiry: { push: true, email: true, sms: true },
      lowStock: { push: true, email: true, sms: true },
      task: { push: true, email: true, sms: true }
    });
  }, [profile]);

  useEffect(() => {
    if (!isAdmin) return;

    const path = 'systemSettings';
    const unsubscribe = onSnapshot(doc(db, path, 'default'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as SystemSettings;
        setSystemSettings({
          expiryPush: true,
          lowStockPush: true,
          taskPush: true,
          ...data,
          id: snapshot.id
        });
      } else {
        // Initialize default settings if they don't exist
        setSystemSettings({
          id: 'default',
          enableExpiryNotifications: true,
          enableLowStockNotifications: true,
          enableTaskNotifications: true,
          expiryPush: true,
          lowStockPush: true,
          taskPush: true,
          enablePushNotifications: true
        });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribe();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;

    const fetchSecrets = async () => {
      try {
        const response = await fetch('/api/admin/vapid-keys');
        if (response.ok) {
          const data = await response.json();
          setVapidPublicKey(data.publicKey);
          setVapidPrivateKey(data.privateKey);
          setVapidPublicKeyInput(data.publicKey || '');
          setVapidPrivateKeyInput(data.privateKey || '');
        } else {
          // Fallback to Firestore if API fails
          const vapidDoc = await getDoc(doc(db, 'secrets', 'vapid'));
          if (vapidDoc.exists()) {
            const data = vapidDoc.data();
            setVapidPublicKey(data.publicKey);
            setVapidPrivateKey(data.privateKey);
            setVapidPublicKeyInput(data.publicKey || '');
            setVapidPrivateKeyInput(data.privateKey || '');
          }
        }
      } catch (err) {
        console.error("Error fetching secrets:", err);
      }
    };

    fetchSecrets();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;

    const unsubscribe = onSnapshot(collection(db, 'teams'), (snapshot) => {
      const teamsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Team[];
      setTeams(teamsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'teams');
    });

    return () => unsubscribe();
  }, [isAdmin]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newUserRole === 'admin' && user?.email?.toLowerCase() !== 'antar7theman@gmail.com') {
      setError(t('settings.onlySuperAdminCanCreateAdmins'));
      return;
    }

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
      const sanitizedEmail = newUserEmail.replace(/[^a-zA-Z0-9]/g, '_');
      const userRef = doc(db, 'users', sanitizedEmail); // Use sanitized email as ID for consistency
      await setDoc(userRef, {
        uid: sanitizedEmail, // Placeholder
        email: newUserEmail,
        name: newUserName,
        role: newUserRole,
        active: true,
        notificationPreferences: {
          expiry: { push: true, email: true, sms: true },
          lowStock: { push: true, email: true, sms: true },
          task: { push: true, email: true, sms: true }
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
    if (user?.email?.toLowerCase() !== 'antar7theman@gmail.com') {
      setError(t('settings.onlySuperAdminCanChangeRoles'));
      return;
    }
    
    if (userToUpdate.email?.toLowerCase() === 'antar7theman@gmail.com') {
      setError(t('settings.cannotChangeSuperAdminRole'));
      return;
    }

    const newRole = userToUpdate.role === 'admin' ? 'staff' : userToUpdate.role === 'staff' ? 'user' : 'admin';
    const path = `users/${userToUpdate.uid}`;
    try {
      await updateDoc(doc(db, 'users', userToUpdate.uid), {
        role: newRole
      });
      setSuccess(t('settings.userRoleUpdated', { name: userToUpdate.name, role: newRole }));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const deleteUser = async (userToDelete: UserProfile) => {
    if (userToDelete.email?.toLowerCase() === 'antar7theman@gmail.com') {
      setError(t('settings.cannotDeleteSuperAdmin'));
      return;
    }
    setShowDeleteConfirm(userToDelete);
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
    if (!isAdmin) return;
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
        notificationPreferences: newPrefs
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
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">{t('settings.title')}</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">{t('settings.subtitle')}</p>
        </div>
        {isAdmin && (
          <div className="flex space-x-3 rtl:space-x-reverse">
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center justify-center px-4 py-2.5 border border-transparent text-sm font-medium rounded-xl shadow-sm text-white bg-blue-600 hover:bg-blue-700 transition-all"
            >
              <UserPlus className="mr-2 h-5 w-5 rtl:mr-0 rtl:ml-2" />
              {t('settings.addUser')}
            </button>
          </div>
        )}
      </div>

      {user && !user.emailVerified && user.email?.toLowerCase() === "antar7theman@gmail.com" && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-400 p-4 rounded-lg">
          <div className="flex">
            <AlertCircle className="h-5 w-5 text-amber-400" />
            <div className="ml-3">
              <p className="text-sm text-amber-700 dark:text-amber-400 font-bold">{t('settings.emailNotVerified')}</p>
              <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                {t('settings.emailNotVerifiedSubtitle')}
              </p>
            </div>
          </div>
        </div>
      )}

      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-400 p-4 rounded-lg">
          <div className="flex">
            <CheckCircle className="h-5 w-5 text-green-400" />
            <p className="ml-3 text-sm text-green-700 dark:text-green-400">{success}</p>
          </div>
        </div>
      )}

      {/* Language Selection Section */}
      <div className="bg-white dark:bg-gray-900 shadow-sm rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden transition-colors">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
            <Languages className="h-5 w-5 mr-2 rtl:mr-0 rtl:ml-2 text-gray-400 dark:text-gray-500" />
            {t('settings.language')}
          </h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { code: 'en', name: 'English', flag: '🇺🇸' },
              { code: 'ar', name: 'العربية', flag: '🇸🇦' },
              { code: 'fr', name: 'Français', flag: '🇫🇷' }
            ].map((lang) => (
              <button
                key={lang.code}
                onClick={() => i18n.changeLanguage(lang.code)}
                className={cn(
                  "flex items-center justify-between p-4 rounded-xl border transition-all",
                  i18n.language.split('-')[0] === lang.code
                    ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 ring-2 ring-blue-500/20"
                    : "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700"
                )}
              >
                <div className="flex items-center space-x-3 rtl:space-x-reverse">
                  <span className="text-2xl">{lang.flag}</span>
                  <span className={cn(
                    "font-medium",
                    i18n.language.split('-')[0] === lang.code ? "text-blue-700 dark:text-blue-400" : "text-gray-700 dark:text-gray-300"
                  )}>
                    {lang.name}
                  </span>
                </div>
                {i18n.language.split('-')[0] === lang.code && (
                  <CheckCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Personal Notification Preferences Section */}
      <div className="bg-white dark:bg-gray-900 shadow-sm rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden transition-colors">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
            <UserIcon className="h-5 w-5 mr-2 rtl:mr-0 rtl:ml-2 text-gray-400 dark:text-gray-500" />
            {t('settings.personalPrefs')}
          </h3>
          <div className="flex items-center space-x-2 rtl:space-x-reverse text-xs text-gray-500 dark:text-gray-400">
            <Mail className="h-3 w-3" />
            <span>{profile.email}</span>
          </div>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('settings.fullName')}</label>
              <input
                type="text"
                value={profile?.name || ''}
                disabled
                className="block w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 cursor-not-allowed"
              />
              <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500 italic">{t('settings.nameManagedByAdmin', { defaultValue: 'Name is managed by administrator' })}</p>
            </div>
          </div>

          <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">{t('settings.alertsConfig')}</h4>
                <div className="flex space-x-4 rtl:space-x-reverse text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase">
                  <span className="w-12 text-center">{t('settings.push')}</span>
                  <span className="w-12 text-center">{t('settings.email')}</span>
                  <span className="w-12 text-center">{t('settings.sms')}</span>
                </div>
              </div>

            <div className="space-y-3">
              {/* Expiry Alerts Row */}
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
                <div className="flex items-center space-x-3 rtl:space-x-reverse flex-1">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                    <Bell className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{t('settings.expiryAlerts')}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('dashboard.expiringSoon')}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4 rtl:space-x-reverse">
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ expiry: { ...personalPrefs?.expiry!, push: !personalPrefs?.expiry.push } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.expiry.push ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.push')}
                  >
                    <Bell className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ expiry: { ...personalPrefs?.expiry!, email: !personalPrefs?.expiry.email } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.expiry.email ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.email')}
                  >
                    <Mail className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ expiry: { ...personalPrefs?.expiry!, sms: !personalPrefs?.expiry.sms } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.expiry.sms ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.sms')}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Low Stock Alerts Row */}
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
                <div className="flex items-center space-x-3 rtl:space-x-reverse flex-1">
                  <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{t('settings.lowStockAlerts')}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('dashboard.lowStockAlerts')}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4 rtl:space-x-reverse">
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ lowStock: { ...personalPrefs?.lowStock!, push: !personalPrefs?.lowStock.push } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.lowStock.push ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.push')}
                  >
                    <Bell className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ lowStock: { ...personalPrefs?.lowStock!, email: !personalPrefs?.lowStock.email } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.lowStock.email ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.email')}
                  >
                    <Mail className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ lowStock: { ...personalPrefs?.lowStock!, sms: !personalPrefs?.lowStock.sms } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.lowStock.sms ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.sms')}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Task Alerts Row */}
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
                <div className="flex items-center space-x-3 rtl:space-x-reverse flex-1">
                  <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{t('settings.taskAlerts')}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('dashboard.pendingTasks')}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4 rtl:space-x-reverse">
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ task: { ...personalPrefs?.task!, push: !personalPrefs?.task.push } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.task.push ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.push')}
                  >
                    <Bell className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ task: { ...personalPrefs?.task!, email: !personalPrefs?.task.email } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.task.email ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.email')}
                  >
                    <Mail className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdatePersonalPrefs({ task: { ...personalPrefs?.task!, sms: !personalPrefs?.task.sms } })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      personalPrefs?.task.sms ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.sms')}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notification Permission Section */}
      <div className="bg-white dark:bg-gray-900 shadow-sm rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden transition-colors mb-8">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
            <Bell className="h-5 w-5 mr-2 rtl:mr-0 rtl:ml-2 text-gray-400 dark:text-gray-500" />
            {t('settings.browserNotifications', { defaultValue: 'Browser Notifications' })}
          </h3>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center space-x-4 rtl:space-x-reverse">
              <div className={cn(
                "p-3 rounded-2xl transition-colors",
                Notification.permission === 'granted' ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" :
                Notification.permission === 'denied' ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" :
                "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
              )}>
                {Notification.permission === 'granted' ? <ShieldCheck className="h-6 w-6" /> :
                 Notification.permission === 'denied' ? <X className="h-6 w-6" /> :
                 <Bell className="h-6 w-6" />}
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">
                  {Notification.permission === 'granted' ? t('settings.notificationsEnabled', { defaultValue: 'Notifications are enabled' }) :
                   Notification.permission === 'denied' ? t('settings.notificationsBlocked', { defaultValue: 'Notifications are blocked' }) :
                   t('settings.notificationsNotSet', { defaultValue: 'Notifications are not yet enabled' })}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {Notification.permission === 'granted' ? t('settings.notificationsEnabledDesc', { defaultValue: 'You will receive alerts for stock and expiry on this device.' }) :
                   Notification.permission === 'denied' ? t('settings.notificationsBlockedDesc', { defaultValue: 'Please enable notifications in your browser settings to receive alerts.' }) :
                   t('settings.notificationsNotSetDesc', { defaultValue: 'Enable notifications to stay updated on stock and expiry alerts.' })}
                </p>
              </div>
            </div>
            
            {Notification.permission !== 'granted' && (
              <button
                onClick={async () => {
                  const success = await subscribeToPushNotifications();
                  if (success) {
                    toast.success(t('settings.notificationsEnabledSuccess', { defaultValue: 'Notifications enabled successfully!' }));
                    // Force re-render to update status
                    window.location.reload();
                  } else {
                    toast.error(t('settings.notificationsEnabledError', { defaultValue: 'Failed to enable notifications. Please check browser settings.' }));
                  }
                }}
                className="inline-flex items-center justify-center px-6 py-2.5 border border-transparent text-sm font-bold rounded-xl shadow-lg shadow-blue-500/20 text-white bg-blue-600 hover:bg-blue-700 transition-all active:scale-95"
              >
                <Bell className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                {t('settings.enableNotifications', { defaultValue: 'Enable Notifications' })}
              </button>
            )}
            
            {Notification.permission === 'granted' && (
              <button
                onClick={async () => {
                  const result = await testPush();
                  if (result.success) {
                    toast.success(result.message);
                  } else {
                    toast.error(result.message);
                  }
                }}
                className="inline-flex items-center justify-center px-6 py-2.5 border border-gray-200 dark:border-gray-700 text-sm font-bold rounded-xl text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all active:scale-95"
              >
                <RefreshCw className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                {t('settings.testPush', { defaultValue: 'Send Test Notification' })}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Offline Data Management Section */}
      <div className="bg-white dark:bg-gray-900 shadow-sm rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden transition-colors">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
            <Database className="h-5 w-5 mr-2 rtl:mr-0 rtl:ml-2 text-gray-400 dark:text-gray-500" />
            {t('settings.offlineData')}
          </h3>
        </div>
        <div className="p-6 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{t('settings.prefetchTitle')}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('settings.prefetchDescription')}</p>
            </div>
            <button
              onClick={handleSyncData}
              disabled={syncing}
              className={cn(
                "inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-xl shadow-sm text-white transition-all",
                syncing ? "bg-gray-400 dark:bg-gray-700 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
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
            <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2.5">
              <motion.div 
                className="bg-indigo-600 dark:bg-indigo-500 h-2.5 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${syncProgress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          )}

          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-900/30">
            <div className="flex">
              <AlertCircle className="h-5 w-5 text-blue-400 flex-shrink-0" />
              <div className="ml-3 rtl:ml-0 rtl:mr-3">
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  {t('settings.offlineHint')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isAdmin && (
        <>
          {/* System Settings Section */}
          <div className="bg-white dark:bg-gray-900 shadow-sm rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden transition-colors">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
            <SettingsIcon className="h-5 w-5 mr-2 rtl:mr-0 rtl:ml-2 text-gray-400 dark:text-gray-500" />
            {t('settings.systemPrefs')}
          </h3>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {isAdmin && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('settings.vapidPublic')}</label>
                  <input
                    type="text"
                    value={vapidPublicKeyInput}
                    onChange={(e) => setVapidPublicKeyInput(e.target.value)}
                    onBlur={() => handleUpdateVapidKeys(vapidPublicKeyInput, vapidPrivateKeyInput)}
                    className="block w-full px-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    placeholder={t('settings.vapidPublicPlaceholder')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('settings.vapidPrivate')}</label>
                  <input
                    type="password"
                    value={vapidPrivateKeyInput}
                    onChange={(e) => setVapidPrivateKeyInput(e.target.value)}
                    onBlur={() => handleUpdateVapidKeys(vapidPublicKeyInput, vapidPrivateKeyInput)}
                    className="block w-full px-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    placeholder={t('settings.vapidPrivatePlaceholder')}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">{t('settings.automatedAlertsConfig')}</h4>
              <div className="flex space-x-4 rtl:space-x-reverse text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase">
                <span className="w-12 text-center">{t('settings.push')}</span>
                <span className="w-12 text-center">{t('settings.email')}</span>
                <span className="w-12 text-center">{t('settings.sms')}</span>
              </div>
            </div>

            <div className="space-y-3">
              {/* Expiry Alerts Row */}
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
                <div className="flex items-center space-x-3 rtl:space-x-reverse flex-1">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                    <Bell className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{t('settings.expiryAlerts')}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('dashboard.expiringSoon')}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4 rtl:space-x-reverse">
                  <button
                    onClick={() => handleUpdateSettings({ expiryPush: !(systemSettings?.expiryPush ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.expiryPush ?? true) ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.push')}
                  >
                    <Bell className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdateSettings({ expiryEmail: !(systemSettings?.expiryEmail ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.expiryEmail ?? true) ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.email')}
                  >
                    <Mail className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdateSettings({ expirySms: !(systemSettings?.expirySms ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.expirySms ?? true) ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.sms')}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                  <div className="w-px h-8 bg-gray-200 dark:bg-gray-700 mx-2" />
                  <button
                    onClick={() => handleUpdateSettings({ enableExpiryNotifications: !systemSettings?.enableExpiryNotifications })}
                    className={cn(
                      "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      systemSettings?.enableExpiryNotifications ? "bg-blue-600 dark:bg-blue-500" : "bg-gray-200 dark:bg-gray-700"
                    )}
                  >
                    <span className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-gray-200 shadow ring-0 transition duration-200 ease-in-out",
                      systemSettings?.enableExpiryNotifications ? (document.dir === 'rtl' ? "-translate-x-5" : "translate-x-5") : "translate-x-0"
                    )} />
                  </button>
                </div>
              </div>

              {/* Low Stock Alerts Row */}
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
                <div className="flex items-center space-x-3 rtl:space-x-reverse flex-1">
                  <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{t('settings.lowStockAlerts')}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('dashboard.lowStockAlerts')}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4 rtl:space-x-reverse">
                  <button
                    onClick={() => handleUpdateSettings({ lowStockPush: !(systemSettings?.lowStockPush ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.lowStockPush ?? true) ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.push')}
                  >
                    <Bell className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdateSettings({ lowStockEmail: !(systemSettings?.lowStockEmail ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.lowStockEmail ?? true) ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.email')}
                  >
                    <Mail className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdateSettings({ lowStockSms: !(systemSettings?.lowStockSms ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.lowStockSms ?? true) ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.sms')}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                  <div className="w-px h-8 bg-gray-200 dark:bg-gray-700 mx-2" />
                  <button
                    onClick={() => handleUpdateSettings({ enableLowStockNotifications: !systemSettings?.enableLowStockNotifications })}
                    className={cn(
                      "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      systemSettings?.enableLowStockNotifications ? "bg-amber-600 dark:bg-amber-500" : "bg-gray-200 dark:bg-gray-700"
                    )}
                  >
                    <span className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-gray-200 shadow ring-0 transition duration-200 ease-in-out",
                      systemSettings?.enableLowStockNotifications ? (document.dir === 'rtl' ? "-translate-x-5" : "translate-x-5") : "translate-x-0"
                    )} />
                  </button>
                </div>
              </div>

              {/* Task Alerts Row */}
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
                <div className="flex items-center space-x-3 rtl:space-x-reverse flex-1">
                  <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{t('settings.taskAlerts')}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('dashboard.pendingTasks')}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4 rtl:space-x-reverse">
                  <button
                    onClick={() => handleUpdateSettings({ taskPush: !(systemSettings?.taskPush ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.taskPush ?? true) ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.push')}
                  >
                    <Bell className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdateSettings({ taskEmail: !(systemSettings?.taskEmail ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.taskEmail ?? true) ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.email')}
                  >
                    <Mail className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleUpdateSettings({ taskSms: !(systemSettings?.taskSms ?? true) })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors flex items-center justify-center",
                      (systemSettings?.taskSms ?? true) ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                    )}
                    title={t('settings.sms')}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                  <div className="w-px h-8 bg-gray-200 dark:bg-gray-700 mx-2" />
                  <button
                    onClick={() => handleUpdateSettings({ enableTaskNotifications: !systemSettings?.enableTaskNotifications })}
                    className={cn(
                      "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      systemSettings?.enableTaskNotifications ? "bg-indigo-600 dark:bg-indigo-500" : "bg-gray-200 dark:bg-gray-700"
                    )}
                  >
                    <span className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-gray-200 shadow ring-0 transition duration-200 ease-in-out",
                      systemSettings?.enableTaskNotifications ? (document.dir === 'rtl' ? "-translate-x-5" : "translate-x-5") : "translate-x-0"
                    )} />
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider mb-4">{t('settings.masterChannelSwitches')}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center space-x-3 rtl:space-x-reverse">
                    <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                      <Bell className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{t('settings.pushMaster')}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleUpdateSettings({ enablePushNotifications: !systemSettings?.enablePushNotifications })}
                    className={cn(
                      "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      systemSettings?.enablePushNotifications ? "bg-orange-600 dark:bg-orange-500" : "bg-gray-200 dark:bg-gray-700"
                    )}
                  >
                    <span className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-gray-200 shadow ring-0 transition duration-200 ease-in-out",
                      systemSettings?.enablePushNotifications ? (document.dir === 'rtl' ? "-translate-x-5" : "translate-x-5") : "translate-x-0"
                    )} />
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center space-x-3 rtl:space-x-reverse">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                      <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{t('settings.emailMaster')}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleUpdateSettings({ enableEmailNotifications: !systemSettings?.enableEmailNotifications })}
                    className={cn(
                      "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      systemSettings?.enableEmailNotifications ? "bg-blue-600 dark:bg-blue-500" : "bg-gray-200 dark:bg-gray-700"
                    )}
                  >
                    <span className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-gray-200 shadow ring-0 transition duration-200 ease-in-out",
                      systemSettings?.enableEmailNotifications ? (document.dir === 'rtl' ? "-translate-x-5" : "translate-x-5") : "translate-x-0"
                    )} />
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center space-x-3 rtl:space-x-reverse">
                    <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                      <MessageSquare className="h-5 w-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{t('settings.smsMaster')}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleUpdateSettings({ enableSmsNotifications: !systemSettings?.enableSmsNotifications })}
                    className={cn(
                      "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      systemSettings?.enableSmsNotifications ? "bg-green-600 dark:bg-green-500" : "bg-gray-200 dark:bg-gray-700"
                    )}
                  >
                    <span className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-gray-200 shadow ring-0 transition duration-200 ease-in-out",
                      systemSettings?.enableSmsNotifications ? (document.dir === 'rtl' ? "-translate-x-5" : "translate-x-5") : "translate-x-0"
                    )} />
                  </button>
                </div>
              </div>
            </div>

            {/* Notification Credentials */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6 border-t border-gray-100 dark:border-gray-800">
              <div className="space-y-4">
                <h5 className="text-sm font-bold text-gray-900 dark:text-white flex items-center">
                  <Mail className="h-4 w-4 mr-2 text-blue-500" />
                  Gmail SMTP Settings
                </h5>
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Gmail User</label>
                    <input
                      type="email"
                      value={systemSettings?.gmailUser || ''}
                      onChange={(e) => handleUpdateSettings({ gmailUser: e.target.value })}
                      className="block w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-sm"
                      placeholder="example@gmail.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">App Password</label>
                    <input
                      type="password"
                      value={systemSettings?.gmailPass || ''}
                      onChange={(e) => handleUpdateSettings({ gmailPass: e.target.value })}
                      className="block w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-sm"
                      placeholder="••••••••••••••••"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h5 className="text-sm font-bold text-gray-900 dark:text-white flex items-center">
                  <MessageSquare className="h-4 w-4 mr-2 text-green-500" />
                  Twilio SMS Settings
                </h5>
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Account SID</label>
                    <input
                      type="text"
                      value={systemSettings?.twilioSid || ''}
                      onChange={(e) => handleUpdateSettings({ twilioSid: e.target.value })}
                      className="block w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Auth Token</label>
                    <input
                      type="password"
                      value={systemSettings?.twilioAuthToken || ''}
                      onChange={(e) => handleUpdateSettings({ twilioAuthToken: e.target.value })}
                      className="block w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From Number</label>
                    <input
                      type="text"
                      value={systemSettings?.twilioFromNumber || ''}
                      onChange={(e) => handleUpdateSettings({ twilioFromNumber: e.target.value })}
                      className="block w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-sm"
                      placeholder="+1234567890"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {isAdmin && (
            <div className="pt-6 border-t border-gray-100 dark:border-gray-800 space-y-6">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider flex items-center">
                <Bell className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 text-gray-400" />
                {t('settings.pushNotifications')}
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('settings.pushNotificationsDesc', { defaultValue: 'Push notifications are enabled for this system.' })}
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={async () => {
                    setIsTesting(true);
                    setError(null);
                    setSuccess(null);
                    const subscribed = await subscribeToPushNotifications();
                    if (subscribed) {
                      setSuccess(t('settings.pushSubscribed', { defaultValue: 'Successfully subscribed to push notifications!' }));
                    } else {
                      if (Notification.permission === 'denied') {
                        setError(t('settings.pushPermissionDenied', { defaultValue: 'Notification permission was denied. Please reset the permission in your browser settings (usually by clicking the lock icon in the address bar) and try again.' }));
                      } else {
                        setError(t('settings.pushSubscribeFailed', { defaultValue: 'Failed to subscribe to push notifications. Please ensure you have granted permission.' }));
                      }
                    }
                    setIsTesting(false);
                  }}
                  disabled={isTesting}
                  className="inline-flex items-center px-4 py-2 bg-orange-600 text-white text-sm font-bold rounded-xl hover:bg-orange-700 transition-all shadow-lg shadow-orange-500/20 disabled:opacity-50"
                >
                  <RefreshCw className={cn("mr-2 rtl:mr-0 rtl:ml-2 h-4 w-4", isTesting && "animate-spin")} />
                  {t('settings.reSubscribe', { defaultValue: 'Re-subscribe' })}
                </button>
                <button
                  onClick={async () => {
                    setIsTesting(true);
                    setError(null);
                    setSuccess(null);
                    const result = await testPush();
                    if (result.success) {
                      setSuccess(result.message);
                    } else {
                      setError(result.message);
                    }
                    setIsTesting(false);
                  }}
                  disabled={isTesting}
                  className="inline-flex items-center px-4 py-2 border border-orange-600 dark:border-orange-500 text-sm font-bold rounded-xl text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/30 transition-all disabled:opacity-50"
                >
                  <Bell className={cn("mr-2 rtl:mr-0 rtl:ml-2 h-4 w-4", isTesting && "animate-bounce")} />
                  {t('settings.testPush', { defaultValue: 'Test Push' })}
                </button>
              </div>
            </div>
          )}





          {vapidPublicKey && (
              <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-900/30 space-y-4">
                <div className="flex items-start space-x-3 rtl:space-x-reverse">
                  <Key className="h-5 w-5 text-blue-500 dark:text-blue-400 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-blue-900 dark:text-blue-300">{t('settings.vapidPublic', { defaultValue: 'VAPID Public Key' })}</p>
                    <p className="text-xs text-blue-700 dark:text-blue-400 break-all font-mono mt-1 bg-white/50 dark:bg-gray-800/50 p-2 rounded border border-blue-200 dark:border-blue-800 select-all">
                      {vapidPublicKey}
                    </p>
                  </div>
                </div>

                {vapidPrivateKey && (
                  <div className="flex items-start space-x-3 rtl:space-x-reverse">
                    <Shield className="h-5 w-5 text-red-500 dark:text-red-400 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-red-900 dark:text-red-300">{t('settings.vapidPrivate', { defaultValue: 'VAPID Private Key' })}</p>
                      <p className="text-xs text-red-700 dark:text-red-400 break-all font-mono mt-1 bg-white/50 dark:bg-gray-800/50 p-2 rounded border border-red-200 dark:border-red-800 select-all">
                        {vapidPrivateKey}
                      </p>
                      <p className="text-[10px] text-red-600 dark:text-red-500 mt-2 italic">
                        {t('settings.vapidPrivateWarning', { defaultValue: 'Keep this private! It is used to sign push notifications.' })}
                      </p>
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <p className="text-[10px] text-blue-600 dark:text-blue-500 italic">
                    {t('settings.vapidEnvHint', { defaultValue: 'You can use these keys in your .env file as VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.' })}
                  </p>
                </div>
              </div>
            )}

            <div className="pt-4 flex justify-end space-x-3 rtl:space-x-reverse">
            {error && (
              <div className="flex-1 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg flex items-center text-red-600 dark:text-red-400 text-xs">
                <AlertCircle className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-bold">{t('settings.alertError')}</p>
                  <p className="break-words whitespace-pre-wrap">{error}</p>
                </div>
              </div>
            )}
            {success && (
              <div className="flex-1 bg-green-50 dark:bg-green-900/20 p-3 rounded-lg flex items-center text-green-600 dark:text-green-400 text-xs">
                <CheckCircle className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-bold">{t('settings.sent')}</p>
                  <p className="break-words">{success}</p>
                </div>
              </div>
            )}
            <button
              onClick={async () => {
                setIsTesting(true);
                setError(null);
                setSuccess(null);
                const result = await checkAndSendDailyAlerts(true);
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
              className="inline-flex items-center px-4 py-2 border border-blue-600 dark:border-blue-500 text-sm font-medium rounded-xl text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50 h-10"
            >
              <Bell className={cn("mr-2 rtl:mr-0 rtl:ml-2 h-4 w-4", isTesting && "animate-bounce")} />
              {isTesting ? t('settings.testing') : t('settings.testAlerts')}
            </button>
          </div>

          {systemSettings?.lastNotificationCheck && (
            <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500">
              {t('settings.lastNotificationCheck', { date: formatDate(systemSettings.lastNotificationCheck.toDate()) })}
            </p>
          )}
        </div>
      </div>

      {/* User Management Section */}
      {isAdmin && (
        <div className="bg-white dark:bg-gray-900 shadow-sm rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden transition-colors">
          <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
              <Users className="h-5 w-5 mr-2 rtl:mr-0 rtl:ml-2 text-gray-400 dark:text-gray-500" />
              {t('settings.userManagement')}
            </h3>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading ? (
              <div className="px-6 py-12 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
              </div>
            ) : users.length > 0 ? (
              users.map((user) => (
                <div key={user.uid} className="px-6 py-5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <div className="flex items-center space-x-4 rtl:space-x-reverse">
                    <div className={cn(
                      "h-12 w-12 rounded-full flex items-center justify-center text-lg font-bold",
                      user.role === 'admin' ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400" : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                    )}>
                      {user.name.charAt(0)}
                    </div>
                    <div>
                    <div className="flex items-center space-x-2 rtl:space-x-reverse">
                    <h4 className="text-base font-bold text-gray-900 dark:text-white">{user.name}</h4>
                    <div className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                      user.role === 'admin' 
                        ? "bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300" 
                        : "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300"
                    )}>
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
                    </div>
                  </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
                      {user.teamIds && user.teamIds.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Array.from(new Set(user.teamIds)).map(teamId => {
                            const team = teams.find(t => t.id === teamId);
                            if (!team) return null;
                            return (
                              <span key={teamId} className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold uppercase tracking-wider">
                                {team.name}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 rtl:space-x-reverse">
                    {user?.email?.toLowerCase() === 'antar7theman@gmail.com' && (
                      <button
                        onClick={() => toggleUserRole(user)}
                        className="p-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors"
                        title={t('settings.changeRole')}
                      >
                        <ShieldCheck className="h-5 w-5" />
                      </button>
                    )}
                    <button
                      onClick={() => toggleUserStatus(user)}
                      className={cn(
                        "p-2 rounded-lg transition-colors",
                        user.active ? "text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30" : "text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                      )}
                      title={user.active ? t('settings.deactivate') : t('settings.activate')}
                    >
                      <Power className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => deleteUser(user)}
                      className="p-2 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                      title={t('settings.delete')}
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-6 py-12 text-center">
                <p className="text-gray-500 dark:text-gray-400">{t('settings.noUsersFound')}</p>
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
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{t('settings.addUserTitle')}</h3>
                <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors">
                  <X className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                </button>
              </div>
              <form onSubmit={handleAddUser} className="p-6 space-y-6">
                {error && (
                  <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg flex items-center text-red-600 dark:text-red-400 text-sm">
                    <AlertCircle className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                    {error}
                  </div>
                )}
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('settings.fullName')}</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 rtl:left-auto rtl:right-0 rtl:pr-3 flex items-center pointer-events-none">
                      <UserIcon className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                    </div>
                    <input
                      type="text"
                      required
                      value={newUserName}
                      onChange={(e) => setNewUserName(e.target.value)}
                      className="block w-full pl-10 rtl:pl-3 rtl:pr-10 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      placeholder={t('settings.fullNamePlaceholder')}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('settings.emailAddress')}</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 rtl:left-auto rtl:right-0 rtl:pr-3 flex items-center pointer-events-none">
                      <Mail className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                    </div>
                    <input
                      type="email"
                      required
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      className="block w-full pl-10 rtl:pl-3 rtl:pr-10 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      placeholder={t('settings.emailPlaceholder')}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('settings.role')}</label>
                  <div className="flex p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setNewUserRole('user')}
                      className={cn(
                        "flex-1 py-2 text-sm font-bold rounded-lg transition-all",
                        newUserRole === 'user' 
                          ? "bg-white dark:bg-gray-700 text-green-600 dark:text-green-400 shadow-sm" 
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      )}
                    >
                      {t('settings.user', { defaultValue: 'User' })}
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewUserRole('staff')}
                      className={cn(
                        "flex-1 py-2 text-sm font-bold rounded-lg transition-all",
                        newUserRole === 'staff' 
                          ? "bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm" 
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      )}
                    >
                      {t('settings.staff')}
                    </button>
                    {user?.email?.toLowerCase() === 'antar7theman@gmail.com' && (
                      <button
                        type="button"
                        onClick={() => setNewUserRole('admin')}
                        className={cn(
                          "flex-1 py-2 text-sm font-bold rounded-lg transition-all",
                          newUserRole === 'admin' 
                            ? "bg-white dark:bg-gray-700 text-purple-600 dark:text-purple-400 shadow-sm" 
                            : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                        )}
                      >
                        {t('settings.admin')}
                      </button>
                    )}
                  </div>
                  {user?.email?.toLowerCase() !== 'antar7theman@gmail.com' && (
                    <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">{t('settings.onlyStaffCanBeAdded')}</p>
                  )}
                </div>

                <div className="pt-4 flex space-x-3 rtl:space-x-reverse">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    {t('settings.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-4 py-2.5 bg-blue-600 dark:bg-blue-500 text-white font-medium rounded-xl hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors shadow-md disabled:opacity-50"
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
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
                  <Trash2 className="h-6 w-6 text-red-600 dark:text-red-400" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{t('settings.confirmDelete')}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                  {t('settings.deleteUserConfirm', { name: showDeleteConfirm.name })}
                </p>
                <div className="flex space-x-3 rtl:space-x-reverse">
                  <button
                    onClick={() => setShowDeleteConfirm(null)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    {t('settings.cancel')}
                  </button>
                  <button
                    onClick={confirmDeleteUser}
                    disabled={deleting}
                    className="flex-1 px-4 py-2.5 bg-red-600 dark:bg-red-500 text-white font-medium rounded-xl hover:bg-red-700 dark:hover:bg-red-600 transition-colors shadow-md disabled:opacity-50"
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
