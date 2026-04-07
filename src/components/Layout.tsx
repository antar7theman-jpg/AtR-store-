import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Package, Bell, Settings, LogOut, Menu, X, ScanLine, CheckSquare, Languages, Sun, Moon, MessageSquare, UsersRound } from 'lucide-react';
import { Toaster } from 'sonner';
import { useAuth } from './AuthGuard';
import { useTheme } from './ThemeContext';
import { auth } from '../firebase';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import OfflineStatus from './OfflineStatus';
import NotificationPermissionBanner from './NotificationPermissionBanner';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, isAdmin, isStaff } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const { t, i18n } = useTranslation();

  const [isLangOpen, setIsLangOpen] = React.useState(false);
  const langRef = React.useRef<HTMLDivElement>(null);

  const navItems = [
    { name: t('nav.dashboard'), path: '/', icon: LayoutDashboard },
    { name: t('nav.products'), path: '/products', icon: Package },
    { name: t('nav.alerts'), path: '/alerts', icon: Bell },
    { name: t('nav.tasks'), path: '/tasks', icon: CheckSquare },
    { name: t('nav.teams'), path: '/teams', icon: UsersRound },
    { name: t('nav.chat'), path: '/chat', icon: MessageSquare },
  ];

  if (isAdmin || isStaff) {
    navItems.push({ name: t('nav.settings'), path: '/settings', icon: Settings });
  }

  const handleLogout = async () => {
    await auth.signOut();
    navigate('/login');
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    setIsLangOpen(false);
  };

  const currentLang = i18n.language.split('-')[0];
  const languages = [
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'ar', name: 'العربية', flag: '🇸🇦' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' }
  ];

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(event.target as Node)) {
        setIsLangOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col transition-colors duration-300" dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
      <OfflineStatus />
      <NotificationPermissionBanner />
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-50 transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center">
              <Link to="/" className="flex items-center space-x-2 rtl:space-x-reverse">
                <div className="bg-blue-600 p-1.5 rounded-lg">
                  <Package className="h-6 w-6 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xl font-bold text-gray-900 dark:text-white tracking-tight leading-none">ATR Store</span>
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
                      ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                      : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.name}</span>
                </Link>
              ))}
            </nav>

            <div className="hidden md:flex items-center space-x-4 rtl:space-x-reverse">
              <Link
                to="/scan"
                className="flex items-center space-x-1.5 px-4 py-2 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-xl text-sm font-bold hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-all border border-blue-100 dark:border-blue-800"
                title="Scan Barcode"
              >
                <ScanLine className="h-4 w-4" />
                <span>{t('nav.scan', { defaultValue: 'Scan' })}</span>
              </Link>
              <button
                onClick={toggleTheme}
                className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
              >
                {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
              </button>
              <div className="relative" ref={langRef}>
                <button
                  onClick={() => setIsLangOpen(!isLangOpen)}
                  className="flex items-center space-x-1 px-3 py-2 rounded-xl text-sm font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all border border-transparent hover:border-gray-200 dark:hover:border-gray-700"
                  title="Change Language"
                >
                  <Languages className="h-4 w-4" />
                  <span className="uppercase">{currentLang}</span>
                </button>
                
                <AnimatePresence>
                  {isLangOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 rtl:left-0 rtl:right-auto mt-2 w-40 rounded-2xl bg-white dark:bg-gray-900 shadow-xl border border-gray-100 dark:border-gray-800 py-2 z-[60]"
                    >
                      {languages.map((lang) => (
                        <button
                          key={lang.code}
                          onClick={() => changeLanguage(lang.code)}
                          className={cn(
                            "w-full flex items-center px-4 py-2.5 text-sm transition-colors",
                            currentLang === lang.code
                              ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-bold"
                              : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                          )}
                        >
                          <span className="mr-3 rtl:mr-0 rtl:ml-3 text-lg">{lang.flag}</span>
                          <span>{lang.name}</span>
                          {currentLang === lang.code && (
                            <div className="ml-auto rtl:ml-0 rtl:mr-auto w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
                          )}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {profile ? (
                <>
                  <div className="text-right rtl:text-left mr-4 rtl:mr-0 rtl:ml-4">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{profile.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">{profile.role}</div>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    title={t('nav.logout')}
                  >
                    <LogOut className="h-5 w-5 rtl:rotate-180" />
                  </button>
                </>
              ) : (
                <Link
                  to="/login"
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 active:scale-95"
                >
                  {t('login.signIn')}
                </Link>
              )}
            </div>

            {/* Mobile menu button */}
            <div className="md:hidden flex items-center space-x-2 rtl:space-x-reverse">
              <button
                onClick={toggleTheme}
                className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
              >
                {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
              </button>
              <div className="relative">
                <button
                  onClick={() => setIsLangOpen(!isLangOpen)}
                  className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
                >
                  <Languages className="h-5 w-5" />
                </button>
                <AnimatePresence>
                  {isLangOpen && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="absolute right-0 rtl:left-0 rtl:right-auto mt-2 w-40 rounded-2xl bg-white dark:bg-gray-900 shadow-xl border border-gray-100 dark:border-gray-800 py-2 z-[60]"
                    >
                      {languages.map((lang) => (
                        <button
                          key={lang.code}
                          onClick={() => {
                            changeLanguage(lang.code);
                            setIsMenuOpen(false);
                          }}
                          className={cn(
                            "w-full flex items-center px-4 py-3 text-sm transition-colors",
                            currentLang === lang.code
                              ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-bold"
                              : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                          )}
                        >
                          <span className="mr-3 rtl:mr-0 rtl:ml-3 text-lg">{lang.flag}</span>
                          <span>{lang.name}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <Link 
                to="/scan" 
                className="p-2 bg-blue-600 text-white rounded-full shadow-lg"
              >
                <ScanLine className="h-5 w-5" />
              </Link>
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="p-2 rounded-md text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none"
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
              className="md:hidden bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 overflow-hidden transition-colors duration-300"
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
                        ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                        : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                    )}
                  >
                    <item.icon className="h-5 w-5" />
                    <span>{item.name}</span>
                  </Link>
                ))}
                {profile ? (
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center space-x-3 rtl:space-x-reverse px-3 py-3 rounded-md text-base font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <LogOut className="h-5 w-5 rtl:rotate-180" />
                    <span>{t('nav.logout')}</span>
                  </button>
                ) : (
                  <Link
                    to="/login"
                    onClick={() => setIsMenuOpen(false)}
                    className="w-full flex items-center space-x-3 rtl:space-x-reverse px-3 py-3 rounded-md text-base font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                  >
                    <LogOut className="h-5 w-5 rtl:rotate-180" />
                    <span>{t('login.signIn')}</span>
                  </Link>
                )}
              </div>
              {profile && (
                <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <div className="flex items-center rtl:flex-row-reverse">
                    <div className="flex-shrink-0">
                      <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-700 dark:text-blue-400 font-bold">
                        {profile.name.charAt(0)}
                      </div>
                    </div>
                    <div className="ml-3 rtl:ml-0 rtl:mr-3">
                      <div className="text-base font-medium text-gray-800 dark:text-white">{profile.name}</div>
                      <div className="text-sm font-medium text-gray-500 dark:text-gray-400 capitalize">{profile.role}</div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Main Content */}
      <main className="flex-grow max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      {/* Mobile Bottom Nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-6 py-3 flex justify-between items-center z-40 transition-colors duration-300">
        <Link to="/" className={cn("p-2", location.pathname === "/" ? "text-blue-600" : "text-gray-400 dark:text-gray-500")}>
          <LayoutDashboard className="h-6 w-6" />
        </Link>
        <Link to="/products" className={cn("p-2", location.pathname === "/products" ? "text-blue-600" : "text-gray-400 dark:text-gray-500")}>
          <Package className="h-6 w-6" />
        </Link>
        <div className="-mt-12">
          <Link to="/scan" className="flex items-center justify-center w-14 h-14 bg-blue-600 text-white rounded-full shadow-xl ring-4 ring-white dark:ring-gray-900">
            <ScanLine className="h-7 w-7" />
          </Link>
        </div>
        <Link to="/alerts" className={cn("p-2", location.pathname === "/alerts" ? "text-blue-600" : "text-gray-400 dark:text-gray-500")}>
          <Bell className="h-6 w-6" />
        </Link>
        {(isAdmin || isStaff) && (
          <Link to="/settings" className={cn("p-2", location.pathname === "/settings" ? "text-blue-600" : "text-gray-400 dark:text-gray-500")}>
            <Settings className="h-6 w-6" />
          </Link>
        )}
      </div>
      <div className="md:hidden h-16" /> {/* Spacer for bottom nav */}
      <Toaster position="top-center" richColors theme={theme} />
    </div>
  );
};

export default Layout;
