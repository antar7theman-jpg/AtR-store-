import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, collection, addDoc, serverTimestamp, Timestamp, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Product, Purchase, UserProfile } from '../types';
import { useAuth } from '../components/AuthGuard';
import { 
  ArrowLeft, Edit2, Trash2, History, Plus, 
  Package, Barcode, Calendar, DollarSign, 
  AlertTriangle, CheckCircle, X, ShoppingCart,
  ScanLine, Link as LinkIcon, Minus, ClipboardList,
  User as UserIcon, Clock, Search, Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import { differenceInDays } from 'date-fns';
import Scanner from '../components/Scanner';

const ProductDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, profile } = useAuth();
  const [product, setProduct] = useState<Product | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [users, setUsers] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [useFlash, setUseFlash] = useState(false);
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
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseExpiry, setPurchaseExpiry] = useState('');
  const [purchaseNote, setPurchaseNote] = useState('');
  
  // Adjustment Form State
  const [adjustmentQty, setAdjustmentQty] = useState('');
  const [adjustmentNote, setAdjustmentNote] = useState('');
  
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;

    const productPath = `products/${id}`;
    const unsubscribeProduct = onSnapshot(doc(db, 'products', id), (doc) => {
      if (doc.exists()) {
        setProduct({ id: doc.id, ...doc.data() } as Product);
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

      // 1. Add purchase record
      await addDoc(collection(db, 'purchases'), {
        productId: id,
        quantity: qty,
        price: price,
        expiryDate: Timestamp.fromDate(expiry),
        createdAt: serverTimestamp(),
        recordedBy: profile.uid,
        type: 'purchase',
        note: purchaseNote
      });

      // 2. Update product
      await updateDoc(doc(db, 'products', id), {
        currentStock: product.currentStock + qty,
        lastPurchasePrice: price,
        expiryDate: Timestamp.fromDate(expiry)
      });

      setShowPurchaseModal(false);
      setPurchaseQty('');
      setPurchasePrice('');
      setPurchaseExpiry('');
      setPurchaseNote('');
    } catch (error) {
      console.error("Error recording purchase:", error);
      alert("Failed to record purchase. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product || !id || !profile) return;

    setSubmitting(true);
    try {
      const qty = parseInt(adjustmentQty);
      
      // 1. Add adjustment record
      await addDoc(collection(db, 'purchases'), {
        productId: id,
        quantity: qty,
        createdAt: serverTimestamp(),
        recordedBy: profile.uid,
        type: 'adjustment',
        note: adjustmentNote
      });

      // 2. Update product
      await updateDoc(doc(db, 'products', id), {
        currentStock: product.currentStock + qty
      });

      setShowAdjustmentModal(false);
      setAdjustmentQty('');
      setAdjustmentNote('');
    } catch (error) {
      console.error("Error adjusting stock:", error);
      alert("Failed to adjust stock. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!id || !window.confirm("Are you sure you want to delete this product? This action cannot be undone.")) return;
    
    try {
      // In a real app, we might want to delete purchases too, but rules might block it.
      // For now, just delete the product.
      await updateDoc(doc(db, 'products', id), { active: false }); // Soft delete or actual delete
      // await deleteDoc(doc(db, 'products', id));
      navigate('/products');
    } catch (error) {
      console.error("Error deleting product:", error);
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
    } catch (error) {
      console.error("Error linking barcode:", error);
      alert("Failed to link barcode. Please try again.");
    } finally {
      setLinking(false);
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

  const isLowStock = product.currentStock <= (product.lowStockThreshold || 0);
  let daysRemaining = null;
  let isExpiring = false;
  if (product.expiryDate) {
    daysRemaining = differenceInDays(product.expiryDate.toDate(), new Date());
    isExpiring = daysRemaining <= (product.expiryAlertThreshold || 0);
  }

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
        <div className="flex items-center space-x-4">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <ArrowLeft className="h-6 w-6 text-gray-600" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">{product.name}</h1>
            <div className="flex flex-wrap gap-2 mt-1">
              {(product.barcodes || [product.barcode]).map((bc, i) => (
                <span key={i} className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded flex items-center">
                  <Barcode className="h-3 w-3 mr-1" />
                  {bc}
                </span>
              ))}
            </div>
          </div>
        </div>
          <div className="flex items-center space-x-3">
            {isAdmin && (
              <button
                onClick={() => setShowAdjustmentModal(true)}
                className="p-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors shadow-sm flex items-center"
                title="Manual Stock Adjustment"
              >
                <ClipboardList className="h-5 w-5" />
              </button>
            )}
            {isAdmin && (
              <div className="flex space-x-2">
                <button
                  onClick={() => {
                    setUseFlash(false);
                    setShowScanner(true);
                  }}
                  className="p-2.5 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors shadow-sm flex items-center"
                  title="Scan to identify or link barcode"
                >
                  <ScanLine className="h-5 w-5" />
                </button>
                <button
                  onClick={() => {
                    setUseFlash(true);
                    setShowScanner(true);
                  }}
                  className="p-2.5 bg-amber-50 text-amber-600 rounded-xl hover:bg-amber-100 transition-colors shadow-sm flex items-center"
                  title="Scan with flashlight"
                >
                  <Zap className="h-5 w-5" />
                </button>
              </div>
            )}
            {isAdmin && (
              <>
              <Link
                to={`/products/edit/${product.id}`}
                className="p-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
              >
                <Edit2 className="h-5 w-5" />
              </Link>
              <button
                onClick={handleDelete}
                className="p-2.5 bg-white border border-gray-200 text-red-600 rounded-xl hover:bg-red-50 transition-colors shadow-sm"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </>
          )}
          <button
            onClick={() => setShowPurchaseModal(true)}
            className="inline-flex items-center px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-md font-medium"
          >
            <Plus className="mr-2 h-5 w-5" />
            Record Purchase
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 bg-gray-100 p-1 rounded-2xl w-fit">
        <button
          onClick={() => setActiveTab('overview')}
          className={cn(
            "px-6 py-2 rounded-xl text-sm font-bold transition-all",
            activeTab === 'overview' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
          )}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={cn(
            "px-6 py-2 rounded-xl text-sm font-bold transition-all",
            activeTab === 'history' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
          )}
        >
          Stock History
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
                      <p className="text-blue-100 text-xs font-bold uppercase tracking-wider">Last Purchase</p>
                      <p className="text-xl font-bold">
                        {formatCurrency(purchases.find(p => p.type === 'purchase')?.price || 0)} 
                        <span className="text-blue-200 text-sm font-normal ml-2">
                          on {formatDate(purchases.find(p => p.type === 'purchase')?.createdAt.toDate() || new Date())}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="text-right hidden sm:block">
                    <p className="text-blue-100 text-xs font-bold uppercase tracking-wider">Quantity</p>
                    <p className="text-xl font-bold">+{purchases.find(p => p.type === 'purchase')?.quantity} units</p>
                  </div>
                </motion.div>
              )}

              <div className="bg-white shadow-sm rounded-2xl border border-gray-100 p-8 grid grid-cols-1 sm:grid-cols-2 gap-8">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Current Stock</p>
                  <div className="flex items-center space-x-3">
                    <span className={cn("text-4xl font-bold", isLowStock ? "text-amber-600" : "text-gray-900")}>
                      {product.currentStock}
                    </span>
                    <span className="text-gray-400 text-lg">units</span>
                  </div>
                  {isLowStock && (
                    <div className="flex items-center text-amber-600 text-sm font-medium mt-2">
                      <AlertTriangle className="h-4 w-4 mr-1" />
                      Low Stock Alert
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Latest Expiry</p>
                  <div className="flex items-center space-x-3">
                    <span className={cn("text-2xl font-bold", isExpiring ? "text-red-600" : "text-gray-900")}>
                      {product.expiryDate ? formatDate(product.expiryDate.toDate()) : 'N/A'}
                    </span>
                  </div>
                  {isExpiring && (
                    <div className="flex items-center text-red-600 text-sm font-medium mt-2">
                      <Calendar className="h-4 w-4 mr-1" />
                      Expiring in {daysRemaining} days
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Last Purchase Price</p>
                  <div className="flex items-center space-x-3">
                    <span className="text-2xl font-bold text-gray-900">
                      {product.lastPurchasePrice ? formatCurrency(product.lastPurchasePrice) : 'N/A'}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Quantity per Box</p>
                  <div className="flex items-center space-x-3">
                    <span className="text-2xl font-bold text-gray-900">
                      {product.quantityPerBox || 'N/A'}
                    </span>
                    <span className="text-gray-400">units</span>
                  </div>
                </div>
              </div>

              {/* Thresholds Card */}
              <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Alert Thresholds</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="flex items-center space-x-4">
                    <div className="bg-amber-100 p-2 rounded-lg">
                      <AlertTriangle className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Low Stock Threshold</p>
                      <p className="text-sm font-bold text-gray-900">{product.lowStockThreshold || 0} units</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="bg-red-100 p-2 rounded-lg">
                      <Calendar className="h-5 w-5 text-red-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Expiry Alert Threshold</p>
                      <p className="text-sm font-bold text-gray-900">{product.expiryAlertThreshold || 0} days before</p>
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
                    Recent Activity
                  </h3>
                  <button 
                    onClick={() => setActiveTab('history')}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 uppercase tracking-wider"
                  >
                    View All
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
                              {purchase.quantity > 0 ? '+' : ''}{purchase.quantity} units
                            </p>
                            <div className="flex items-center text-[10px] text-gray-400 space-x-2">
                              <span>{formatDate(purchase.createdAt.toDate())}</span>
                              <span>•</span>
                              <span>{users[purchase.recordedBy]?.name || 'Unknown'}</span>
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
                    Product Barcodes
                  </h3>
                </div>
                <div className="p-6 space-y-4">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Search className="h-4 w-4 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      placeholder="Search barcodes..."
                      value={barcodeSearch}
                      onChange={(e) => setBarcodeSearch(e.target.value)}
                      className="block w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(() => {
                      const allBarcodes = Array.from(new Set([product.barcode, ...(product.barcodes || [])])).filter(Boolean);
                      const filtered = allBarcodes.filter(bc => bc.toLowerCase().includes(barcodeSearch.toLowerCase()));
                      
                      if (filtered.length === 0) {
                        return <p className="text-xs text-gray-400 italic">No matching barcodes found</p>;
                      }

                      return filtered.map((bc, i) => (
                        <span key={i} className="text-xs font-mono bg-gray-50 text-gray-600 px-2 py-1 rounded-lg border border-gray-100 flex items-center">
                          <Barcode className="h-3 w-3 mr-1 opacity-50" />
                          {bc}
                          {bc === product.barcode && (
                            <span className="ml-1.5 text-[8px] uppercase bg-blue-100 text-blue-600 px-1 rounded">Primary</span>
                          )}
                        </span>
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
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Date & Time</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Type</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Quantity</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Price</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Expiry</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">User</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {purchases.length > 0 ? (
                      purchases.map((purchase) => (
                        <tr key={purchase.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center text-sm text-gray-900">
                              <Clock className="h-4 w-4 mr-2 text-gray-400" />
                              {formatDate(purchase.createdAt.toDate())}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={cn(
                              "inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                              purchase.type === 'adjustment' ? "bg-gray-100 text-gray-600" : "bg-blue-100 text-blue-600"
                            )}>
                              {purchase.type}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={cn(
                              "text-sm font-bold",
                              purchase.quantity > 0 ? "text-green-600" : "text-red-600"
                            )}>
                              {purchase.quantity > 0 ? '+' : ''}{purchase.quantity} units
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-900">
                              {purchase.type === 'purchase' ? formatCurrency(purchase.price || 0) : '-'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-900">
                              {purchase.type === 'purchase' && purchase.expiryDate ? formatDate(purchase.expiryDate.toDate()) : '-'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center text-sm text-gray-900">
                              <UserIcon className="h-4 w-4 mr-2 text-gray-400" />
                              {users[purchase.recordedBy]?.name || 'Unknown User'}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-xs text-gray-500 italic">
                              {purchase.note || (purchase.type === 'adjustment' ? 'No reason provided' : '')}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-6 py-20 text-center">
                          <History className="h-12 w-12 text-gray-200 mx-auto mb-4" />
                          <p className="text-gray-400 italic">No stock history available for this product</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
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
                <h3 className="text-lg font-bold text-gray-900">Record New Purchase</h3>
                <button onClick={() => setShowPurchaseModal(false)} className="p-1 hover:bg-gray-200 rounded-full transition-colors">
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>
              <form onSubmit={handleRecordPurchase} className="p-6 space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Quantity (units)</label>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Price (per unit)</label>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Batch Expiry Date</label>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Note (Optional)</label>
                  <textarea
                    value={purchaseNote}
                    onChange={(e) => setPurchaseNote(e.target.value)}
                    className="block w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g. Batch from new supplier..."
                    rows={2}
                  />
                </div>

                <div className="pt-4 flex space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowPurchaseModal(false)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-4 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-md disabled:opacity-50"
                  >
                    {submitting ? "Saving..." : "Save Record"}
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
                <h3 className="text-lg font-bold text-gray-900">Manual Stock Adjustment</h3>
                <button onClick={() => setShowAdjustmentModal(false)} className="p-1 hover:bg-gray-200 rounded-full transition-colors">
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>
              <form onSubmit={handleManualAdjustment} className="p-6 space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Adjustment Quantity</label>
                  <p className="text-xs text-gray-400 mb-2">Use positive numbers to add stock, negative to remove.</p>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Plus className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="number"
                      required
                      value={adjustmentQty}
                      onChange={(e) => setAdjustmentQty(e.target.value)}
                      className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g. 10 or -5"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reason / Note (Optional)</label>
                  <textarea
                    value={adjustmentNote}
                    onChange={(e) => setAdjustmentNote(e.target.value)}
                    className="block w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g. Damaged goods, inventory correction..."
                    rows={3}
                  />
                </div>

                <div className="pt-4 flex space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowAdjustmentModal(false)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-4 py-2.5 bg-gray-900 text-white font-medium rounded-xl hover:bg-gray-800 transition-colors shadow-md disabled:opacity-50"
                  >
                    {submitting ? "Adjusting..." : "Confirm Adjustment"}
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
            autoFlash={useFlash}
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
                  <h3 className="text-xl font-bold text-gray-900">Link New Barcode?</h3>
                  <p className="text-gray-500 mt-2">
                    Barcode <span className="font-mono font-bold text-gray-900">{scannedBarcode}</span> was not found.
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    Would you like to link it to <span className="font-bold text-blue-600">{product.name}</span>?
                  </p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={handleLinkBarcode}
                    disabled={linking}
                    className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-md disabled:opacity-50"
                  >
                    {linking ? "Linking..." : "Link to Current Product"}
                  </button>
                  <button
                    onClick={() => {
                      setShowLinkModal(false);
                      setScannedBarcode(null);
                    }}
                    disabled={linking}
                    className="w-full py-4 bg-white border-2 border-gray-200 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all disabled:opacity-50"
                  >
                    Cancel
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
