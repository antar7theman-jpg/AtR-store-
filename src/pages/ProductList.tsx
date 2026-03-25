import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy, doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Product } from '../types';
import { Search, Plus, Package, AlertTriangle, Calendar, ChevronRight, Link as LinkIcon, X, CheckCircle, Lock } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthGuard';
import { motion, AnimatePresence } from 'motion/react';
import { differenceInDays } from 'date-fns';
import { cn } from '../lib/utils';

const ProductList: React.FC = () => {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [linkingBarcode, setLinkingBarcode] = useState<string | null>(null);
  const [confirmLinkProduct, setConfirmLinkProduct] = useState<Product | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState(false);

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

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.barcode.includes(searchTerm) ||
    (p.barcodes && p.barcodes.some(bc => bc.includes(searchTerm)))
  );

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
        setLinkError("Permission denied. Only admins can link barcodes.");
      } else {
        setLinkError("Failed to link barcode. Please try again.");
      }
    } finally {
      setLinking(false);
    }
  };

  const handleProductClick = (product: Product) => {
    if (linkingBarcode) {
      if (!isAdmin) {
        setLinkError("Only admins can link barcodes.");
        // We still show the modal but with an error and disabled confirm
        setConfirmLinkProduct(product);
        return;
      }
      setConfirmLinkProduct(product);
    } else {
      navigate(`/products/${product.id}`);
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
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Products</h1>
          <p className="text-gray-500 mt-1">Manage your inventory items</p>
        </div>
        {isAdmin && (
          <Link
            to="/products/add"
            className="inline-flex items-center justify-center px-4 py-2.5 border border-transparent text-sm font-medium rounded-xl shadow-sm text-white bg-blue-600 hover:bg-blue-700 transition-all"
          >
            <Plus className="mr-2 h-5 w-5" />
            Add Product
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
            <div className="flex items-center space-x-3">
              <div className="bg-white/20 p-2 rounded-lg">
                <LinkIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-bold">Linking Barcode: {linkingBarcode}</p>
                <p className="text-xs text-blue-100">Select a product below to associate this barcode with it.</p>
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

      {/* Search Bar */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-gray-400" />
        </div>
        <input
          type="text"
          placeholder="Search by name or barcode..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-2xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-all"
        />
      </div>

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
                    <button
                      onClick={() => handleProductClick(product)}
                      className={cn(
                        "w-full text-left block hover:bg-gray-50 transition-colors px-6 py-5",
                        linkingBarcode && "hover:bg-blue-50"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <div className={cn(
                            "p-3 rounded-xl",
                            isLowStock ? "bg-amber-100 text-amber-600" : 
                            isExpiring ? "bg-red-100 text-red-600" : 
                            linkingBarcode ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-600"
                          )}>
                            <Package className="h-6 w-6" />
                          </div>
                          <div>
                            <h3 className="text-base font-bold text-gray-900">{product.name}</h3>
                            <p className="text-sm text-gray-500">Barcode: {product.barcode}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center space-x-6">
                          <div className="hidden sm:flex flex-col items-end">
                            <span className={cn(
                              "text-sm font-bold",
                              isLowStock ? "text-amber-600" : "text-gray-900"
                            )}>
                              {product.currentStock} units
                            </span>
                            <span className="text-xs text-gray-400">In Stock</span>
                          </div>
                          
                          <div className="flex space-x-2">
                            {isLowStock && (
                              <div className="bg-amber-100 p-1.5 rounded-lg" title="Low Stock">
                                <AlertTriangle className="h-4 w-4 text-amber-600" />
                              </div>
                            )}
                            {isExpiring && (
                              <div className="bg-red-100 p-1.5 rounded-lg" title="Expiring Soon">
                                <Calendar className="h-4 w-4 text-red-600" />
                              </div>
                            )}
                          </div>
                          
                          {linkingBarcode ? (
                            <div className="bg-blue-100 text-blue-600 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                              Link Here
                            </div>
                          ) : (
                            <ChevronRight className="h-5 w-5 text-gray-300" />
                          )}
                        </div>
                      </div>
                    </button>
                  </motion.div>
                );
              })
            ) : (
              <div className="px-6 py-20 text-center">
                <div className="bg-gray-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Package className="h-10 w-10 text-gray-300" />
                </div>
                <h3 className="text-lg font-medium text-gray-900">No products found</h3>
                <p className="text-gray-500 mt-1">Try adjusting your search or add a new product.</p>
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
                    {!isAdmin ? "Admin Access Required" : "Link Barcode?"}
                  </h3>
                  {!isAdmin ? (
                    <div className="mt-4 space-y-3">
                      <p className="text-gray-600">
                        Only administrators can link new barcodes to products. Please contact your manager to perform this action.
                      </p>
                      <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 flex items-start space-x-3 text-left">
                        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-800">
                          You are currently logged in as a standard user. Barcode linking is restricted to maintain inventory integrity.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-gray-500 mt-2">
                        Are you sure you want to link barcode <span className="font-mono font-bold text-gray-900">{linkingBarcode}</span> to:
                      </p>
                      <p className="text-lg font-bold text-blue-600 mt-1">{confirmLinkProduct.name}</p>
                      <p className="text-xs text-gray-400 mt-2 italic">This will add the barcode to the product's list of associated barcodes.</p>
                    </>
                  )}
                </div>

                {linkError && isAdmin && (
                  <div className="bg-red-50 p-3 rounded-xl text-red-600 text-xs font-medium">
                    {linkError}
                  </div>
                )}

                {linkSuccess && (
                  <div className="bg-green-50 p-3 rounded-xl text-green-600 text-xs font-medium flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Successfully linked!
                  </div>
                )}

                <div className="space-y-3">
                  {!linkSuccess && (
                    <button
                      onClick={handleConfirmLink}
                      disabled={linking || !isAdmin}
                      className={cn(
                        "w-full py-4 font-bold rounded-2xl transition-all shadow-md disabled:opacity-50",
                        !isAdmin ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"
                      )}
                    >
                      {linking ? "Linking..." : !isAdmin ? "Confirm Link (Admin Only)" : "Confirm Link"}
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
                    {linkSuccess ? "Close" : "Cancel"}
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
