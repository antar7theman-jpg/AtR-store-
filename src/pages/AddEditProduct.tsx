import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { doc, getDoc, setDoc, updateDoc, collection, addDoc, serverTimestamp, Timestamp, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { Product } from '../types';
import { useAuth } from '../components/AuthGuard';
import { 
  ArrowLeft, ScanLine, Package, Barcode, 
  Layers, DollarSign, Calendar, AlertTriangle, 
  CheckCircle, X, AlertCircle 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Scanner from '../components/Scanner';

const AddEditProduct: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAdmin, profile } = useAuth();
  const isEdit = !!id;

  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    barcode: searchParams.get('barcode') || '',
    name: '',
    quantityPerBox: '',
    purchaseQty: '',
    purchasePrice: '',
    expiryDate: '',
    lowStockThreshold: '10',
    expiryAlertThreshold: '30',
  });

  useEffect(() => {
    if (isEdit && id) {
      const fetchProduct = async () => {
        try {
          const docRef = doc(db, 'products', id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data() as Product;
            setFormData({
              barcode: data.barcode,
              name: data.name,
              quantityPerBox: data.quantityPerBox?.toString() || '',
              purchaseQty: '', // Not used in edit mode (staff records purchases)
              purchasePrice: data.lastPurchasePrice?.toString() || '',
              expiryDate: data.expiryDate ? data.expiryDate.toDate().toISOString().split('T')[0] : '',
              lowStockThreshold: data.lowStockThreshold?.toString() || '10',
              expiryAlertThreshold: data.expiryAlertThreshold?.toString() || '30',
            });
          }
        } catch (error) {
          console.error("Error fetching product:", error);
        } finally {
          setLoading(false);
        }
      };
      fetchProduct();
    }
  }, [id, isEdit]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleScan = (barcode: string) => {
    setFormData(prev => ({ ...prev, barcode }));
    setShowScanner(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !profile) return;

    setSubmitting(true);
    setError(null);

    try {
      // 1. Check if barcode is unique (only on create)
      if (!isEdit) {
        const q = query(collection(db, 'products'), where('barcode', '==', formData.barcode));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          setError("A product with this barcode already exists.");
          setSubmitting(false);
          return;
        }
      }

      const productData: any = {
        barcode: formData.barcode,
        name: formData.name,
        quantityPerBox: parseInt(formData.quantityPerBox) || 0,
        lowStockThreshold: parseInt(formData.lowStockThreshold) || 0,
        expiryAlertThreshold: parseInt(formData.expiryAlertThreshold) || 0,
      };

      if (isEdit && id) {
        await updateDoc(doc(db, 'products', id), productData);
        navigate(`/products/${id}`);
      } else {
        // Initial purchase data
        const qty = parseInt(formData.purchaseQty) || 0;
        const price = parseFloat(formData.purchasePrice) || 0;
        const expiry = formData.expiryDate ? Timestamp.fromDate(new Date(formData.expiryDate)) : null;

        productData.currentStock = qty;
        productData.lastPurchasePrice = price;
        productData.expiryDate = expiry;
        productData.active = true;

        // Create product
        const productRef = await addDoc(collection(db, 'products'), productData);

        // Record initial purchase
        if (qty > 0) {
          await addDoc(collection(db, 'purchases'), {
            productId: productRef.id,
            quantity: qty,
            price: price,
            expiryDate: expiry,
            createdAt: serverTimestamp(),
            recordedBy: profile.uid
          });
        }

        navigate(`/products/${productRef.id}`);
      }
    } catch (err) {
      console.error("Error saving product:", err);
      setError("An error occurred while saving. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-20">
      <div className="flex items-center space-x-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <ArrowLeft className="h-6 w-6 text-gray-600" />
        </button>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
          {isEdit ? "Edit Product" : "Add New Product"}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Barcode Section */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
          <h3 className="text-lg font-bold text-gray-900 flex items-center">
            <Barcode className="h-5 w-5 mr-2 text-blue-500" />
            Product Identification
          </h3>
          <div className="flex space-x-2">
            <div className="relative flex-grow">
              <input
                type="text"
                name="barcode"
                required
                placeholder="Scan or enter barcode"
                value={formData.barcode}
                onChange={handleInputChange}
                className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowScanner(true)}
              className="px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm flex items-center"
            >
              <ScanLine className="h-5 w-5" />
            </button>
          </div>
          {error && (
            <div className="flex items-center text-red-600 text-sm bg-red-50 p-3 rounded-lg">
              <AlertCircle className="h-4 w-4 mr-2" />
              {error}
            </div>
          )}
        </div>

        {/* Basic Info Section */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
          <h3 className="text-lg font-bold text-gray-900 flex items-center">
            <Package className="h-5 w-5 mr-2 text-blue-500" />
            Product Details
          </h3>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
            <input
              type="text"
              name="name"
              required
              placeholder="e.g. Coca Cola 330ml"
              value={formData.name}
              onChange={handleInputChange}
              className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantity per Box</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Layers className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="number"
                name="quantityPerBox"
                placeholder="e.g. 24"
                value={formData.quantityPerBox}
                onChange={handleInputChange}
                className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Initial Purchase Section (Only for Add) */}
        {!isEdit && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
            <h3 className="text-lg font-bold text-gray-900 flex items-center">
              <DollarSign className="h-5 w-5 mr-2 text-blue-500" />
              Initial Purchase
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Initial Quantity (units)</label>
                <input
                  type="number"
                  name="purchaseQty"
                  required
                  placeholder="0"
                  value={formData.purchaseQty}
                  onChange={handleInputChange}
                  className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Price (per unit)</label>
                <input
                  type="number"
                  step="0.01"
                  name="purchasePrice"
                  required
                  placeholder="0.00"
                  value={formData.purchasePrice}
                  onChange={handleInputChange}
                  className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                  name="expiryDate"
                  required
                  value={formData.expiryDate}
                  onChange={handleInputChange}
                  className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Alert Thresholds Section */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
          <h3 className="text-lg font-bold text-gray-900 flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2 text-blue-500" />
            Alert Thresholds
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Low Stock (units)</label>
              <input
                type="number"
                name="lowStockThreshold"
                required
                value={formData.lowStockThreshold}
                onChange={handleInputChange}
                className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Alert (days before)</label>
              <input
                type="number"
                name="expiryAlertThreshold"
                required
                value={formData.expiryAlertThreshold}
                onChange={handleInputChange}
                className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="flex space-x-4 pt-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex-1 px-6 py-4 border border-gray-300 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 px-6 py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-50"
          >
            {submitting ? "Saving..." : isEdit ? "Update Product" : "Create Product"}
          </button>
        </div>
      </form>

      {/* Scanner Overlay */}
      <AnimatePresence mode="wait">
        {showScanner && (
          <Scanner onScan={handleScan} onClose={() => setShowScanner(false)} />
        )}
      </AnimatePresence>
    </div>
  );
};

export default AddEditProduct;
