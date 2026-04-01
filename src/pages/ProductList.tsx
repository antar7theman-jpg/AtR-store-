import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc, writeBatch, where, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Product } from '../types';
import { Search, Plus, Package, AlertTriangle, Calendar, ChevronRight, Link as LinkIcon, X, CheckCircle, Lock, Filter, Trash2, Tag, CheckSquare, Square, Edit2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthGuard';
import { motion, AnimatePresence } from 'motion/react';
import { differenceInDays } from 'date-fns';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';

const ProductList: React.FC = () => {
  const { isAdmin, isStaff } = useAuth();
  const canManage = isAdmin || isStaff;
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [linkingBarcode, setLinkingBarcode] = useState<string | null>(null);
  const [confirmLinkProduct, setConfirmLinkProduct] = useState<Product | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState(false);
  
  // Bulk Actions State
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [showBulkCategoryModal, setShowBulkCategoryModal] = useState(false);
  const [bulkCategory, setBulkCategory] = useState('');
  const [isBulkOperating, setIsBulkOperating] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // Parse query params
  useEffect(() => {
    const queryParams = new URLSearchParams(location.search);
    const barcode = queryParams.get('linkBarcode');
    if (barcode) {
      setLinkingBarcode(barcode);
    }
  }, [location]);

  useEffect(() => {
    const path = 'products';
    const q = query(collection(db, path), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const productList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      setProducts(productList);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribe();
  }, []);

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.barcode.includes(searchTerm) ||
      (p.barcodes && p.barcodes.some(bc => bc.includes(searchTerm)));
    
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  const categories = ['all', ...Array.from(new Set(products.map(p => p.category).filter(Boolean)))];

  const getAlertStatus = (product: Product) => {
    const isLowStock = product.currentStock <= (product.lowStockThreshold || 0);
    let isExpiring = false;
    if (product.expiryDate) {
      const daysRemaining = differenceInDays(product.expiryDate.toDate(), new Date());
      isExpiring = daysRemaining <= (product.expiryAlertThreshold || 0);
    }
    return { isLowStock, isExpiring };
  };

  const handleConfirmLink = async () => {
    if (!confirmLinkProduct || !linkingBarcode) return;
    
    setLinking(true);
    setLinkError(null);
    try {
      const currentBarcodes = confirmLinkProduct.barcodes || [confirmLinkProduct.barcode];
      const newBarcodes = Array.from(new Set([...currentBarcodes, linkingBarcode]));
      
      await updateDoc(doc(db, 'products', confirmLinkProduct.id), {
        barcodes: newBarcodes,
        barcode: newBarcodes[0] // Ensure primary barcode is consistent
      });
      setLinkSuccess(true);
      setTimeout(() => {
        setLinkSuccess(false);
        setConfirmLinkProduct(null);
        setLinkingBarcode(null);
        navigate(`/products/${confirmLinkProduct.id}`, { replace: true });
      }, 1500);
    } catch (error: any) {
      console.error("Error linking barcode:", error);
      if (error.message?.includes('permission')) {
        setLinkError(t('products.adminAccessRequired'));
      } else {
        setLinkError(t('products.linking'));
      }
    } finally {
      setLinking(false);
    }
  };

  const handleProductClick = (product: Product) => {
    if (linkingBarcode) {
      if (!canManage) {
        setLinkError(t('products.adminAccessRequired'));
        // We still show the modal but with an error and disabled confirm
        setConfirmLinkProduct(product);
        return;
      }
      setConfirmLinkProduct(product);
    } else {
      navigate(`/products/${product.id}`);
    }
  };

  const toggleSelectProduct = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedProductIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedProductIds.length === filteredProducts.length) {
      setSelectedProductIds([]);
    } else {
      setSelectedProductIds(filteredProducts.map(p => p.id));
    }
  };

  const handleBulkDelete = async () => {
    if (!canManage || selectedProductIds.length === 0) return;
    setShowBulkDeleteConfirm(true);
  };

  const confirmBulkDelete = async () => {
    if (!canManage || selectedProductIds.length === 0) return;

    setIsBulkOperating(true);
    try {
      const batch = writeBatch(db);
      
      // We need to fetch related records for each product
      for (const id of selectedProductIds) {
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
      }
      
      await batch.commit();
      setSelectedProductIds([]);
      setLinkSuccess(true);
      setTimeout(() => setLinkSuccess(false), 2000);
      setShowBulkDeleteConfirm(false);
    } catch (error) {
      console.error("Error bulk deleting products:", error);
      setLinkError(t('products.linking'));
      handleFirestoreError(error, OperationType.DELETE, 'products');
    } finally {
      setIsBulkOperating(false);
    }
  };

  const handleBulkCategoryUpdate = async () => {
    if (!canManage || selectedProductIds.length === 0 || !bulkCategory) return;

    setIsBulkOperating(true);
    try {
      const batch = writeBatch(db);
      selectedProductIds.forEach(id => {
        batch.update(doc(db, 'products', id), { category: bulkCategory });
      });
      await batch.commit();
      setSelectedProductIds([]);
      setShowBulkCategoryModal(false);
      setBulkCategory('');
      setLinkSuccess(true);
      setTimeout(() => setLinkSuccess(false), 2000);
    } catch (error) {
      console.error("Error bulk updating categories:", error);
      setLinkError(t('products.linking'));
    } finally {
      setIsBulkOperating(false);
    }
  };

  const handleDeleteProduct = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canManage) return;
    setShowDeleteConfirm(id);
  };

  const confirmDeleteProduct = async () => {
    if (!showDeleteConfirm || !canManage) return;

    setIsBulkOperating(true);
    try {
      const batch = writeBatch(db);
      
      // Delete the product
      batch.delete(doc(db, 'products', showDeleteConfirm));
      
      // Find and delete purchases
      const purchasesQuery = query(collection(db, 'purchases'), where('productId', '==', showDeleteConfirm));
      const purchasesSnapshot = await getDocs(purchasesQuery);
      purchasesSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      // Find and delete transactions
      const transactionsQuery = query(collection(db, 'transactions'), where('productId', '==', showDeleteConfirm));
      const transactionsSnapshot = await getDocs(transactionsQuery);
      transactionsSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      setLinkSuccess(true);
      setTimeout(() => setLinkSuccess(false), 2000);
      setShowDeleteConfirm(null);
    } catch (error) {
      console.error("Error deleting product:", error);
      handleFirestoreError(error, OperationType.DELETE, `products/${showDeleteConfirm}`);
    } finally {
      setIsBulkOperating(false);
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
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">{t('products.title')}</h1>
          <p className="text-gray-500 mt-1">{t('products.subtitle')}</p>
        </div>
        {canManage && (
          <Link
            to="/products/add"
            className="inline-flex items-center justify-center px-4 py-2.5 border border-transparent text-sm font-medium rounded-xl shadow-sm text-white bg-blue-600 hover:bg-blue-700 transition-all"
          >
            <Plus className="mr-2 rtl:mr-0 rtl:ml-2 h-5 w-5" />
            {t('products.addProduct')}
          </Link>
        )}
      </div>

      {/* Linking Banner */}
      <AnimatePresence>
        {linkingBarcode && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-blue-600 p-4 rounded-2xl text-white shadow-lg flex items-center justify-between"
          >
            <div className="flex items-center space-x-3 rtl:space-x-reverse">
              <div className="bg-white/20 p-2 rounded-lg">
                <LinkIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-bold">{t('products.linkBarcode', { barcode: linkingBarcode })}</p>
                <p className="text-xs text-blue-100">{t('products.linkBarcodeSubtitle')}</p>
              </div>
            </div>
            <button 
              onClick={() => {
                setLinkingBarcode(null);
                navigate('/products', { replace: true });
              }}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search & Filter Bar */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-grow">
          <div className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 pl-3 rtl:pl-0 rtl:pr-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            placeholder={t('products.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="block w-full pl-10 rtl:pl-3 rtl:pr-10 pr-3 py-3 border border-gray-200 rounded-2xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-all"
          />
        </div>
        
        <div className="flex gap-2">
          {canManage && filteredProducts.length > 0 && !linkingBarcode && (
            <button
              onClick={toggleSelectAll}
              className="flex items-center px-4 py-3 border border-gray-200 rounded-2xl bg-white shadow-sm hover:bg-gray-50 transition-all text-sm font-medium text-gray-700"
            >
              {selectedProductIds.length === filteredProducts.length ? (
                <CheckSquare className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 text-blue-600" />
              ) : (
                <Square className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 text-gray-400" />
              )}
              {selectedProductIds.length === filteredProducts.length ? t('products.deselectAll') : t('products.selectAll')}
            </button>
          )}

          <div className="relative min-w-[160px]">
            <div className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 pl-3 rtl:pl-0 rtl:pr-3 flex items-center pointer-events-none">
              <Filter className="h-4 w-4 text-gray-400" />
            </div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="block w-full pl-10 rtl:pl-3 rtl:pr-10 pr-10 py-3 border border-gray-200 rounded-2xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-all appearance-none"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat === 'all' ? t('products.allCategories') : cat}</option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 rtl:right-auto rtl:left-0 pr-3 rtl:pr-0 rtl:pl-3 flex items-center pointer-events-none">
              <ChevronRight className="h-4 w-4 text-gray-400 rotate-90" />
            </div>
          </div>
        </div>
      </div>

      {/* Bulk Action Bar */}
      <AnimatePresence>
        {selectedProductIds.length > 0 && canManage && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-gray-900 text-white px-6 py-4 rounded-3xl shadow-2xl flex items-center space-x-6 rtl:space-x-reverse border border-white/10 backdrop-blur-md"
          >
            <div className="flex items-center space-x-2 rtl:space-x-reverse pr-6 rtl:pr-0 rtl:pl-6 border-r rtl:border-r-0 rtl:border-l border-white/20">
              <span className="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                {selectedProductIds.length}
              </span>
              <span className="text-sm font-medium">{t('products.selected')}</span>
            </div>
            
            <div className="flex items-center space-x-4 rtl:space-x-reverse">
              <button
                onClick={() => setShowBulkCategoryModal(true)}
                className="flex items-center space-x-2 rtl:space-x-reverse hover:text-blue-400 transition-colors text-sm font-medium"
              >
                <Tag className="h-4 w-4" />
                <span>{t('products.changeCategory')}</span>
              </button>
              
              <button
                onClick={handleBulkDelete}
                disabled={isBulkOperating}
                className="flex items-center space-x-2 rtl:space-x-reverse hover:text-red-400 transition-colors text-sm font-medium text-red-500"
              >
                <Trash2 className="h-4 w-4" />
                <span>{t('products.deleteSelected')}</span>
              </button>
            </div>
            
            <button
              onClick={() => setSelectedProductIds([])}
              className="p-1 hover:bg-white/10 rounded-full transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Product List */}
      <div className="bg-white shadow-sm rounded-2xl border border-gray-100 overflow-hidden">
        <div className="divide-y divide-gray-100">
          <AnimatePresence mode="wait">
            {filteredProducts.length > 0 ? (
              filteredProducts.map((product) => {
                const { isLowStock, isExpiring } = getAlertStatus(product);
                return (
                  <motion.div
                    key={product.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <div
                      onClick={() => handleProductClick(product)}
                      className={cn(
                        "w-full text-left rtl:text-right block hover:bg-gray-50 transition-colors px-6 py-5 group cursor-pointer",
                        linkingBarcode && "hover:bg-blue-50",
                        selectedProductIds.includes(product.id) && "bg-blue-50/50"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4 rtl:space-x-reverse">
                          {canManage && !linkingBarcode && (
                            <div 
                              onClick={(e) => toggleSelectProduct(product.id, e)}
                              className="p-1 hover:bg-gray-200 rounded-lg transition-colors"
                            >
                              {selectedProductIds.includes(product.id) ? (
                                <CheckSquare className="h-5 w-5 text-blue-600" />
                              ) : (
                                <Square className="h-5 w-5 text-gray-300" />
                              )}
                            </div>
                          )}
                          <div className={cn(
                            "w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 border border-gray-100",
                            isLowStock ? "bg-amber-100 text-amber-600" : 
                            isExpiring ? "bg-red-100 text-red-600" : 
                            linkingBarcode ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-600"
                          )}>
                            {product.imageUrl ? (
                              <img 
                                src={product.imageUrl} 
                                alt={product.name} 
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Package className="h-6 w-6" />
                              </div>
                            )}
                          </div>
                          <div>
                            <h3 className="text-base font-bold text-gray-900">{product.name}</h3>
                            <div className="flex items-center space-x-2 rtl:space-x-reverse">
                              <p className="text-sm text-gray-500">Barcode: {product.barcode}</p>
                              {product.category && (
                                <>
                                  <span className="text-gray-300">•</span>
                                  <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                                    {product.category}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center space-x-6 rtl:space-x-reverse">
                          <div className="hidden sm:flex flex-col items-end rtl:items-start">
                            <span className={cn(
                              "text-sm font-bold",
                              isLowStock ? "text-amber-600" : "text-gray-900"
                            )}>
                              {product.currentStock} {t('products.units')}
                            </span>
                            <span className="text-xs text-gray-400">{t('products.inStock')}</span>
                          </div>
                          
                          <div className="flex space-x-2 rtl:space-x-reverse">
                            {isLowStock && (
                              <div className="bg-amber-100 p-1.5 rounded-lg" title={t('products.lowStock')}>
                                <AlertTriangle className="h-4 w-4 text-amber-600" />
                              </div>
                            )}
                            {isExpiring && (
                              <div className="bg-red-100 p-1.5 rounded-lg" title={t('products.expiringSoon')}>
                                <Calendar className="h-4 w-4 text-red-600" />
                              </div>
                            )}
                          </div>
                          
                          {linkingBarcode ? (
                            <div className="bg-blue-100 text-blue-600 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                              {t('products.linkHere')}
                            </div>
                          ) : (
                            <div className="flex items-center space-x-2 rtl:space-x-reverse">
                              {canManage && (
                                <div className="flex items-center space-x-1 rtl:space-x-reverse">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate(`/products/edit/${product.id}`);
                                    }}
                                    className="p-2 text-gray-300 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                                    title={t('common.edit')}
                                  >
                                    <Edit2 className="h-5 w-5" />
                                  </button>
                                  <button
                                    onClick={(e) => handleDeleteProduct(product.id, e)}
                                    className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                                    title={t('common.delete')}
                                  >
                                    <Trash2 className="h-5 w-5" />
                                  </button>
                                </div>
                              )}
                              <ChevronRight className="h-5 w-5 text-gray-300 rtl:rotate-180" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })
            ) : (
              <div className="px-6 py-20 text-center">
                <div className="bg-gray-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Package className="h-10 w-10 text-gray-300" />
                </div>
                <h3 className="text-lg font-medium text-gray-900">{t('products.noProductsFound')}</h3>
                <p className="text-gray-500 mt-1">{t('products.noProductsSubtitle')}</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmLinkProduct && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-8 text-center space-y-6">
                {!isAdmin ? (
                  <div className="bg-amber-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                    <Lock className="h-8 w-8 text-amber-600" />
                  </div>
                ) : (
                  <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                    <LinkIcon className="h-8 w-8 text-blue-600" />
                  </div>
                )}
                
                <div>
                  <h3 className="text-xl font-bold text-gray-900">
                    {!canManage ? t('products.adminAccessRequired') : t('products.confirmLink')}
                  </h3>
                  {!isAdmin ? (
                    <div className="mt-4 space-y-3">
                      <p className="text-gray-600">
                        {t('products.adminAccessSubtitle')}
                      </p>
                      <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 flex items-start space-x-3 rtl:space-x-reverse text-left rtl:text-right">
                        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-800">
                          {t('products.adminAccessWarning')}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-gray-500 mt-2">
                        {t('products.confirmLinkSubtitle', { barcode: linkingBarcode })}
                      </p>
                      <p className="text-lg font-bold text-blue-600 mt-1">{confirmLinkProduct.name}</p>
                      <p className="text-xs text-gray-400 mt-2 italic">{t('products.confirmLinkNote')}</p>
                    </>
                  )}
                </div>

                {linkError && canManage && (
                  <div className="bg-red-50 p-3 rounded-xl text-red-600 text-xs font-medium">
                    {linkError}
                  </div>
                )}

                {linkSuccess && (
                  <div className="bg-green-50 p-3 rounded-xl text-green-600 text-xs font-medium flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                    {t('products.successfullyLinked')}
                  </div>
                )}

                <div className="space-y-3">
                  {!linkSuccess && (
                    <button
                      onClick={handleConfirmLink}
                      disabled={linking || !canManage}
                      className={cn(
                        "w-full py-4 font-bold rounded-2xl transition-all shadow-md disabled:opacity-50",
                        !canManage ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"
                      )}
                    >
                      {linking ? t('products.linking') : !canManage ? t('products.confirmLink') + " (" + t('products.adminAccessRequired') + ")" : t('products.confirmLink')}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setConfirmLinkProduct(null);
                      setLinkError(null);
                    }}
                    disabled={linking}
                    className="w-full py-4 bg-white border-2 border-gray-200 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all disabled:opacity-50"
                  >
                    {linkSuccess ? t('common.close') || 'Close' : t('common.cancel') || 'Cancel'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bulk Category Modal */}
      <AnimatePresence>
        {showBulkCategoryModal && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-8 space-y-6">
                <div className="text-center">
                  <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Tag className="h-8 w-8 text-blue-600" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">{t('products.changeCategory')}</h3>
                  <p className="text-gray-500 text-sm mt-2">
                    {t('products.selected')} {selectedProductIds.length} {t('products.title').toLowerCase()}.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                      {t('products.newCategory')}
                    </label>
                    <input
                      type="text"
                      list="bulk-categories"
                      value={bulkCategory}
                      onChange={(e) => setBulkCategory(e.target.value)}
                      placeholder={t('products.newCategory')}
                      className="w-full px-4 py-3 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all rtl:text-right"
                    />
                    <datalist id="bulk-categories">
                      {categories.filter(c => c !== 'All').map(cat => (
                        <option key={cat} value={cat} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={handleBulkCategoryUpdate}
                    disabled={isBulkOperating || !bulkCategory}
                    className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-md disabled:opacity-50"
                  >
                    {isBulkOperating ? t('products.updating') : t('products.updateCategory')}
                  </button>
                  <button
                    onClick={() => {
                      setShowBulkCategoryModal(false);
                      setBulkCategory('');
                    }}
                    disabled={isBulkOperating}
                    className="w-full py-4 bg-white border-2 border-gray-200 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all disabled:opacity-50"
                  >
                    {t('common.cancel') || 'Cancel'}
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
                    onClick={confirmDeleteProduct}
                    disabled={isBulkOperating}
                    className="w-full py-4 bg-red-600 text-white font-bold rounded-2xl hover:bg-red-700 transition-all shadow-md disabled:opacity-50"
                  >
                    {isBulkOperating ? t('common.loading') : t('common.delete')}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(null)}
                    disabled={isBulkOperating}
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

      {/* Bulk Delete Confirmation Modal */}
      <AnimatePresence>
        {showBulkDeleteConfirm && (
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
                  {t('products.bulkDeleteConfirm', { count: selectedProductIds.length })}
                </p>
                <div className="space-y-3">
                  <button
                    onClick={confirmBulkDelete}
                    disabled={isBulkOperating}
                    className="w-full py-4 bg-red-600 text-white font-bold rounded-2xl hover:bg-red-700 transition-all shadow-md disabled:opacity-50"
                  >
                    {isBulkOperating ? t('common.loading') : t('common.delete')}
                  </button>
                  <button
                    onClick={() => setShowBulkDeleteConfirm(false)}
                    disabled={isBulkOperating}
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

export default ProductList;
