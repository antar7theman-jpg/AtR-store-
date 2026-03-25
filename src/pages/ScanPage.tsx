import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import Scanner from '../components/Scanner';
import { Search, Barcode, AlertCircle, ArrowLeft, ChevronRight, ScanLine, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

const ScanPage: React.FC = () => {
  const navigate = useNavigate();
  const [manualBarcode, setManualBarcode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [showScanner, setShowScanner] = useState(true);
  const [useFlash, setUseFlash] = useState(false);
  const [recentScans, setRecentScans] = useState<{ barcode: string; product?: any; timestamp: number }[]>([]);
  
  // New Barcode Handling
  const [newBarcode, setNewBarcode] = useState<string | null>(null);
  const [showNewBarcodeModal, setShowNewBarcodeModal] = useState(false);

  const handleScan = async (barcode: string) => {
    if (!barcode) return;
    
    setSearching(true);
    setError(null);
    try {
      const q = query(collection(db, 'products'), where('barcodes', 'array-contains', barcode));
      const querySnapshot = await getDocs(q);
      
      let productData = null;
      if (!querySnapshot.empty) {
        const productDoc = querySnapshot.docs[0];
        productData = { id: productDoc.id, ...productDoc.data() };
        
        // If found, navigate to product detail with history tab active
        navigate(`/products/${productDoc.id}?tab=history`);
      } else {
        // Barcode not found - ask user what to do
        setNewBarcode(barcode);
        setShowNewBarcodeModal(true);
        setShowScanner(false);
      }

      // Add to recent scans (at the top)
      setRecentScans(prev => [
        { barcode, product: productData, timestamp: Date.now() },
        ...prev.slice(0, 9) // Keep last 10
      ]);

    } catch (err) {
      console.error("Error searching product:", err);
      setError("An error occurred while searching.");
    } finally {
      setSearching(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualBarcode.trim()) {
      handleScan(manualBarcode.trim());
    }
  };

  return (
    <div className="max-w-md mx-auto space-y-8">
      <div className="flex items-center space-x-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <ArrowLeft className="h-6 w-6 text-gray-600" />
        </button>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Scan Product</h1>
      </div>

      <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 text-center space-y-6">
        <div className="bg-blue-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto">
          <Barcode className="h-10 w-10 text-blue-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">Ready to Scan</h2>
          <p className="text-gray-500 mt-2">Use your camera to scan a product barcode or enter it manually below.</p>
        </div>

        <div className="pt-4">
          <AnimatePresence mode="wait">
            {showScanner ? (
              <Scanner 
                onScan={(barcode) => {
                  handleScan(barcode);
                }} 
                onClose={() => setShowScanner(false)} 
                autoFlash={useFlash}
              />
            ) : (
              <div className="space-y-3">
                <button
                  onClick={() => {
                    setUseFlash(false);
                    setShowScanner(true);
                  }}
                  className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-all flex items-center justify-center space-x-2"
                >
                  <ScanLine className="h-5 w-5" />
                  <span>Scan Again</span>
                </button>
                <button
                  onClick={() => {
                    setUseFlash(true);
                    setShowScanner(true);
                  }}
                  className="w-full py-4 bg-amber-500 text-white font-bold rounded-2xl shadow-lg shadow-amber-500/20 hover:bg-amber-600 transition-all flex items-center justify-center space-x-2"
                >
                  <Zap className="h-5 w-5" />
                  <span>Scan with Flashlight</span>
                </button>
              </div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-gray-500 uppercase tracking-widest font-bold text-[10px]">
              Or enter manually
            </span>
          </div>
        </div>

        <form onSubmit={handleManualSubmit} className="space-y-4">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Enter barcode number"
              value={manualBarcode}
              onChange={(e) => setManualBarcode(e.target.value)}
              className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="w-full py-3 bg-gray-900 text-white font-bold rounded-2xl hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {searching ? "Searching..." : "Lookup Product"}
          </button>
        </form>

        {/* Recent Scans Section */}
        {recentScans.length > 0 && (
          <div className="pt-6 border-t border-gray-100 text-left">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Recent Scans</h3>
            <div className="space-y-3">
              {recentScans.map((scan, idx) => (
                <motion.div
                  key={`${scan.barcode}-${scan.timestamp}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={cn(
                    "p-4 rounded-2xl border transition-all cursor-pointer",
                    scan.product 
                      ? "bg-blue-50 border-blue-100 hover:bg-blue-100" 
                      : "bg-gray-50 border-gray-100 hover:bg-gray-100"
                  )}
                  onClick={() => scan.product && navigate(`/products/${scan.product.id}`)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className={cn(
                        "p-2 rounded-lg",
                        scan.product ? "bg-blue-500 text-white" : "bg-gray-400 text-white"
                      )}>
                        <Barcode className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">
                          {scan.product ? scan.product.name : "Unknown Product"}
                        </p>
                        <p className="text-xs text-gray-500">{scan.barcode}</p>
                      </div>
                    </div>
                    {scan.product ? (
                      <ChevronRight className="h-4 w-4 text-blue-400" />
                    ) : (
                      <Link 
                        to={`/products/add?barcode=${scan.barcode}`}
                        className="text-[10px] font-bold text-blue-600 uppercase tracking-tight hover:underline"
                      >
                        Add New
                      </Link>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-red-50 p-4 rounded-2xl flex items-start text-left"
          >
            <AlertCircle className="h-5 w-5 text-red-500 mr-3 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 font-medium">{error}</p>
          </motion.div>
        )}
      </div>

      {/* New Barcode Modal */}
      <AnimatePresence>
        {showNewBarcodeModal && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-8 text-center space-y-6">
                <div className="bg-amber-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                  <AlertCircle className="h-8 w-8 text-amber-600" />
                </div>
                
                <div>
                  <h3 className="text-xl font-bold text-gray-900">New Barcode Detected</h3>
                  <p className="text-gray-500 mt-2">
                    Barcode <span className="font-mono font-bold text-gray-900">{newBarcode}</span> is not in your inventory.
                  </p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={() => navigate(`/products/add?barcode=${newBarcode}`)}
                    className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-md"
                  >
                    Create New Product
                  </button>
                  <button
                    onClick={() => navigate(`/products?linkBarcode=${newBarcode}`)}
                    className="w-full py-4 bg-white border-2 border-gray-200 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all"
                  >
                    Link to Existing Product
                  </button>
                  <button
                    onClick={() => setShowNewBarcodeModal(false)}
                    className="w-full py-3 text-gray-400 font-medium hover:text-gray-600 transition-colors"
                  >
                    Cancel
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

export default ScanPage;
