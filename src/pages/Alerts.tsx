import React, { useEffect, useState, useCallback } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Product } from '../types';
import { AlertTriangle, Calendar, ChevronRight, Package, Search, Sparkles, Loader2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { differenceInDays } from 'date-fns';
import { cn, formatDate } from '../lib/utils';
import { GoogleGenAI } from "@google/genai";
import { doc, getDoc } from 'firebase/firestore';
import { SystemSettings } from '../types';
import { checkAndSendExpiryNotifications } from '../services/notificationService';
import { Bell, CheckCircle, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const Alerts: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.dir() === 'rtl';
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'low-stock';
  
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedSearchTerms, setExpandedSearchTerms] = useState<string[]>([]);
  const [isExpanding, setIsExpanding] = useState(false);
  const [testStatus, setTestStatus] = useState<{ success: boolean, message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

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

    return () => unsubscribe();
  }, []);

  // Search Grounding logic
  const expandSearch = useCallback(async (term: string) => {
    if (!term || term.length < 2) {
      setExpandedSearchTerms([]);
      return;
    }

    setIsExpanding(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `The user is searching for "${term}" in their inventory. Based on web search, what are some specific brands, synonyms, or related product names for "${term}" that might be in an inventory? Return them as a simple comma-separated list of strings. For example, if the user searches for "cola", you might return "Coca-Cola, Pepsi, Soda, Soft Drink".`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const text = response.text || "";
      const terms = text.split(',').map(t => t.trim()).filter(t => t.length > 0);
      setExpandedSearchTerms(terms);
    } catch (error) {
      console.error("Search grounding error:", error);
    } finally {
      setIsExpanding(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchTerm) {
        expandSearch(searchTerm);
      } else {
        setExpandedSearchTerms([]);
      }
    }, 600); // Debounce search grounding

    return () => clearTimeout(timer);
  }, [searchTerm, expandSearch]);

  const filterProducts = (p: Product) => {
    const lowerName = p.name.toLowerCase();
    const lowerBarcode = p.barcode.toLowerCase();
    const lowerSearch = searchTerm.toLowerCase();
    
    const matchesDirectSearch = lowerName.includes(lowerSearch) || 
                               lowerBarcode.includes(lowerSearch) ||
                               (p.barcodes || []).some(bc => bc.toLowerCase().includes(lowerSearch));
                               
    const matchesExpandedSearch = expandedSearchTerms.some(term => 
      lowerName.includes(term.toLowerCase())
    );

    return matchesDirectSearch || matchesExpandedSearch;
  };

  const lowStockAlerts = products.filter(p => {
    return filterProducts(p) && p.currentStock <= (p.lowStockThreshold || 0);
  });
  
  const expiryAlerts = products.filter(p => {
    if (!p.expiryDate) return false;
    const daysRemaining = differenceInDays(safeToDate(p.expiryDate), new Date());
    return filterProducts(p) && daysRemaining <= (p.expiryAlertThreshold || 0);
  });

  const currentAlerts = activeTab === 'low-stock' ? lowStockAlerts : expiryAlerts;

  const tabs = [
    { id: 'low-stock', name: t('alerts.lowStock'), count: lowStockAlerts.length, icon: AlertTriangle },
    { id: 'expiry', name: t('alerts.expiryDate'), count: expiryAlerts.length, icon: Calendar },
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
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">{t('alerts.title')}</h1>
          <p className="text-gray-500 mt-1">{t('alerts.subtitle')}</p>
        </div>
        <div className="flex items-center space-x-3 rtl:space-x-reverse">
          <button
            onClick={async () => {
              setIsTesting(true);
              setTestStatus(null);
              const result = await checkAndSendExpiryNotifications(true);
              setTestStatus(result);
              setIsTesting(false);
              setTimeout(() => setTestStatus(null), 5000);
            }}
            disabled={isTesting}
            className="inline-flex items-center px-4 py-2.5 border border-blue-600 text-sm font-medium rounded-xl text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-50"
          >
            <Bell className={cn(isRTL ? "ml-2" : "mr-2", "h-5 w-5", isTesting && "animate-bounce")} />
            {isTesting ? t('alerts.testing') : t('alerts.testAlerts')}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {testStatus && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={cn(
              "p-4 rounded-xl flex items-center space-x-3 rtl:space-x-reverse",
              testStatus.success ? "bg-green-50 text-green-700 border border-green-100" : "bg-red-50 text-red-700 border border-red-100"
            )}
          >
            {testStatus.success ? <CheckCircle className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
            <span className="text-sm font-medium">{testStatus.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs and Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex p-1 bg-gray-100 rounded-2xl w-full max-w-md">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSearchParams({ tab: tab.id })}
              className={cn(
                "flex-1 flex items-center justify-center space-x-2 rtl:space-x-reverse py-2.5 text-sm font-bold rounded-xl transition-all",
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
          <div className={cn("absolute inset-y-0 flex items-center pointer-events-none", isRTL ? "right-0 pr-3" : "left-0 pl-3")}>
            {isExpanding ? (
              <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
            ) : (
              <Search className="h-4 w-4 text-gray-400" />
            )}
          </div>
          <input
            type="text"
            placeholder={t('alerts.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={cn(
              "block w-full py-2.5 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all bg-white shadow-sm",
              isRTL ? "pr-10 pl-10" : "pl-10 pr-10"
            )}
          />
          {expandedSearchTerms.length > 0 && !isExpanding && (
            <div className={cn("absolute inset-y-0 flex items-center pointer-events-none", isRTL ? "left-0 pl-3" : "right-0 pr-3")}>
              <Sparkles className="h-4 w-4 text-blue-400 animate-pulse" />
            </div>
          )}
        </div>
      </div>

      {expandedSearchTerms.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center mr-1 rtl:mr-0 rtl:ml-1">
            <Sparkles className={cn("h-3 w-3 text-blue-400", isRTL ? "ml-1" : "mr-1")} />
            {t('alerts.aiSuggestions')}
          </span>
          {expandedSearchTerms.slice(0, 5).map((term, idx) => (
            <span 
              key={idx}
              className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-full border border-blue-100"
            >
              {term}
            </span>
          ))}
        </div>
      )}

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
                        <div className="flex items-center space-x-4 rtl:space-x-reverse">
                          <div className="bg-amber-100 p-3 rounded-xl">
                            <AlertTriangle className="h-6 w-6 text-amber-600" />
                          </div>
                          <div className="text-left rtl:text-right">
                            <p className="text-base font-bold text-gray-900">{product.name}</p>
                            <p className="text-sm text-gray-500">{t('dashboard.barcode', { barcode: product.barcode })}</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-6 rtl:space-x-reverse">
                          <div className="text-right rtl:text-left">
                            <p className="text-lg font-bold text-amber-600">{t('alerts.units', { count: product.currentStock })}</p>
                            <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">{t('alerts.threshold', { count: product.lowStockThreshold })}</p>
                          </div>
                          <ChevronRight className="h-5 w-5 text-gray-300 rtl:rotate-180" />
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                ))
              ) : (
                <EmptyState 
                  icon={AlertTriangle} 
                  message={searchTerm ? t('alerts.noLowStockMatch', { term: searchTerm }) : t('alerts.noLowStock')} 
                  isSearch={!!searchTerm}
                  t={t}
                />
              )
            ) : (
              expiryAlerts.length > 0 ? (
                expiryAlerts.map((product) => {
                  const daysLeft = product.expiryDate ? differenceInDays(safeToDate(product.expiryDate), new Date()) : 0;
                  return (
                    <motion.div
                      key={product.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                    >
                      <Link to={`/products/${product.id}`} className="block px-6 py-5 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4 rtl:space-x-reverse">
                            <div className="bg-red-100 p-3 rounded-xl">
                              <Calendar className="h-6 w-6 text-red-600" />
                            </div>
                            <div className="text-left rtl:text-right">
                              <p className="text-base font-bold text-gray-900">{product.name}</p>
                              <p className="text-sm text-gray-500">{t('dashboard.barcode', { barcode: product.barcode })}</p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-6 rtl:space-x-reverse">
                            <div className="text-right rtl:text-left">
                              <p className="text-lg font-bold text-red-600">
                                {product.expiryDate ? formatDate(safeToDate(product.expiryDate)) : 'N/A'}
                              </p>
                              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">
                                {daysLeft < 0 ? t('alerts.expired') : t('alerts.daysRemaining', { count: daysLeft })}
                              </p>
                            </div>
                            <ChevronRight className="h-5 w-5 text-gray-300 rtl:rotate-180" />
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  );
                })
              ) : (
                <EmptyState 
                  icon={Calendar} 
                  message={searchTerm ? t('alerts.noExpiryMatch', { term: searchTerm }) : t('alerts.noExpiry')} 
                  isSearch={!!searchTerm}
                  t={t}
                />
              )
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

const EmptyState: React.FC<{ icon: any, message: string, isSearch?: boolean, t: any }> = ({ icon: Icon, message, isSearch, t }) => (
  <div className="px-6 py-20 text-center">
    <div className="bg-gray-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
      <Icon className="h-10 w-10 text-gray-300" />
    </div>
    <h3 className="text-lg font-medium text-gray-900">{message}</h3>
    {isSearch ? (
      <div className="mt-4 space-y-2">
        <p className="text-gray-500 text-sm">{t('alerts.searchTip')}</p>
        <p className="text-xs text-blue-500 font-medium">{t('alerts.aiTip')}</p>
      </div>
    ) : (
      <p className="text-gray-500 mt-1">{t('alerts.emptySubtitle')}</p>
    )}
  </div>
);

export default Alerts;
