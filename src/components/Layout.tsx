import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Package, Bell, Settings, LogOut, Menu, X, ScanLine, CheckSquare, Languages } from 'lucide-react';
import { Toaster } from 'sonner';
import { useAuth } from './AuthGuard';
import { auth } from '../firebase';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import OfflineStatus from './OfflineStatus';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, isAdmin, isStaff } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const { t, i18n } = useTranslation();

  const navItems = [
    { name: t('nav.dashboard'), path: '/', icon: LayoutDashboard },
    { name: t('nav.products'), path: '/products', icon: Package },
    { name: t('nav.alerts'), path: '/alerts', icon: Bell },
    { name: t('nav.tasks'), path: '/tasks', icon: CheckSquare },
  ];

  if (isAdmin || isStaff) {
    navItems.push({ name: t('nav.settings'), path: '/settings', icon: Settings });
  }

  const handleLogout = async () => {
    await auth.signOut();
    navigate('/login');
  };

  const toggleLanguage = () => {
    const langs = ['en', 'ar', 'fr'];
    const currentIdx = langs.indexOf(i18n.language.split('-')[0]);
    const nextIdx = (currentIdx + 1) % langs.length;
    i18n.changeLanguage(langs[nextIdx]);
  };

  const currentLang = i18n.language.split('-')[0];
  const langNames: Record<string, string> = {
    en: 'EN',
    ar: 'AR',
    fr: 'FR'
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
      <OfflineStatus />
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center">
              <Link to="/" className="flex items-center space-x-2 rtl:space-x-reverse">
                <div className="bg-blue-600 p-1.5 rounded-lg">
                  <Package className="h-6 w-6 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xl font-bold text-gray-900 tracking-tight leading-none">ATR Store</span>
                  <span className="text-[10px] text-gray-400 font-medium self-end -mt-0.5">by antar</span>
                </div>
              </Link>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex space-x-8 rtl:space-x-reverse">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center space-x-1 rtl:space-x-reverse px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    location.pathname === item.path
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.name}</span>
                </Link>
              ))}
            </nav>

            <div className="hidden md:flex items-center space-x-4 rtl:space-x-reverse">
              <button
                onClick={toggleLanguage}
                className="flex items-center space-x-1 px-2 py-1 rounded-md text-xs font-bold text-gray-500 hover:bg-gray-100 transition-colors"
                title="Change Language"
              >
                <Languages className="h-4 w-4" />
                <span>{langNames[currentLang] || currentLang.toUpperCase()}</span>
              </button>
              <div className="text-right rtl:text-left mr-4 rtl:mr-0 rtl:ml-4">
                <div className="text-sm font-medium text-gray-900">{profile?.name}</div>
                <div className="text-xs text-gray-500 capitalize">{profile?.role}</div>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                title={t('nav.logout')}
              >
                <LogOut className="h-5 w-5 rtl:rotate-180" />
              </button>
            </div>

            {/* Mobile menu button */}
            <div className="md:hidden flex items-center space-x-2 rtl:space-x-reverse">
              <button
                onClick={toggleLanguage}
                className="p-2 text-gray-500 hover:bg-gray-100 rounded-md"
              >
                <Languages className="h-5 w-5" />
              </button>
              <Link 
                to="/scan" 
                className="p-2 bg-blue-600 text-white rounded-full shadow-lg"
              >
                <ScanLine className="h-5 w-5" />
              </Link>
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none"
              >
                {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        <AnimatePresence>
          {isMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden bg-white border-b border-gray-200 overflow-hidden"
            >
              <div className="px-2 pt-2 pb-3 space-y-1">
                {navItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setIsMenuOpen(false)}
                    className={cn(
                      "flex items-center space-x-3 rtl:space-x-reverse px-3 py-3 rounded-md text-base font-medium",
                      location.pathname === item.path
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    )}
                  >
                    <item.icon className="h-5 w-5" />
                    <span>{item.name}</span>
                  </Link>
                ))}
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center space-x-3 rtl:space-x-reverse px-3 py-3 rounded-md text-base font-medium text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-5 w-5 rtl:rotate-180" />
                  <span>{t('nav.logout')}</span>
                </button>
              </div>
              <div className="px-5 py-4 border-t border-gray-100 bg-gray-50">
                <div className="flex items-center rtl:flex-row-reverse">
                  <div className="flex-shrink-0">
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold">
                      {profile?.name?.charAt(0)}
                    </div>
                  </div>
                  <div className="ml-3 rtl:ml-0 rtl:mr-3">
                    <div className="text-base font-medium text-gray-800">{profile?.name}</div>
                    <div className="text-sm font-medium text-gray-500 capitalize">{profile?.role}</div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Main Content */}
      <main className="flex-grow max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      {/* Mobile Bottom Nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-3 flex justify-between items-center z-40">
        <Link to="/" className={cn("p-2", location.pathname === "/" ? "text-blue-600" : "text-gray-400")}>
          <LayoutDashboard className="h-6 w-6" />
        </Link>
        <Link to="/products" className={cn("p-2", location.pathname === "/products" ? "text-blue-600" : "text-gray-400")}>
          <Package className="h-6 w-6" />
        </Link>
        <div className="-mt-12">
          <Link to="/scan" className="flex items-center justify-center w-14 h-14 bg-blue-600 text-white rounded-full shadow-xl ring-4 ring-white">
            <ScanLine className="h-7 w-7" />
          </Link>
        </div>
        <Link to="/alerts" className={cn("p-2", location.pathname === "/alerts" ? "text-blue-600" : "text-gray-400")}>
          <Bell className="h-6 w-6" />
        </Link>
        <Link to="/tasks" className={cn("p-2", location.pathname === "/tasks" ? "text-blue-600" : "text-gray-400")}>
          <CheckSquare className="h-6 w-6" />
        </Link>
        {(isAdmin || isStaff) && (
          <Link to="/settings" className={cn("p-2", location.pathname === "/settings" ? "text-blue-600" : "text-gray-400")}>
            <Settings className="h-6 w-6" />
          </Link>
        )}
      </div>
      <div className="md:hidden h-16" /> {/* Spacer for bottom nav */}
      <Toaster position="top-center" richColors />
    </div>
  );
};

export default Layout;
