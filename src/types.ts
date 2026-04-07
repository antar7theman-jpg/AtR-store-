import { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'staff' | 'user';
export type Priority = 'low' | 'medium' | 'high';
export type TaskStatus = 'pending' | 'in-progress' | 'completed';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  name: string;
  photoUrl?: string;
  active?: boolean;
  teamIds?: string[];
  phoneNumber?: string;
  notificationPreferences?: {
    expiry: { push: boolean; email: boolean; sms: boolean };
    lowStock: { push: boolean; email: boolean; sms: boolean };
    task: { push: boolean; email: boolean; sms: boolean };
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
  status: TaskStatus;
  completed: boolean;
  createdAt: Timestamp;
  dueDate?: Timestamp;
  createdBy: string;
  assignedTo?: string;
  assignedTeamId?: string;
  completionImage?: string;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  createdAt: Timestamp;
  memberUids: string[];
}

export interface ChatMessage {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  senderPhotoUrl?: string;
  createdAt: Timestamp;
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
  enableExpiryNotifications: boolean;
  enableLowStockNotifications?: boolean;
  enableTaskNotifications?: boolean;
  
  // Granular preferences
  expiryPush?: boolean;
  expiryEmail?: boolean;
  expirySms?: boolean;
  
  lowStockPush?: boolean;
  lowStockEmail?: boolean;
  lowStockSms?: boolean;
  
  taskPush?: boolean;
  taskEmail?: boolean;
  taskSms?: boolean;

  enablePushNotifications?: boolean;
  enableEmailNotifications?: boolean;
  enableSmsNotifications?: boolean;

  // Gmail settings
  gmailUser?: string;
  gmailPass?: string;
  
  // Twilio settings
  twilioSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;

  lastNotificationCheck?: Timestamp;
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
