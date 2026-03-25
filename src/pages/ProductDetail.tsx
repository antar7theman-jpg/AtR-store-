import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, collection, addDoc, serverTimestamp, Timestamp, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Product, Purchase } from '../types';
import { useAuth } from '../components/AuthGuard';
import { 
  ArrowLeft, Edit2, Trash2, History, Plus, 
  Package, Barcode, Calendar, DollarSign, 
  AlertTriangle, CheckCircle, X, ShoppingCart
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import { differenceInDays } from 'date-fns';

const ProductDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, profile } = useAuth();
  const [product, setProduct] = useState<Product | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [highlightHistory, setHighlightHistory] = useState(false);

  // Parse query params
  const queryParams = new URLSearchParams(location.search);
  const activeTab = queryParams.get('tab');

  useEffect(() => {
    if (activeTab === 'history') {
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
  }, [activeTab]);

  // Purchase Form State
  const [purchaseQty, setPurchaseQty] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseExpiry, setPurchaseExpiry] = useState('');
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
    const unsubscribePurchases = onSnapshot(q, (snapshot) => {
      const purchaseList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Purchase));
      setPurchases(purchaseList);
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
        recordedBy: profile.uid
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
    } catch (error) {
      console.error("Error recording purchase:", error);
      alert("Failed to record purchase. Please try again.");
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
            <p className="text-gray-500 flex items-center mt-1">
              <Barcode className="h-4 w-4 mr-1" />
              {product.barcode}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Info Card */}
        <div className="lg:col-span-2 space-y-8">
          {/* Last Purchase Summary */}
          {purchases.length > 0 && (
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
                    {formatCurrency(purchases[0].price)} 
                    <span className="text-blue-200 text-sm font-normal ml-2">
                      on {formatDate(purchases[0].createdAt.toDate())}
                    </span>
                  </p>
                </div>
              </div>
              <div className="text-right hidden sm:block">
                <p className="text-blue-100 text-xs font-bold uppercase tracking-wider">Quantity</p>
                <p className="text-xl font-bold">+{purchases[0].quantity} units</p>
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

        {/* Sidebar: Recent Activity / History Toggle */}
        <div className="space-y-6" id="purchase-history">
          <motion.div 
            animate={highlightHistory ? { scale: [1, 1.02, 1], boxShadow: ["0 0 0 rgba(59, 130, 246, 0)", "0 0 20px rgba(59, 130, 246, 0.3)", "0 0 0 rgba(59, 130, 246, 0)"] } : {}}
            transition={{ duration: 1, repeat: 2 }}
            className={cn(
              "bg-white shadow-sm rounded-2xl border transition-all overflow-hidden",
              highlightHistory ? "border-blue-400 ring-2 ring-blue-100" : "border-gray-100"
            )}
          >
            <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900 flex items-center">
                <History className="h-5 w-5 mr-2 text-gray-400" />
                Purchase History
              </h3>
            </div>
            <div className="divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
              {purchases.length > 0 ? (
                purchases.map((purchase) => (
                  <div key={purchase.id} className="px-6 py-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-bold text-gray-900">+{purchase.quantity} units</p>
                        <p className="text-xs text-gray-500">{formatDate(purchase.createdAt.toDate())}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-900">{formatCurrency(purchase.price)}</p>
                        <p className="text-[10px] text-gray-400 uppercase tracking-tighter">Exp: {formatDate(purchase.expiryDate.toDate())}</p>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-6 py-12 text-center">
                  <p className="text-sm text-gray-400 italic">No purchase history available</p>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>

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
    </div>
  );
};

export default ProductDetail;
