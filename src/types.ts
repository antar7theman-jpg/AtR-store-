import { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'staff';
export type Priority = 'low' | 'medium' | 'high';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  name: string;
  active?: boolean;
  phone?: string;
  notificationPreferences?: {
    expiry: { sms: boolean; email: boolean; push: boolean };
    lowStock: { sms: boolean; email: boolean; push: boolean };
    task: { sms: boolean; email: boolean; push: boolean };
  };
}

export interface Product {
  id: string;
  barcode: string;
  barcodes: string[];
  name: string;
  quantityPerBox?: number;
  currentStock: number;
  lastPurchasePrice?: number;
  expiryDate?: Timestamp;
  lowStockThreshold?: number;
  expiryAlertThreshold?: number;
  category?: string;
  imageUrl?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  priority: Priority;
  completed: boolean;
  createdAt: Timestamp;
  dueDate?: Timestamp;
  createdBy: string;
  assignedTo?: string;
}

export interface Purchase {
  id: string;
  productId: string;
  quantity: number;
  price?: number;
  expiryDate?: Timestamp;
  createdAt: Timestamp;
  recordedBy: string;
  type: 'purchase' | 'adjustment';
  note?: string;
}

export interface SystemSettings {
  id: string;
  notificationPhone: string;
  phoneNumber: string;
  notificationEmail?: string;
  enableExpiryNotifications: boolean;
  enableLowStockNotifications?: boolean;
  enableTaskNotifications?: boolean;
  
  // Granular preferences
  expirySms?: boolean;
  expiryEmail?: boolean;
  expiryPush?: boolean;
  
  lowStockSms?: boolean;
  lowStockEmail?: boolean;
  lowStockPush?: boolean;
  
  taskSms?: boolean;
  taskEmail?: boolean;
  taskPush?: boolean;

  enableSmsNotifications?: boolean; // Legacy/Global
  enableNativeSmsNotifications?: boolean;
  enableEmailNotifications?: boolean; // Legacy/Global
  enablePushNotifications?: boolean; // Legacy/Global
  lastNotificationCheck?: Timestamp;
  gmailPass?: string;
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}
