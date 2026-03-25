import { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'staff';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  name: string;
  active?: boolean;
}

export interface Product {
  id: string;
  barcode: string;
  name: string;
  quantityPerBox?: number;
  currentStock: number;
  lastPurchasePrice?: number;
  expiryDate?: Timestamp;
  lowStockThreshold?: number;
  expiryAlertThreshold?: number;
}

export interface Purchase {
  id: string;
  productId: string;
  quantity: number;
  price: number;
  expiryDate: Timestamp;
  createdAt: Timestamp;
  recordedBy: string;
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
