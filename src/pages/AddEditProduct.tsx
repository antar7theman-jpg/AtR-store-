import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { doc, getDoc, setDoc, updateDoc, collection, addDoc, serverTimestamp, Timestamp, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, handleFirestoreError, OperationType } from '../firebase';
import { Product } from '../types';
import { useAuth } from '../components/AuthGuard';
import { 
  ArrowLeft, ScanLine, Package, Barcode, 
  Layers, DollarSign, Calendar, AlertTriangle, 
  CheckCircle, X, AlertCircle, Plus, Zap,
  Image as ImageIcon, Upload, Trash2, Camera
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Scanner from '../components/Scanner';

import { useTranslation } from 'react-i18next';

const AddEditProduct: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAdmin, isStaff, profile } = useAuth();
  const canManage = isAdmin || isStaff;
  const isEdit = !!id;

  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    barcode: searchParams.get('barcode') || '',
    barcodes: [searchParams.get('barcode') || ''].filter(Boolean) as string[],
    name: '',
    quantityPerBox: '',
    numBoxes: '',
    purchaseQty: '',
    purchasePrice: '',
    expiryDate: '',
    lowStockThreshold: '10',
    expiryAlertThreshold: '30',
    category: '',
    imageUrl: '',
  });

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const categories = [
    'Dairy', 'Bakery', 'Produce', 'Meat', 'Frozen', 
    'Beverages', 'Snacks', 'Household', 'Personal Care', 'Canned Goods'
  ];

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
              barcodes: data.barcodes || [data.barcode],
              name: data.name,
              quantityPerBox: data.quantityPerBox?.toString() || '',
              numBoxes: '',
              purchaseQty: '', // Not used in edit mode (staff records purchases)
              purchasePrice: data.lastPurchasePrice?.toString() || '',
              expiryDate: data.expiryDate ? data.expiryDate.toDate().toISOString().split('T')[0] : '',
              lowStockThreshold: data.lowStockThreshold?.toString() || '10',
              expiryAlertThreshold: data.expiryAlertThreshold?.toString() || '30',
              category: data.category || '',
              imageUrl: data.imageUrl || '',
            });
            if (data.imageUrl) {
              setImagePreview(data.imageUrl);
            }
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
    setFormData(prev => {
      const newState = { ...prev, [name]: value };
      
      // Auto-calculate total units if boxes or units per box change
      if (name === 'numBoxes' || name === 'quantityPerBox') {
        const boxes = parseInt(newState.numBoxes) || 0;
        const perBox = parseInt(newState.quantityPerBox) || 0;
        if (boxes > 0 && perBox > 0) {
          newState.purchaseQty = (boxes * perBox).toString();
        }
      }
      
      return newState;
    });
  };

  const handleBarcodeChange = (index: number, value: string) => {
    const newBarcodes = [...formData.barcodes];
    newBarcodes[index] = value;
    setFormData(prev => ({ 
      ...prev, 
      barcodes: newBarcodes,
      barcode: newBarcodes[0] || '' // Sync primary barcode
    }));
  };

  const addBarcodeField = () => {
    setFormData(prev => ({ ...prev, barcodes: [...prev.barcodes, ''] }));
  };

  const removeBarcodeField = (index: number) => {
    const newBarcodes = formData.barcodes.filter((_, i) => i !== index);
    setFormData(prev => ({ 
      ...prev, 
      barcodes: newBarcodes,
      barcode: newBarcodes[0] || ''
    }));
  };

  const handleScan = (barcode: string) => {
    // Add scanned barcode if it doesn't exist
    if (!formData.barcodes.includes(barcode)) {
      const newBarcodes = [...formData.barcodes, barcode].filter(Boolean);
      setFormData(prev => ({ 
        ...prev, 
        barcodes: newBarcodes,
        barcode: newBarcodes[0] || ''
      }));
    }
    setShowScanner(false);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setFormData(prev => ({ ...prev, imageUrl: '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !profile) return;

    const filteredBarcodes = formData.barcodes.filter(b => b.trim() !== '');
    if (filteredBarcodes.length === 0) {
      setError(t('products.atLeastOneBarcode'));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      let finalImageUrl = formData.imageUrl;

      // 0. Upload image if selected
      if (imageFile) {
        try {
          const storageRef = ref(storage, `products/${Date.now()}_${imageFile.name}`);
          const snapshot = await uploadBytes(storageRef, imageFile);
          finalImageUrl = await getDownloadURL(snapshot.ref);
        } catch (err) {
          console.error("Error uploading image:", err);
          setError(t('products.errorUploadingImage'));
          setSubmitting(false);
          return;
        }
      }

      // 1. Check if ANY of the barcodes are unique (only on create)
      if (!isEdit) {
        const q = query(collection(db, 'products'), where('barcodes', 'array-contains-any', filteredBarcodes));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          setError(t('products.barcodeAlreadyLinked'));
          setSubmitting(false);
          return;
        }
      }

      const productData: any = {
        barcode: filteredBarcodes[0],
        barcodes: filteredBarcodes,
        name: formData.name,
        quantityPerBox: parseInt(formData.quantityPerBox) || 0,
        lowStockThreshold: parseInt(formData.lowStockThreshold) || 0,
        expiryAlertThreshold: parseInt(formData.expiryAlertThreshold) || 0,
        category: formData.category,
        imageUrl: finalImageUrl,
        active: true,
        expiryDate: formData.expiryDate ? Timestamp.fromDate(new Date(formData.expiryDate)) : null,
      };

      if (isEdit && id) {
        try {
          await updateDoc(doc(db, 'products', id), productData);
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `products/${id}`);
        }
        navigate(`/products/${id}`);
      } else {
        // Initial purchase data
        const qty = parseInt(formData.purchaseQty) || 0;
        const price = parseFloat(formData.purchasePrice) || 0;
        const expiry = productData.expiryDate;

        productData.currentStock = qty;
        if (price > 0) productData.lastPurchasePrice = price;

        // Create product
        let productRef;
        try {
          productRef = await addDoc(collection(db, 'products'), productData);
          
          // Check for low stock alert on initial creation
          if (qty <= (productData.lowStockThreshold || 0)) {
            const { sendLowStockAlert } = await import('../services/notificationService');
            sendLowStockAlert({ ...productData, id: productRef.id });
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, 'products');
        }

        // Record initial purchase
        if (qty > 0 && productRef) {
          const purchaseData: any = {
            productId: productRef.id,
            quantity: qty,
            price: price,
            createdAt: serverTimestamp(),
            recordedBy: profile.uid,
            type: 'purchase'
          };
          
          if (expiry) {
            purchaseData.expiryDate = expiry;
          }

          try {
            await addDoc(collection(db, 'purchases'), purchaseData);
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, 'purchases');
          }
        }

        if (productRef) {
          navigate(`/products/${productRef.id}`);
        }
      }
    } catch (err) {
      console.error("Error saving product:", err);
      setError(t('products.errorSavingProduct'));
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
          {isEdit ? t('products.editProduct') : t('products.addProduct')}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Barcode Section */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-900 flex items-center">
              <Barcode className="h-5 w-5 mr-2 text-blue-500" />
              {t('products.productBarcodes')}
            </h3>
            <div className="flex space-x-2">
              <button
                type="button"
                onClick={() => {
                  setShowScanner(true);
                }}
                className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors flex items-center text-xs font-bold"
              >
                <ScanLine className="h-4 w-4 mr-1" />
                {t('products.scan')}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {formData.barcodes.map((barcode, index) => (
              <div key={index} className="flex space-x-2">
                <div className="relative flex-grow">
                  <input
                    type="text"
                    required
                    placeholder={t('products.enterBarcode')}
                    value={barcode}
                    onChange={(e) => handleBarcodeChange(index, e.target.value)}
                    className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {index === 0 && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-blue-500 bg-blue-50 px-2 py-1 rounded">
                      {t('products.primary')}
                    </span>
                  )}
                </div>
                {formData.barcodes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeBarcodeField(index)}
                    className="p-3 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addBarcodeField}
            className="w-full py-3 border-2 border-dashed border-gray-200 text-gray-400 font-medium rounded-xl hover:border-blue-200 hover:text-blue-500 transition-all flex items-center justify-center"
          >
            <Plus className="h-5 w-5 mr-2" />
            {t('products.addAnotherBarcode')}
          </button>

          {error && (
            <div className="flex items-center text-red-600 text-sm bg-red-50 p-3 rounded-lg">
              <AlertCircle className="h-4 w-4 mr-2" />
              {error}
            </div>
          )}
        </div>

        {/* Image Section */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
          <h3 className="text-lg font-bold text-gray-900 flex items-center">
            <ImageIcon className="h-5 w-5 mr-2 text-blue-500" />
            {t('products.productImage')}
          </h3>
          
          <div className="flex flex-col items-center justify-center space-y-4">
            {imagePreview ? (
              <div className="relative group">
                <img 
                  src={imagePreview} 
                  alt="Product preview" 
                  className="w-48 h-48 object-cover rounded-2xl border border-gray-200"
                  referrerPolicy="no-referrer"
                />
                <button
                  type="button"
                  onClick={removeImage}
                  className="absolute -top-2 -right-2 p-1.5 bg-red-100 text-red-600 rounded-full shadow-sm hover:bg-red-200 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="h-40 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-blue-200 hover:bg-blue-50 transition-all">
                  <Upload className="h-8 w-8 text-gray-400 mb-2" />
                  <span className="text-sm font-medium text-gray-500">{t('products.uploadGallery')}</span>
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleImageChange} 
                    className="hidden" 
                  />
                </label>
                
                <label className="h-40 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-blue-200 hover:bg-blue-50 transition-all">
                  <Camera className="h-8 w-8 text-gray-400 mb-2" />
                  <span className="text-sm font-medium text-gray-500">{t('products.takePhoto')}</span>
                  <input 
                    type="file" 
                    accept="image/*" 
                    capture="environment"
                    onChange={handleImageChange} 
                    className="hidden" 
                  />
                </label>
              </div>
            )}
            <p className="text-xs text-gray-400">{t('products.imageRecommendation')}</p>
          </div>
        </div>

        {/* Basic Info Section */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
          <h3 className="text-lg font-bold text-gray-900 flex items-center">
            <Package className="h-5 w-5 mr-2 text-blue-500" />
            {t('products.productDetails')}
          </h3>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.productName')}</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.category')}</label>
            <div className="relative">
              <input
                type="text"
                name="category"
                list="category-list"
                placeholder="e.g. Beverages"
                value={formData.category}
                onChange={handleInputChange}
                className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <datalist id="category-list">
                {categories.map(cat => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.quantityPerBox')}</label>
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.expiryDate')}</label>
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

        {/* Initial Purchase Section (Only for Add) */}
        {!isEdit && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
            <h3 className="text-lg font-bold text-gray-900 flex items-center">
              <DollarSign className="h-5 w-5 mr-2 text-blue-500" />
              {t('products.initialPurchase')}
            </h3>

            <div className="bg-blue-50 p-4 rounded-xl space-y-4">
              <p className="text-xs font-bold text-blue-600 uppercase tracking-wider">{t('products.unitCalculator')}</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-blue-500 mb-1 uppercase">{t('products.numberOfBoxes')}</label>
                  <input
                    type="number"
                    name="numBoxes"
                    placeholder="0"
                    value={formData.numBoxes}
                    onChange={handleInputChange}
                    className="block w-full px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-blue-500 mb-1 uppercase">{t('products.unitsPerBox')}</label>
                  <input
                    type="number"
                    name="quantityPerBox"
                    placeholder="0"
                    value={formData.quantityPerBox}
                    onChange={handleInputChange}
                    className="block w-full px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              {parseInt(formData.numBoxes) > 0 && parseInt(formData.quantityPerBox) > 0 && (
                <div className="text-center pt-2 border-t border-blue-100">
                  <p className="text-sm font-bold text-blue-700">
                    {t('productDetail.calculatorResult', { 
                      numBoxes: formData.numBoxes, 
                      unitsPerBox: formData.quantityPerBox, 
                      total: parseInt(formData.numBoxes) * parseInt(formData.quantityPerBox) 
                    })}
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.initialQuantity')}</label>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.purchasePrice')}</label>
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
          </div>
        )}

        {/* Alert Thresholds Section */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
          <h3 className="text-lg font-bold text-gray-900 flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2 text-blue-500" />
            {t('products.alertThresholds')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.lowStockThreshold')}</label>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.expiryAlertThreshold')}</label>
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
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 px-6 py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-50"
          >
            {submitting ? t('common.saving') : isEdit ? t('products.updateProduct') : t('products.createProduct')}
          </button>
        </div>
      </form>

      {/* Scanner Overlay */}
      <AnimatePresence mode="wait">
        {showScanner && (
          <Scanner 
            onScan={handleScan} 
            onClose={() => setShowScanner(false)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default AddEditProduct;
