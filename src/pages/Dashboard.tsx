import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, orderBy, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Product, Task, UserProfile } from '../types';
import { useAuth } from '../components/AuthGuard';
import { checkAndSendExpiryNotifications } from '../services/notificationService';
import { Package, AlertTriangle, Calendar, ScanLine, ArrowRight, CheckSquare, Clock, AlertCircle, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { differenceInDays } from 'date-fns';
import { cn, formatDate } from '../lib/utils';

import { useTranslation } from 'react-i18next';

const Dashboard: React.FC = () => {
  const { profile, isAdmin } = useAuth();
  const { t } = useTranslation();
  const [products, setProducts] = useState<Product[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // Helper to safely convert Firestore timestamp to Date
  const safeToDate = (timestamp: any) => {
    if (!timestamp || typeof timestamp.toDate !== 'function') return new Date();
    return timestamp.toDate();
  };

  useEffect(() => {
    const path = 'products';
    const unsubscribe = onSnapshot(collection(db, path), (snapshot) => {
      const productList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      setProducts(productList);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    const usersPath = 'users';
    const unsubscribeUsers = onSnapshot(collection(db, usersPath), (snapshot) => {
      const userList = snapshot.docs.map(doc => ({ 
        uid: doc.id, 
        ...doc.data() 
      } as UserProfile));
      setUsers(userList);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, usersPath);
    });

    return () => {
      unsubscribe();
      unsubscribeUsers();
    };
  }, []);

  useEffect(() => {
    const path = 'tasks';
    const q = query(
      collection(db, path), 
      where('completed', '==', false),
      orderBy('priority', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(5)
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const taskList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
      setTasks(taskList);
    }, (error) => {
      // Handle potential index error gracefully
      if (error instanceof Error && error.message.includes('FAILED_PRECONDITION')) {
        console.warn("Tasks index not ready yet. Falling back to simple query.");
        const fallbackQ = query(collection(db, path), where('completed', '==', false), limit(5));
        onSnapshot(fallbackQ, (s) => {
          setTasks(s.docs.map(d => ({ id: d.id, ...d.data() } as Task)));
        });
      } else {
        handleFirestoreError(error, OperationType.GET, path);
      }
    });

    return () => unsubscribe();
  }, []);

  // Automatic expiry check removed as requested
  /*
  useEffect(() => {
    // Automated check on mount (will skip if checked in last 24h)
    // Now allowed for all authenticated users since rules permit updating lastNotificationCheck
    checkAndSendExpiryNotifications();
  }, []);
  */

  const lowStockProducts = products.filter(p => p.currentStock <= (p.lowStockThreshold || 0));
  
  const expiryAlertProducts = products.filter(p => {
    if (!p.expiryDate) return false;
    const daysRemaining = differenceInDays(safeToDate(p.expiryDate), new Date());
    return daysRemaining <= (p.expiryAlertThreshold || 0);
  });

  const stats = [
    { 
      name: t('dashboard.totalProducts'), 
      value: products.length, 
      icon: Package, 
      color: 'bg-blue-500', 
      textColor: 'text-blue-600',
      link: '/products'
    },
    { 
      name: t('dashboard.lowStockAlerts'), 
      value: lowStockProducts.length, 
      icon: AlertTriangle, 
      color: 'bg-amber-500', 
      textColor: 'text-amber-600',
      link: '/alerts?tab=low-stock'
    },
    { 
      name: t('dashboard.expiryAlerts'), 
      value: expiryAlertProducts.length, 
      icon: Calendar, 
      color: 'bg-red-500', 
      textColor: 'text-red-600',
      link: '/alerts?tab=expiry'
    },
    { 
      name: t('dashboard.pendingTasks'), 
      value: tasks.length, 
      icon: CheckSquare, 
      color: 'bg-indigo-500', 
      textColor: 'text-indigo-600',
      link: '/tasks'
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
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">{t('nav.dashboard')}</h1>
          <p className="text-gray-500 mt-1">{t('dashboard.welcome', { name: profile?.name })}</p>
        </div>
        <Link
          to="/scan"
          className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-xl shadow-sm text-white bg-blue-600 hover:bg-blue-700 transition-all transform hover:scale-105 active:scale-95"
        >
          <ScanLine className="mr-2 h-5 w-5 rtl:mr-0 rtl:ml-2" />
          {t('dashboard.quickScan')}
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
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
                <div className="ml-5 rtl:ml-0 rtl:mr-5 w-0 flex-1">
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
                <ArrowRight className="h-5 w-5 text-gray-300 rtl:rotate-180" />
              </div>
            </Link>
          </motion.div>
        ))}
      </div>

      {/* Pending Tasks Section */}
      <div className="bg-white shadow-sm rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center">
          <div className="flex items-center space-x-2 rtl:space-x-reverse">
            <CheckSquare className="h-5 w-5 text-indigo-600" />
            <h3 className="text-lg font-bold text-gray-900">{t('dashboard.priorityTasks')}</h3>
          </div>
          <Link to="/tasks" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">{t('dashboard.viewAll')}</Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
          {tasks.length > 0 ? (
            tasks.map((task) => (
              <Link 
                key={task.id} 
                to="/tasks" 
                className="flex flex-col p-4 rounded-xl border border-gray-100 bg-gray-50 hover:bg-white hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between mb-2">
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                    task.priority === 'high' ? "text-red-600 bg-red-50 border-red-100" :
                    task.priority === 'medium' ? "text-amber-600 bg-amber-50 border-amber-100" :
                    "text-blue-600 bg-blue-50 border-blue-100"
                  )}>
                    {t(`dashboard.priority.${task.priority}`)}
                  </span>
                  <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-indigo-500 transition-colors rtl:rotate-180" />
                </div>
                <h4 className="text-sm font-bold text-gray-900 line-clamp-1">{task.title}</h4>
                {task.description && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-1">{task.description}</p>
                )}
                <div className="mt-3 flex items-center justify-between text-[10px] text-gray-400 font-medium">
                  <div className="flex items-center">
                    <Clock className="h-3 w-3 mr-1 rtl:mr-0 rtl:ml-1" />
                    {task.createdAt ? formatDate(task.createdAt.toDate()) : 'Pending...'}
                  </div>
                  {task.assignedTo && (
                    <div className="flex items-center text-indigo-600">
                      <User className="h-3 w-3 mr-1 rtl:mr-0 rtl:ml-1" />
                      {users.find(u => u.uid === task.assignedTo)?.name || 'Assigned'}
                    </div>
                  )}
                </div>
              </Link>
            ))
          ) : (
            <div className="col-span-full py-8 text-center">
              <CheckSquare className="mx-auto h-10 w-10 text-gray-200" />
              <p className="mt-2 text-sm text-gray-500">{t('dashboard.noPendingTasks')}</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Low Stock */}
        <div className="bg-white shadow-sm rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-900">{t('dashboard.criticalStock')}</h3>
            <Link to="/alerts?tab=low-stock" className="text-sm font-medium text-blue-600 hover:text-blue-500">{t('dashboard.viewAll')}</Link>
          </div>
          <div className="divide-y divide-gray-100">
            {lowStockProducts.length > 0 ? (
              lowStockProducts.slice(0, 5).map((product) => (
                <Link key={product.id} to={`/products/${product.id}`} className="block px-6 py-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{product.name}</p>
                      <p className="text-xs text-gray-500">{t('dashboard.barcode', { barcode: product.barcode })}</p>
                    </div>
                    <div className="text-right rtl:text-left">
                      <p className="text-sm font-bold text-amber-600">{t('dashboard.units', { count: product.currentStock })}</p>
                      <p className="text-xs text-gray-400">{t('dashboard.threshold', { count: product.lowStockThreshold })}</p>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="px-6 py-12 text-center">
                <Package className="mx-auto h-12 w-12 text-gray-200" />
                <p className="mt-2 text-sm text-gray-500">{t('dashboard.allStockHealthy')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Expiry */}
        <div className="bg-white shadow-sm rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-900">{t('dashboard.expiringSoon')}</h3>
            <Link to="/alerts?tab=expiry" className="text-sm font-medium text-blue-600 hover:text-blue-500">{t('dashboard.viewAll')}</Link>
          </div>
          <div className="divide-y divide-gray-100">
            {expiryAlertProducts.length > 0 ? (
              expiryAlertProducts.slice(0, 5).map((product) => (
                <Link key={product.id} to={`/products/${product.id}`} className="block px-6 py-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{product.name}</p>
                      <p className="text-xs text-gray-500">{t('dashboard.barcode', { barcode: product.barcode })}</p>
                    </div>
                    <div className="text-right rtl:text-left">
                      <p className="text-sm font-bold text-red-600">
                        {product.expiryDate ? formatDate(safeToDate(product.expiryDate)) : 'N/A'}
                      </p>
                      <p className="text-xs text-gray-400">
                        {product.expiryDate ? t('dashboard.daysLeft', { count: differenceInDays(safeToDate(product.expiryDate), new Date()) }) : ''}
                      </p>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="px-6 py-12 text-center">
                <Calendar className="mx-auto h-12 w-12 text-gray-200" />
                <p className="mt-2 text-sm text-gray-500">{t('dashboard.noUpcomingExpiries')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
