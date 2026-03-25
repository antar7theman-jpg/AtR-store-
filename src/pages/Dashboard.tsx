import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Product } from '../types';
import { Package, AlertTriangle, Calendar, ScanLine, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { differenceInDays } from 'date-fns';
import { cn, formatDate } from '../lib/utils';

const Dashboard: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

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

  const lowStockProducts = products.filter(p => p.currentStock <= (p.lowStockThreshold || 0));
  
  const expiryAlertProducts = products.filter(p => {
    if (!p.expiryDate) return false;
    const daysRemaining = differenceInDays(p.expiryDate.toDate(), new Date());
    return daysRemaining <= (p.expiryAlertThreshold || 0);
  });

  const stats = [
    { 
      name: 'Total Products', 
      value: products.length, 
      icon: Package, 
      color: 'bg-blue-500', 
      textColor: 'text-blue-600',
      link: '/products'
    },
    { 
      name: 'Low Stock Alerts', 
      value: lowStockProducts.length, 
      icon: AlertTriangle, 
      color: 'bg-amber-500', 
      textColor: 'text-amber-600',
      link: '/alerts?tab=low-stock'
    },
    { 
      name: 'Expiry Alerts', 
      value: expiryAlertProducts.length, 
      icon: Calendar, 
      color: 'bg-red-500', 
      textColor: 'text-red-600',
      link: '/alerts?tab=expiry'
    },
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
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Dashboard</h1>
          <p className="text-gray-500 mt-1">Overview of your store inventory</p>
        </div>
        <Link
          to="/scan"
          className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-xl shadow-sm text-white bg-blue-600 hover:bg-blue-700 transition-all transform hover:scale-105 active:scale-95"
        >
          <ScanLine className="mr-2 h-5 w-5" />
          Quick Scan
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat, idx) => (
          <motion.div
            key={stat.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="bg-white overflow-hidden shadow-sm rounded-2xl border border-gray-100 hover:shadow-md transition-shadow"
          >
            <Link to={stat.link} className="block p-6">
              <div className="flex items-center">
                <div className={cn("flex-shrink-0 p-3 rounded-xl", stat.color)}>
                  <stat.icon className="h-6 w-6 text-white" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      {stat.name}
                    </dt>
                    <dd className="flex items-baseline">
                      <div className="text-2xl font-bold text-gray-900">
                        {stat.value}
                      </div>
                    </dd>
                  </dl>
                </div>
                <ArrowRight className="h-5 w-5 text-gray-300" />
              </div>
            </Link>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Low Stock */}
        <div className="bg-white shadow-sm rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-900">Critical Stock</h3>
            <Link to="/alerts?tab=low-stock" className="text-sm font-medium text-blue-600 hover:text-blue-500">View all</Link>
          </div>
          <div className="divide-y divide-gray-100">
            {lowStockProducts.length > 0 ? (
              lowStockProducts.slice(0, 5).map((product) => (
                <Link key={product.id} to={`/products/${product.id}`} className="block px-6 py-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{product.name}</p>
                      <p className="text-xs text-gray-500">Barcode: {product.barcode}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-amber-600">{product.currentStock} units</p>
                      <p className="text-xs text-gray-400">Threshold: {product.lowStockThreshold}</p>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="px-6 py-12 text-center">
                <Package className="mx-auto h-12 w-12 text-gray-200" />
                <p className="mt-2 text-sm text-gray-500">All stock levels are healthy</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Expiry */}
        <div className="bg-white shadow-sm rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-900">Expiring Soon</h3>
            <Link to="/alerts?tab=expiry" className="text-sm font-medium text-blue-600 hover:text-blue-500">View all</Link>
          </div>
          <div className="divide-y divide-gray-100">
            {expiryAlertProducts.length > 0 ? (
              expiryAlertProducts.slice(0, 5).map((product) => (
                <Link key={product.id} to={`/products/${product.id}`} className="block px-6 py-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{product.name}</p>
                      <p className="text-xs text-gray-500">Barcode: {product.barcode}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-red-600">
                        {product.expiryDate ? formatDate(product.expiryDate.toDate()) : 'N/A'}
                      </p>
                      <p className="text-xs text-gray-400">
                        {product.expiryDate ? `${differenceInDays(product.expiryDate.toDate(), new Date())} days left` : ''}
                      </p>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="px-6 py-12 text-center">
                <Calendar className="mx-auto h-12 w-12 text-gray-200" />
                <p className="mt-2 text-sm text-gray-500">No upcoming expiries</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;

function formatDateHelper(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}
