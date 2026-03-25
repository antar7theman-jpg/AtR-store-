import React, { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Product } from '../types';
import { AlertTriangle, Calendar, ChevronRight, Package, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { differenceInDays } from 'date-fns';
import { cn, formatDate } from '../lib/utils';

const Alerts: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'low-stock';
  
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const path = 'products';
    const unsubscribe = onSnapshot(collection(db, path), (snapshot) => {
      const productList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      setProducts(productList);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribe();
  }, []);

  const lowStockAlerts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         p.barcode.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (p.barcodes || []).some(bc => bc.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesSearch && p.currentStock <= (p.lowStockThreshold || 0);
  });
  
  const expiryAlerts = products.filter(p => {
    if (!p.expiryDate) return false;
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         p.barcode.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (p.barcodes || []).some(bc => bc.toLowerCase().includes(searchTerm.toLowerCase()));
    const daysRemaining = differenceInDays(p.expiryDate.toDate(), new Date());
    return matchesSearch && daysRemaining <= (p.expiryAlertThreshold || 0);
  });

  const tabs = [
    { id: 'low-stock', name: 'Low Stock', count: lowStockAlerts.length, icon: AlertTriangle },
    { id: 'expiry', name: 'Expiry Date', count: expiryAlerts.length, icon: Calendar },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Alerts</h1>
        <p className="text-gray-500 mt-1">Inventory items requiring attention</p>
      </div>

      {/* Tabs and Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex p-1 bg-gray-100 rounded-2xl w-full max-w-md">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSearchParams({ tab: tab.id })}
              className={cn(
                "flex-1 flex items-center justify-center space-x-2 py-2.5 text-sm font-bold rounded-xl transition-all",
                activeTab === tab.id
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              <tab.icon className="h-4 w-4" />
              <span>{tab.name}</span>
              {tab.count > 0 && (
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px]",
                  activeTab === tab.id ? "bg-blue-100 text-blue-600" : "bg-gray-200 text-gray-600"
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="relative w-full md:max-w-xs">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="text"
            placeholder="Search alerts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all bg-white shadow-sm"
          />
        </div>
      </div>

      {/* Alert List */}
      <div className="bg-white shadow-sm rounded-2xl border border-gray-100 overflow-hidden">
        <div className="divide-y divide-gray-100">
          <AnimatePresence mode="wait">
            {activeTab === 'low-stock' ? (
              lowStockAlerts.length > 0 ? (
                lowStockAlerts.map((product) => (
                  <motion.div
                    key={product.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                  >
                    <Link to={`/products/${product.id}`} className="block px-6 py-5 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <div className="bg-amber-100 p-3 rounded-xl">
                            <AlertTriangle className="h-6 w-6 text-amber-600" />
                          </div>
                          <div>
                            <p className="text-base font-bold text-gray-900">{product.name}</p>
                            <p className="text-sm text-gray-500">Barcode: {product.barcode}</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-6">
                          <div className="text-right">
                            <p className="text-lg font-bold text-amber-600">{product.currentStock} units</p>
                            <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">Threshold: {product.lowStockThreshold}</p>
                          </div>
                          <ChevronRight className="h-5 w-5 text-gray-300" />
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                ))
              ) : (
                <EmptyState 
                  icon={AlertTriangle} 
                  message={searchTerm ? `No low stock alerts matching "${searchTerm}"` : "No low stock alerts"} 
                />
              )
            ) : (
              expiryAlerts.length > 0 ? (
                expiryAlerts.map((product) => {
                  const daysLeft = product.expiryDate ? differenceInDays(product.expiryDate.toDate(), new Date()) : 0;
                  return (
                    <motion.div
                      key={product.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                    >
                      <Link to={`/products/${product.id}`} className="block px-6 py-5 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <div className="bg-red-100 p-3 rounded-xl">
                              <Calendar className="h-6 w-6 text-red-600" />
                            </div>
                            <div>
                              <p className="text-base font-bold text-gray-900">{product.name}</p>
                              <p className="text-sm text-gray-500">Barcode: {product.barcode}</p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-6">
                            <div className="text-right">
                              <p className="text-lg font-bold text-red-600">
                                {product.expiryDate ? formatDate(product.expiryDate.toDate()) : 'N/A'}
                              </p>
                              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">
                                {daysLeft < 0 ? 'Expired' : `${daysLeft} days remaining`}
                              </p>
                            </div>
                            <ChevronRight className="h-5 w-5 text-gray-300" />
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  );
                })
              ) : (
                <EmptyState 
                  icon={Calendar} 
                  message={searchTerm ? `No expiry alerts matching "${searchTerm}"` : "No expiry date alerts"} 
                />
              )
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

const EmptyState: React.FC<{ icon: any, message: string }> = ({ icon: Icon, message }) => (
  <div className="px-6 py-20 text-center">
    <div className="bg-gray-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
      <Icon className="h-10 w-10 text-gray-300" />
    </div>
    <h3 className="text-lg font-medium text-gray-900">{message}</h3>
    <p className="text-gray-500 mt-1">Everything looks good for now.</p>
  </div>
);

export default Alerts;
