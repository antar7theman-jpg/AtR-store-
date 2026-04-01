import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, deleteDoc, collection, addDoc, serverTimestamp, Timestamp, query, where, orderBy, getDocs, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { toast } from 'sonner';
import { Product, Purchase, UserProfile } from '../types';
import { sendLowStockAlert } from '../services/notificationService';
import { useAuth } from '../components/AuthGuard';
import { useTranslation } from 'react-i18next';
import { 
  ArrowLeft, Edit2, Trash2, History, Plus, 
  Package, Barcode, Calendar, DollarSign, 
  AlertTriangle, CheckCircle, X, ShoppingCart,
  ScanLine, Link as LinkIcon, Minus, ClipboardList,
  User as UserIcon, Clock, Search, Zap, TrendingUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import { differenceInDays, format } from 'date-fns';
import Scanner from '../components/Scanner';
import { 
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, 
  CartesianGrid, Tooltip, Legend, AreaChart, Area 
} from 'recharts';

const ProductDetail: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, isStaff, profile } = useAuth();
  const canManage = isAdmin || isStaff;
  
  // Helper to safely convert Firestore timestamp to Date
  const safeToDate = (timestamp: any) => {
    if (!timestamp || typeof timestamp.toDate !== 'function') return new Date();
    return timestamp.toDate();
  };

  const [product, setProduct] = useState<Product | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [users, setUsers] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [highlightHistory, setHighlightHistory] = useState(false);
  const [linking, setLinking] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview');
  const [barcodeSearch, setBarcodeSearch] = useState('');

  // Parse query params
  const queryParams = new URLSearchParams(location.search);
  const tabParam = queryParams.get('tab');

  useEffect(() => {
    if (tabParam === 'history') {
      setActiveTab('history');
      setHighlightHistory(true);
      setTimeout(() => {
        const historyEl = document.getElementById('purchase-history');
        if (historyEl) {
          historyEl.scrollIntoView({ behavior: 'smooth' });
        }
      }, 500);
      // Remove highlight after some time
      setTimeout(() => setHighlightHistory(false), 3000);
    }
  }, [tabParam]);

  // Purchase Form State
  const [purchaseQty, setPurchaseQty] = useState('');
  const [numBoxes, setNumBoxes] = useState('');
  const [unitsPerBox, setUnitsPerBox] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseExpiry, setPurchaseExpiry] = useState('');
  const [purchaseNote, setPurchaseNote] = useState('');
  
  // Adjustment Form State
  const [adjustmentQty, setAdjustmentQty] = useState('');
  const [adjustmentType, setAdjustmentType] = useState<'in' | 'out'>('in');
  const [adjustmentExpiry, setAdjustmentExpiry] = useState('');
  const [adjustmentNote, setAdjustmentNote] = useState('');
  
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;

    const productPath = `products/${id}`;
    const unsubscribeProduct = onSnapshot(doc(db, 'products', id), (doc) => {
      if (doc.exists()) {
        const data = doc.id ? { id: doc.id, ...doc.data() } as Product : null;
        setProduct(data);
        if (data && !unitsPerBox) {
          setUnitsPerBox(data.quantityPerBox?.toString() || '');
        }
      } else {
        navigate('/products');
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, productPath);
    });

    const purchasePath = 'purchases';
    const q = query(collection(db, purchasePath), where('productId', '==', id), orderBy('createdAt', 'desc'));
    const unsubscribePurchases = onSnapshot(q, async (snapshot) => {
      const purchaseList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Purchase));
      setPurchases(purchaseList);

      // Fetch user profiles for recordedBy
      const uids = Array.from(new Set(purchaseList.map(p => p.recordedBy)));
      const newUsers: Record<string, UserProfile> = { ...users };
      let updated = false;

      for (const uid of uids) {
        if (!newUsers[uid]) {
          try {
            const userDoc = await getDocs(query(collection(db, 'users'), where('uid', '==', uid)));
            if (!userDoc.empty) {
              newUsers[uid] = userDoc.docs[0].data() as UserProfile;
              updated = true;
            }
          } catch (err) {
            console.error("Error fetching user profile:", err);
          }
        }
      }

      if (updated) {
        setUsers(newUsers);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, purchasePath);
    });

    return () => {
      unsubscribeProduct();
      unsubscribePurchases();
    };
  }, [id, navigate]);

  const handleRecordPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product || !id || !profile) return;

    setSubmitting(true);
    try {
      const qty = parseInt(purchaseQty);
      const price = parseFloat(purchasePrice);
      const expiry = new Date(purchaseExpiry);
      const newStock = product.currentStock + qty;

      const batch = writeBatch(db);

      // 1. Add purchase record
      const purchaseRef = doc(collection(db, 'purchases'));
      batch.set(purchaseRef, {
        productId: id,
        quantity: qty,
        price: price,
        expiryDate: Timestamp.fromDate(expiry),
        createdAt: serverTimestamp(),
        recordedBy: profile.uid,
        type: 'purchase',
        note: purchaseNote
      });

      // 2. Add transaction record
      const transactionRef = doc(collection(db, 'transactions'));
      batch.set(transactionRef, {
        productId: id,
        productName: product.name,
        type: 'in',
        quantity: qty,
        previousStock: product.currentStock,
        newStock: newStock,
        timestamp: serverTimestamp(),
        note: `${t('productDetail.purchase')}: ${purchaseNote || t('productDetail.noNote')}`
      });

      // 3. Update product
      const productRef = doc(db, 'products', id);
      batch.update(productRef, {
        currentStock: newStock,
        lastPurchasePrice: price,
        expiryDate: Timestamp.fromDate(expiry)
      });

      await batch.commit();

      toast.success(t('productDetail.purchaseRecorded', { count: qty }));
      setShowPurchaseModal(false);
      setPurchaseQty('');
      setNumBoxes('');
      setPurchasePrice('');
      setPurchaseExpiry('');
      setPurchaseNote('');
    } catch (error) {
      console.error("Error recording purchase:", error);
      toast.error(t('productDetail.failedToRecordPurchase'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product || !id || !profile) return;
    if (!adjustmentNote.trim()) {
      toast.error(t('productDetail.provideReason'));
      return;
    }

    setSubmitting(true);
    try {
      const baseQty = parseInt(adjustmentQty);
      const qty = adjustmentType === 'in' ? baseQty : -baseQty;
      const newStock = product.currentStock + qty;

      if (newStock < 0) {
        toast.error(t('productDetail.negativeStockError'));
        setSubmitting(false);
        return;
      }

      let expiryTimestamp: Timestamp | null = null;
      if (adjustmentExpiry) {
        // Validate dd/mm/yyyy
        const dateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
        const match = adjustmentExpiry.match(dateRegex);
        if (!match) {
          toast.error(t('productDetail.invalidDateFormat'));
          setSubmitting(false);
          return;
        }

        const day = parseInt(match[1]);
        const month = parseInt(match[2]) - 1; // 0-indexed
        const year = parseInt(match[3]);
        const expiryDate = new Date(year, month, day);

        if (isNaN(expiryDate.getTime())) {
          toast.error(t('productDetail.invalidDateValue'));
          setSubmitting(false);
          return;
        }
        expiryTimestamp = Timestamp.fromDate(expiryDate);
      }

      const batch = writeBatch(db);
      
      // 1. Add adjustment record (Purchase collection)
      const adjustmentRef = doc(collection(db, 'purchases'));
      batch.set(adjustmentRef, {
        productId: id,
        quantity: qty,
        createdAt: serverTimestamp(),
        recordedBy: profile.uid,
        type: 'adjustment',
        note: adjustmentNote,
        expiryDate: expiryTimestamp
      });

      // 2. Add transaction record
      const transactionRef = doc(collection(db, 'transactions'));
      batch.set(transactionRef, {
        productId: id,
        productName: product.name,
        type: qty > 0 ? 'in' : 'out',
        quantity: Math.abs(qty),
        previousStock: product.currentStock,
        newStock: newStock,
        timestamp: serverTimestamp(),
        note: `${t('productDetail.manualAdjustment')}: ${adjustmentNote}`,
        expiryDate: expiryTimestamp
      });

      // 3. Update product
      const productRef = doc(db, 'products', id);
      const updateData: any = {
        currentStock: newStock
      };
      if (expiryTimestamp && adjustmentType === 'in') {
        updateData.expiryDate = expiryTimestamp;
      }
      batch.update(productRef, updateData);

      await batch.commit();

      // Check for low stock alert (outside batch as it's a side effect)
      if (qty < 0 && newStock <= (product.lowStockThreshold || 0)) {
        sendLowStockAlert({ ...product, currentStock: newStock });
      }

      toast.success(t('productDetail.stockAdjusted', { count: qty }));
      setShowAdjustmentModal(false);
      setAdjustmentQty('');
      setAdjustmentNote('');
      setAdjustmentExpiry('');
    } catch (error) {
      console.error("Error adjusting stock:", error);
      toast.error(t('productDetail.failedToAdjustStock'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!product || !id) return;
    
    setDeleting(true);
    try {
      const batch = writeBatch(db);
      
      // Delete the product
      batch.delete(doc(db, 'products', id));
      
      // Find and delete purchases
      const purchasesQuery = query(collection(db, 'purchases'), where('productId', '==', id));
      const purchasesSnapshot = await getDocs(purchasesQuery);
      purchasesSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      // Find and delete transactions
      const transactionsQuery = query(collection(db, 'transactions'), where('productId', '==', id));
      const transactionsSnapshot = await getDocs(transactionsQuery);
      transactionsSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      toast.success(t('products.deletedSuccessfully'));
      navigate('/products');
    } catch (error) {
      console.error("Error deleting product and history:", error);
      handleFirestoreError(error, OperationType.DELETE, `products/${id}`);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleScan = async (barcode: string) => {
    if (!barcode) return;
    setShowScanner(false);

    try {
      const q = query(collection(db, 'products'), where('barcodes', 'array-contains', barcode));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const foundProduct = querySnapshot.docs[0];
        if (foundProduct.id === id) {
          // Already on this product
          return;
        }
        // Navigate to the other product
        navigate(`/products/${foundProduct.id}`);
      } else {
        // Not found, offer to link
        setScannedBarcode(barcode);
        setShowLinkModal(true);
      }
    } catch (error) {
      console.error("Error searching product by barcode:", error);
    }
  };

  const handleLinkBarcode = async () => {
    if (!product || !id || !scannedBarcode) return;

    setLinking(true);
    try {
      const currentBarcodes = product.barcodes || [product.barcode];
      if (!currentBarcodes.includes(scannedBarcode)) {
        const newBarcodes = [...currentBarcodes, scannedBarcode];
        await updateDoc(doc(db, 'products', id), {
          barcodes: newBarcodes,
          barcode: newBarcodes[0]
        });
      }
      setShowLinkModal(false);
      setScannedBarcode(null);
      toast.success(t('productDetail.barcodeLinked'));
      setShowLinkModal(false);
      setScannedBarcode(null);
      toast.success(t('productDetail.barcodeLinkedSuccessfully'));
    } finally {
      setLinking(false);
    }
  };

  const handleAddManualBarcode = async () => {
    if (!product || !id || !barcodeSearch.trim()) return;
    const newBarcode = barcodeSearch.trim();
    
    // Basic validation
    const allBarcodes = Array.from(new Set([product.barcode, ...(product.barcodes || [])])).filter(Boolean);
    if (allBarcodes.includes(newBarcode)) {
      toast.error(t('productDetail.barcodeAlreadyExists'));
      return;
    }

    setLinking(true);
    try {
      const newBarcodes = Array.from(new Set([...(product.barcodes || []), newBarcode])).filter(Boolean);
      await updateDoc(doc(db, 'products', id), {
        barcodes: newBarcodes
      });
      toast.success(t('productDetail.barcodeAdded', { barcode: newBarcode }));
      setBarcodeSearch('');
    } catch (error) {
      console.error("Error adding barcode:", error);
      toast.error(t('productDetail.failedToAddBarcode'));
    } finally {
      setLinking(false);
    }
  };

  const handleRemoveBarcode = async (barcodeToRemove: string) => {
    if (!product || !id || !canManage) return;
    
    const allBarcodes = Array.from(new Set([product.barcode, ...(product.barcodes || [])])).filter(Boolean);
    if (allBarcodes.length <= 1) {
      toast.error(t('productDetail.cannotRemoveOnlyBarcode'));
      return;
    }

    try {
      const newBarcodes = (product.barcodes || []).filter(bc => bc !== barcodeToRemove);
      const updateData: any = { barcodes: newBarcodes };
      
      if (barcodeToRemove === product.barcode) {
        updateData.barcode = newBarcodes.find(bc => bc !== barcodeToRemove) || '';
      }
      
      await updateDoc(doc(db, 'products', id), updateData);
      toast.success(t('productDetail.barcodeRemoved'));
    } catch (error) {
      console.error("Error removing barcode:", error);
      toast.error(t('productDetail.failedToRemoveBarcode'));
    }
  };

  const handleSetPrimaryBarcode = async (barcode: string) => {
    if (!product || !id || !canManage) return;
    if (barcode === product.barcode) return;

    try {
      await updateDoc(doc(db, 'products', id), {
        barcode: barcode
      });
      toast.success(t('productDetail.primaryBarcodeUpdated'));
    } catch (error) {
      console.error("Error setting primary barcode:", error);
      toast.error(t('productDetail.failedToUpdatePrimaryBarcode'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!product) return null;

  // Calculate stock trend for chart
  const validPurchases = purchases.filter(p => p.createdAt && typeof p.createdAt.toDate === 'function');
  
  const sortedPurchases = [...validPurchases].sort((a, b) => 
    safeToDate(a.createdAt).getTime() - safeToDate(b.createdAt).getTime()
  );

  let tempStock = product.currentStock;
  // Work backwards to find historical stock levels
  const historicalStock = [...validPurchases]
    .sort((a, b) => safeToDate(b.createdAt).getTime() - safeToDate(a.createdAt).getTime())
    .map(p => {
      const stockAtPoint = tempStock;
      tempStock -= p.quantity;
      return {
        date: format(safeToDate(p.createdAt), 'MMM dd'),
        fullDate: formatDate(safeToDate(p.createdAt)),
        stock: stockAtPoint,
        change: p.quantity,
        type: p.type as string
      };
    })
    .reverse();

  // Add initial point if we have history
  if (historicalStock.length > 0 && validPurchases.length > 0) {
    const firstPoint = historicalStock[0];
    const lastPurchase = validPurchases[validPurchases.length - 1];
    const initialDate = new Date(safeToDate(lastPurchase.createdAt));
    initialDate.setDate(initialDate.getDate() - 1);
    
    historicalStock.unshift({
      date: format(initialDate, 'MMM dd'),
      fullDate: formatDate(initialDate),
      stock: tempStock,
      change: 0,
      type: 'initial' as string
    });
  }

  const isLowStock = product.currentStock <= (product.lowStockThreshold || 0);
  let daysRemaining = null;
  let isExpiring = false;
  if (product.expiryDate) {
    daysRemaining = differenceInDays(safeToDate(product.expiryDate), new Date());
    isExpiring = daysRemaining <= (product.expiryAlertThreshold || 0);
  }

  return (
    <div className="space-y-8 pb-20" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex flex-col space-y-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className={cn("flex items-start flex-grow", isRTL ? "space-x-reverse space-x-4" : "space-x-4")}>
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full transition-colors mt-1">
              <ArrowLeft className={cn("h-6 w-6 text-gray-600", isRTL && "rotate-180")} />
            </button>
            
            {product.imageUrl && (
              <div className="hidden sm:block w-24 h-24 rounded-2xl overflow-hidden border border-gray-100 shadow-sm flex-shrink-0">
                <img 
                  src={product.imageUrl} 
                  alt={product.name} 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
            )}

            <div className="flex-grow">
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight break-words">{product.name}</h1>
              <div className="flex flex-wrap gap-2 mt-2 items-center">
                {product.category && (
                  <span className="text-[10px] md:text-xs font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full border border-blue-100">
                    {product.category}
                  </span>
                )}
                {product.category && <span className="text-gray-300">•</span>}
                {(product.barcodes || [product.barcode]).slice(0, 2).map((bc, i) => (
                  <span key={i} className="text-[10px] md:text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded flex items-center">
                    <Barcode className="h-3 w-3 mr-1" />
                    {bc}
                  </span>
                ))}
                {(product.barcodes?.length || 0) > 1 && (
                  <span className="text-[10px] text-gray-400 italic">+{product.barcodes!.length - 1} {t('common.more')}</span>
                )}
              </div>
            </div>
          </div>

          {product.imageUrl && (
            <div className="sm:hidden w-full h-48 rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
              <img 
                src={product.imageUrl} 
                alt={product.name} 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
          )}
        </div>

        {/* Action Buttons Grid */}
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-3">
          <button
            onClick={() => setShowPurchaseModal(true)}
            className="col-span-2 sm:flex-1 inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-md font-bold text-sm"
          >
            <Plus className={cn("h-5 w-5", isRTL ? "ml-2" : "mr-2")} />
            {t('productDetail.recordPurchase')}
          </button>
          
          <div className={cn("flex col-span-2 sm:contents", isRTL ? "space-x-reverse space-x-2" : "space-x-2")}>
            {canManage && (
              <button
                onClick={() => setShowAdjustmentModal(true)}
                className="flex-1 sm:flex-none p-3 bg-white border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors shadow-sm flex items-center justify-center"
                title={t('productDetail.manualAdjustment')}
              >
                <ClipboardList className="h-5 w-5" />
                <span className={cn("sm:hidden text-xs font-bold", isRTL ? "mr-2" : "ml-2")}>{t('productDetail.adjust')}</span>
              </button>
            )}
            {canManage && (
              <button
                onClick={() => setShowScanner(true)}
                className="flex-1 sm:flex-none p-3 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors shadow-sm flex items-center justify-center"
                title={t('productDetail.scanBarcode')}
              >
                <ScanLine className="h-5 w-5" />
                <span className={cn("sm:hidden text-xs font-bold", isRTL ? "mr-2" : "ml-2")}>{t('nav.scan')}</span>
              </button>
            )}
          </div>

          {canManage && (
            <div className={cn("flex col-span-2 sm:contents", isRTL ? "space-x-reverse space-x-2" : "space-x-2")}>
              <Link
                to={`/products/edit/${product.id}`}
                className="flex-1 sm:flex-none inline-flex items-center justify-center px-4 py-3 bg-white border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors shadow-sm font-bold text-sm"
              >
                <Edit2 className={cn("h-5 w-5", isRTL ? "ml-2" : "mr-2")} />
                {t('common.edit')}
              </Link>
              <button
                onClick={handleDelete}
                className="flex-1 sm:flex-none inline-flex items-center justify-center px-4 py-3 bg-white border border-gray-200 text-red-600 rounded-xl hover:bg-red-50 transition-colors shadow-sm font-bold text-sm"
              >
                <Trash2 className={cn("h-5 w-5", isRTL ? "ml-2" : "mr-2")} />
                {t('common.delete')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-gray-100 p-1 rounded-2xl w-full sm:w-fit">
        <button
          onClick={() => setActiveTab('overview')}
          className={cn(
            "flex-1 sm:flex-none px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all",
            activeTab === 'overview' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
          )}
        >
          {t('productDetail.overview')}
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={cn(
            "flex-1 sm:flex-none px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all",
            activeTab === 'history' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
          )}
        >
          {t('productDetail.historyTrends')}
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'overview' ? (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-8"
          >
            {/* Main Info Card */}
            <div className="lg:col-span-2 space-y-8">
              {/* Last Purchase Summary */}
              {purchases.length > 0 && purchases.find(p => p.type === 'purchase') && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-blue-600 rounded-2xl p-6 text-white shadow-lg shadow-blue-500/20 flex items-center justify-between"
                >
                  <div className="flex items-center space-x-4">
                    <div className="bg-white/20 p-3 rounded-xl backdrop-blur-sm">
                      <ShoppingCart className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-blue-100 text-xs font-bold uppercase tracking-wider">{t('productDetail.lastPurchase')}</p>
                      <p className="text-xl font-bold">
                        {formatCurrency(purchases.find(p => p.type === 'purchase')?.price || 0)} 
                        <span className="text-blue-200 text-sm font-normal mx-2">
                          {t('productDetail.on')} {formatDate(safeToDate(purchases.find(p => p.type === 'purchase')?.createdAt))}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className={cn("hidden sm:block", isRTL ? "text-left" : "text-right")}>
                    <p className="text-blue-100 text-xs font-bold uppercase tracking-wider">{t('productDetail.quantity')}</p>
                    <p className="text-xl font-bold">+{purchases.find(p => p.type === 'purchase')?.quantity} {t('products.units')}</p>
                  </div>
                </motion.div>
              )}

              <div className="bg-white shadow-sm rounded-2xl border border-gray-100 p-6 sm:p-8 grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                <div className={cn("space-y-1 pb-6 sm:pb-0 border-b sm:border-b-0 border-gray-100", isRTL ? "sm:border-l sm:pl-8" : "sm:border-r sm:pr-8")}>
                  <p className="text-[10px] sm:text-sm font-bold text-gray-400 uppercase tracking-widest">{t('productDetail.currentStock')}</p>
                  <div className="flex items-baseline space-x-2 rtl:space-x-reverse">
                    <span className={cn("text-4xl font-black", isLowStock ? "text-amber-600" : "text-gray-900")}>
                      {product.currentStock}
                    </span>
                    <span className="text-gray-400 text-sm font-medium uppercase">{t('products.units')}</span>
                  </div>
                  {isLowStock && (
                    <div className="flex items-center text-amber-600 text-[10px] font-bold mt-2 uppercase tracking-wider">
                      <AlertTriangle className={cn("h-3 w-3", isRTL ? "ml-1" : "mr-1")} />
                      {t('products.lowStock')}
                    </div>
                  )}
                </div>

                <div className="space-y-1 pt-6 sm:pt-0">
                  <p className="text-[10px] sm:text-sm font-bold text-gray-400 uppercase tracking-widest">{t('productDetail.latestExpiry')}</p>
                  <div className="flex items-baseline space-x-2 rtl:space-x-reverse">
                    <span className={cn("text-2xl sm:text-3xl font-black", isExpiring ? "text-red-600" : "text-gray-900")}>
                      {product.expiryDate ? formatDate(safeToDate(product.expiryDate)) : t('productDetail.na')}
                    </span>
                  </div>
                  {isExpiring && (
                    <div className="flex items-center text-red-600 text-[10px] font-bold mt-2 uppercase tracking-wider">
                      <Calendar className={cn("h-3 w-3", isRTL ? "ml-1" : "mr-1")} />
                      {t('productDetail.expiringIn', { count: daysRemaining })}
                    </div>
                  )}
                </div>

                <div className={cn("space-y-1 pt-6 border-t border-gray-100", isRTL ? "sm:border-l sm:pl-8" : "sm:border-r sm:pr-8")}>
                  <p className="text-[10px] sm:text-sm font-bold text-gray-400 uppercase tracking-widest">{t('productDetail.lastPurchasePrice')}</p>
                  <div className="flex items-baseline space-x-2 rtl:space-x-reverse">
                    <span className="text-2xl sm:text-3xl font-black text-gray-900">
                      {product.lastPurchasePrice ? formatCurrency(product.lastPurchasePrice) : t('productDetail.na')}
                    </span>
                    <span className="text-gray-400 text-xs font-medium uppercase">{t('productDetail.perUnit')}</span>
                  </div>
                </div>

                <div className="space-y-1 pt-6 border-t border-gray-100">
                  <p className="text-[10px] sm:text-sm font-bold text-gray-400 uppercase tracking-widest">{t('productDetail.quantityPerBox')}</p>
                  <div className="flex items-baseline space-x-2 rtl:space-x-reverse">
                    <span className="text-2xl sm:text-3xl font-black text-gray-900">
                      {product.quantityPerBox || t('productDetail.na')}
                    </span>
                    <span className="text-gray-400 text-xs font-medium uppercase">{t('products.units')}</span>
                  </div>
                </div>
              </div>

              {/* Stock Trend Mini Chart */}
              {historicalStock.length > 1 && (
                <div className="bg-white shadow-sm rounded-2xl border border-gray-100 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest flex items-center">
                      <TrendingUp className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
                      {t('productDetail.stockTrend')}
                    </h3>
                  </div>
                  <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={historicalStock}>
                        <defs>
                          <linearGradient id="colorStock" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                        <XAxis 
                          dataKey="date" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 10, fill: '#9ca3af' }}
                          dy={10}
                        />
                        <YAxis 
                          hide 
                          domain={['dataMin - 5', 'dataMax + 5']} 
                        />
                        <Tooltip 
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              return (
                                <div className="bg-white p-3 border border-gray-100 shadow-xl rounded-xl">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">{payload[0].payload.fullDate}</p>
                                  <p className="text-sm font-bold text-blue-600">{t('productDetail.units', { count: payload[0].value })}</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="stock" 
                          stroke="#3b82f6" 
                          strokeWidth={3}
                          fillOpacity={1} 
                          fill="url(#colorStock)" 
                          animationDuration={1500}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Thresholds Card */}
              <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">{t('productDetail.alertThresholds')}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="flex items-center space-x-4">
                    <div className="bg-amber-100 p-2 rounded-lg">
                      <AlertTriangle className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">{t('productDetail.lowStockThreshold')}</p>
                      <p className="text-sm font-bold text-gray-900">{t('productDetail.units', { count: product.lowStockThreshold || 0 })}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="bg-red-100 p-2 rounded-lg">
                      <Calendar className="h-5 w-5 text-red-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">{t('productDetail.expiryAlertThreshold')}</p>
                      <p className="text-sm font-bold text-gray-900">{t('productDetail.daysBefore', { count: product.expiryAlertThreshold || 0 })}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sidebar: Recent Activity */}
            <div className="space-y-6">
              <div className="bg-white shadow-sm rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center">
                  <h3 className="text-lg font-bold text-gray-900 flex items-center">
                    <History className="h-5 w-5 mr-2 text-gray-400" />
                    {t('productDetail.recentActivity')}
                  </h3>
                  <button 
                    onClick={() => setActiveTab('history')}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 uppercase tracking-wider"
                  >
                    {t('productDetail.viewAll')}
                  </button>
                </div>
                <div className="divide-y divide-gray-100">
                  {purchases.slice(0, 5).map((purchase) => (
                    <div key={purchase.id} className="px-6 py-4">
                      <div className="flex justify-between items-start">
                        <div className="flex items-start space-x-3">
                          <div className={cn(
                            "p-2 rounded-lg mt-0.5",
                            purchase.type === 'adjustment' ? "bg-gray-100 text-gray-600" : "bg-blue-50 text-blue-600"
                          )}>
                            {purchase.type === 'adjustment' ? <ClipboardList className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-gray-900">
                              {purchase.quantity > 0 ? '+' : ''}{t('productDetail.units', { count: purchase.quantity })}
                            </p>
                            <div className="flex items-center text-[10px] text-gray-400 space-x-2">
                              <span>{formatDate(safeToDate(purchase.createdAt))}</span>
                              <span>•</span>
                              <span>{users[purchase.recordedBy]?.name || t('common.unknown')}</span>
                            </div>
                            {purchase.note && (
                              <p className="text-[10px] text-gray-500 italic mt-1 line-clamp-1">
                                {purchase.note}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Product Barcodes Card */}
              <div className="bg-white shadow-sm rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-6 py-5 border-b border-gray-100">
                  <h3 className="text-lg font-bold text-gray-900 flex items-center">
                    <Barcode className="h-5 w-5 mr-2 text-gray-400" />
                    {t('productDetail.productBarcodes')}
                  </h3>
                </div>
                <div className="p-6 space-y-4">
                  <div className="flex space-x-2">
                    <div className="relative flex-grow">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search className="h-4 w-4 text-gray-400" />
                      </div>
                      <input
                        type="text"
                        placeholder={t('productDetail.barcodeSearchPlaceholder')}
                        value={barcodeSearch}
                        onChange={(e) => setBarcodeSearch(e.target.value)}
                        className="block w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    {canManage && barcodeSearch.trim() && (
                      <button
                        onClick={handleAddManualBarcode}
                        disabled={linking}
                        className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
                        title={t('productDetail.addBarcode')}
                      >
                        <Plus className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(() => {
                      const allBarcodes = Array.from(new Set([product.barcode, ...(product.barcodes || [])])).filter(Boolean);
                      const filtered = allBarcodes.filter(bc => bc.toLowerCase().includes(barcodeSearch.toLowerCase()));
                      
                      if (filtered.length === 0) {
                        return <p className="text-xs text-gray-400 italic">{t('productDetail.noBarcodesFound')}</p>;
                      }

                      return filtered.map((bc, i) => (
                        <div key={i} className="group relative">
                          <span className={cn(
                            "text-xs font-mono px-2 py-1 rounded-lg border flex items-center transition-all",
                            bc === product.barcode 
                              ? "bg-blue-50 text-blue-700 border-blue-200" 
                              : "bg-gray-50 text-gray-600 border-gray-100"
                          )}>
                            <Barcode className="h-3 w-3 mr-1 opacity-50" />
                            {bc}
                            {bc === product.barcode && (
                              <span className="ml-1.5 text-[8px] uppercase bg-blue-100 text-blue-600 px-1 rounded">{t('productDetail.primary')}</span>
                            )}
                          </span>
                          
                          {canManage && (
                            <div className="absolute -top-2 -right-2 hidden group-hover:flex space-x-1">
                              {bc !== product.barcode && (
                                <button
                                  onClick={() => handleSetPrimaryBarcode(bc)}
                                  className="p-1 bg-white border border-gray-200 rounded-full text-blue-600 shadow-sm hover:bg-blue-50"
                                  title={t('productDetail.setPrimary')}
                                >
                                  <CheckCircle className="h-3 w-3" />
                                </button>
                              )}
                              <button
                                onClick={() => handleRemoveBarcode(bc)}
                                className="p-1 bg-white border border-gray-200 rounded-full text-red-600 shadow-sm hover:bg-red-50"
                                title={t('productDetail.removeBarcode')}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
            id="purchase-history"
          >
            <div className={cn(
              "bg-white shadow-sm rounded-2xl border transition-all overflow-hidden",
              highlightHistory ? "border-blue-400 ring-2 ring-blue-100" : "border-gray-100"
            )}>
              <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center">
                <h3 className="text-lg font-bold text-gray-900 flex items-center">
                  <TrendingUp className="h-5 w-5 mr-2 text-blue-500" />
                  {t('productDetail.stockLevelHistory')}
                </h3>
              </div>
              
              {historicalStock.length > 1 && (
                <div className="p-6 border-b border-gray-100">
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={historicalStock}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                        <XAxis 
                          dataKey="date" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 12, fill: '#6b7280' }}
                          dy={10}
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 12, fill: '#6b7280' }}
                          dx={-10}
                        />
                        <Tooltip 
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-white p-4 border border-gray-100 shadow-2xl rounded-2xl">
                                  <p className="text-xs font-bold text-gray-400 uppercase mb-2">{data.fullDate}</p>
                                  <div className="space-y-1">
                                    <p className="text-sm font-bold text-gray-900">{t('productDetail.stockUnits', { count: data.stock })}</p>
                                    {data.change !== 0 && (
                                      <p className={cn(
                                        "text-xs font-medium",
                                        data.change > 0 ? "text-green-600" : "text-red-600"
                                      )}>
                                        {data.change > 0 ? '+' : ''}{t('productDetail.units', { count: data.change })} ({t(`productDetail.${data.type}`)})
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Line 
                          type="stepAfter" 
                          dataKey="stock" 
                          stroke="#3b82f6" 
                          strokeWidth={4}
                          dot={{ r: 4, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }}
                          activeDot={{ r: 6, strokeWidth: 0 }}
                          animationDuration={1500}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">{t('productDetail.dateTime')}</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">{t('productDetail.type')}</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">{t('productDetail.quantity')}</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">{t('productDetail.price')}</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">{t('productDetail.expiry')}</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">{t('productDetail.user')}</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">{t('productDetail.notes')}</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {purchases.length > 0 ? (
                      purchases.map((purchase) => (
                        <tr key={purchase.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center text-sm text-gray-900">
                              <Clock className="h-4 w-4 mr-2 text-gray-400" />
                              {formatDate(safeToDate(purchase.createdAt))}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={cn(
                              "inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                              purchase.type === 'adjustment' ? "bg-gray-100 text-gray-600" : "bg-blue-100 text-blue-600"
                            )}>
                              {t(`productDetail.${purchase.type}`)}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={cn(
                              "text-sm font-bold",
                              purchase.quantity > 0 ? "text-green-600" : "text-red-600"
                            )}>
                              {purchase.quantity > 0 ? '+' : ''}{t('productDetail.units', { count: purchase.quantity })}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-900">
                              {purchase.type === 'purchase' ? formatCurrency(purchase.price || 0) : '-'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-900">
                              {purchase.type === 'purchase' && purchase.expiryDate ? formatDate(safeToDate(purchase.expiryDate)) : '-'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center text-sm text-gray-900">
                              <UserIcon className="h-4 w-4 mr-2 text-gray-400" />
                              {users[purchase.recordedBy]?.name || t('common.unknownUser')}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-xs text-gray-500 italic">
                              {purchase.note || (purchase.type === 'adjustment' ? t('productDetail.noReasonProvided') : '')}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-6 py-20 text-center">
                          <History className="h-12 w-12 text-gray-200 mx-auto mb-4" />
                          <p className="text-gray-400 italic">{t('productDetail.noHistory')}</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View for History */}
              <div className="sm:hidden divide-y divide-gray-100">
                {purchases.length > 0 ? (
                  purchases.map((purchase) => (
                    <div key={purchase.id} className="p-4 space-y-3">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center text-xs text-gray-500">
                          <Clock className="h-3 w-3 mr-1" />
                          {formatDate(safeToDate(purchase.createdAt))}
                        </div>
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider",
                          purchase.type === 'adjustment' ? "bg-gray-100 text-gray-600" : "bg-blue-100 text-blue-600"
                        )}>
                          {t(`productDetail.${purchase.type}`)}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-end">
                        <div>
                          <p className={cn(
                            "text-lg font-bold",
                            purchase.quantity > 0 ? "text-green-600" : "text-red-600"
                          )}>
                            {purchase.quantity > 0 ? '+' : ''}{t('productDetail.units', { count: purchase.quantity })}
                          </p>
                          {purchase.type === 'purchase' && (
                            <p className="text-xs text-gray-600">
                              {formatCurrency(purchase.price || 0)} {t('productDetail.perUnit')}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="flex items-center text-xs text-gray-600 justify-end">
                            <UserIcon className="h-3 w-3 mr-1" />
                            {users[purchase.recordedBy]?.name || t('common.unknown')}
                          </div>
                          {purchase.type === 'purchase' && purchase.expiryDate && (
                            <p className="text-[10px] text-gray-400 mt-1">
                              {t('productDetail.exp')}: {formatDate(safeToDate(purchase.expiryDate))}
                            </p>
                          )}
                        </div>
                      </div>
                      
                      {purchase.note && (
                        <p className="text-xs text-gray-500 italic bg-gray-50 p-2 rounded-lg">
                          {purchase.note}
                        </p>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="px-6 py-20 text-center">
                    <History className="h-12 w-12 text-gray-200 mx-auto mb-4" />
                    <p className="text-gray-400 italic">{t('productDetail.noHistory')}</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Purchase Modal */}
      <AnimatePresence mode="wait">
        {showPurchaseModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h3 className="text-lg font-bold text-gray-900">{t('productDetail.recordNewPurchase')}</h3>
                <button onClick={() => setShowPurchaseModal(false)} className="p-1 hover:bg-gray-200 rounded-full transition-colors">
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>
              <form onSubmit={handleRecordPurchase} className="p-6 space-y-6">
                <div className="bg-blue-50 p-4 rounded-xl space-y-4">
                  <p className="text-xs font-bold text-blue-600 uppercase tracking-wider">{t('productDetail.unitCalculator')}</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-blue-500 mb-1 uppercase">{t('productDetail.numberOfBoxes')}</label>
                      <input
                        type="number"
                        placeholder="0"
                        value={numBoxes}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNumBoxes(val);
                          const boxes = parseInt(val) || 0;
                          const perBox = parseInt(unitsPerBox) || 0;
                          if (boxes > 0 && perBox > 0) {
                            setPurchaseQty((boxes * perBox).toString());
                          }
                        }}
                        className="block w-full px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-blue-500 mb-1 uppercase">{t('productDetail.unitsPerBox')}</label>
                      <input
                        type="number"
                        placeholder="0"
                        value={unitsPerBox}
                        onChange={(e) => {
                          const val = e.target.value;
                          setUnitsPerBox(val);
                          const boxes = parseInt(numBoxes) || 0;
                          const perBox = parseInt(val) || 0;
                          if (boxes > 0 && perBox > 0) {
                            setPurchaseQty((boxes * perBox).toString());
                          }
                        }}
                        className="block w-full px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                  {parseInt(numBoxes) > 0 && parseInt(unitsPerBox) > 0 && (
                    <div className="text-center pt-2 border-t border-blue-100">
                      <p className="text-sm font-bold text-blue-700">
                        {t('productDetail.total')}: {numBoxes} × {unitsPerBox} = {parseInt(numBoxes) * parseInt(unitsPerBox)} {t('productDetail.unitsLabel')}
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('productDetail.purchaseQuantity')}</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Package className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="number"
                      required
                      min="1"
                      value={purchaseQty}
                      onChange={(e) => setPurchaseQty(e.target.value)}
                      className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g. 50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('productDetail.purchasePrice')}</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <DollarSign className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      required
                      min="0"
                      value={purchasePrice}
                      onChange={(e) => setPurchasePrice(e.target.value)}
                      className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('productDetail.batchExpiryDate')}</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Calendar className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="date"
                      required
                      value={purchaseExpiry}
                      onChange={(e) => setPurchaseExpiry(e.target.value)}
                      className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('productDetail.notes')} ({t('common.optional')})</label>
                  <textarea
                    value={purchaseNote}
                    onChange={(e) => setPurchaseNote(e.target.value)}
                    className="block w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder={t('productDetail.optionalNotes')}
                    rows={2}
                  />
                </div>

                <div className="pt-4 flex space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowPurchaseModal(false)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-4 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-md disabled:opacity-50"
                  >
                    {submitting ? t('common.saving') : t('productDetail.saveRecord')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Adjustment Modal */}
      <AnimatePresence mode="wait">
        {showAdjustmentModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h3 className="text-lg font-bold text-gray-900">{t('productDetail.manualStockAdjustment')}</h3>
                <button onClick={() => setShowAdjustmentModal(false)} className="p-1 hover:bg-gray-200 rounded-full transition-colors">
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>
              <form onSubmit={handleManualAdjustment} className="p-6 space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('productDetail.adjustmentType')}</label>
                  <div className="flex items-center bg-gray-100 rounded-xl p-1 mb-4">
                    <button
                      type="button"
                      onClick={() => setAdjustmentType('in')}
                      className={cn(
                        "flex-1 py-2 text-sm font-bold rounded-lg transition-all",
                        adjustmentType === 'in' ? "bg-white text-green-600 shadow-sm" : "text-gray-500"
                      )}
                    >
                      <Plus className="h-4 w-4 inline mr-1" />
                      {t('productDetail.addStock')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdjustmentType('out')}
                      className={cn(
                        "flex-1 py-2 text-sm font-bold rounded-lg transition-all",
                        adjustmentType === 'out' ? "bg-white text-red-600 shadow-sm" : "text-gray-500"
                      )}
                    >
                      <Minus className="h-4 w-4 inline mr-1" />
                      {t('productDetail.removeStock')}
                    </button>
                  </div>

                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('productDetail.quantity')}</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      {adjustmentType === 'in' ? <Plus className="h-5 w-5 text-green-500" /> : <Minus className="h-5 w-5 text-red-500" />}
                    </div>
                    <input
                      type="number"
                      required
                      min="1"
                      value={adjustmentQty}
                      onChange={(e) => setAdjustmentQty(e.target.value)}
                      className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder={t('productDetail.enterQuantity')}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('productDetail.reasonForAdjustment')}</label>
                  <textarea
                    required
                    value={adjustmentNote}
                    onChange={(e) => setAdjustmentNote(e.target.value)}
                    className="block w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder={t('productDetail.reasonPlaceholder')}
                    rows={3}
                  />
                </div>

                {adjustmentType === 'in' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('productDetail.expiryDate')} ({t('common.optional')})</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Calendar className="h-5 w-5 text-gray-400" />
                      </div>
                      <input
                        type="text"
                        placeholder="dd/mm/yyyy"
                        value={adjustmentExpiry}
                        onChange={(e) => setAdjustmentExpiry(e.target.value)}
                        className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 italic">{t('productDetail.dateFormatHint')}</p>
                  </div>
                )}

                <div className="pt-4 flex space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowAdjustmentModal(false)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-4 py-2.5 bg-gray-900 text-white font-medium rounded-xl hover:bg-gray-800 transition-colors shadow-md disabled:opacity-50"
                  >
                    {submitting ? t('common.saving') : t('productDetail.saveAdjustment')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Scanner Overlay */}
      <AnimatePresence mode="wait">
        {showScanner && (
          <Scanner 
            onScan={handleScan} 
            onClose={() => setShowScanner(false)} 
          />
        )}
      </AnimatePresence>

      {/* Link Barcode Modal */}
      <AnimatePresence>
        {showLinkModal && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-8 text-center space-y-6">
                <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                  <LinkIcon className="h-8 w-8 text-blue-600" />
                </div>
                
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{t('productDetail.linkNewBarcodeTitle')}</h3>
                  <p className="text-gray-500 mt-2">
                    {t('productDetail.barcodeNotFound', { barcode: scannedBarcode })}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    {t('productDetail.linkToProduct', { name: product.name })}
                  </p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={handleLinkBarcode}
                    disabled={linking}
                    className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-md disabled:opacity-50"
                  >
                    {linking ? t('common.linking') : t('productDetail.linkToCurrentProduct')}
                  </button>
                  <button
                    onClick={() => {
                      setShowLinkModal(false);
                      setScannedBarcode(null);
                    }}
                    disabled={linking}
                    className="w-full py-4 bg-white border-2 border-gray-200 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all disabled:opacity-50"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-8 text-center">
                <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="h-8 w-8 text-red-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">{t('products.confirmDelete')}</h3>
                <p className="text-gray-500 text-sm mb-6">
                  {t('products.deleteConfirm')}
                </p>
                <div className="space-y-3">
                  <button
                    onClick={confirmDelete}
                    disabled={deleting}
                    className="w-full py-4 bg-red-600 text-white font-bold rounded-2xl hover:bg-red-700 transition-all shadow-md disabled:opacity-50"
                  >
                    {deleting ? t('common.loading') : t('common.delete')}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={deleting}
                    className="w-full py-4 bg-white border-2 border-gray-200 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all disabled:opacity-50"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ProductDetail;
