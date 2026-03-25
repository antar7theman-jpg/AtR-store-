import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { X, AlertCircle, RefreshCw, ScanLine, CheckCircle, Zap, ZapOff } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

interface ScannerProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
  autoFlash?: boolean;
}

const Scanner: React.FC<ScannerProps> = ({ onScan, onClose, autoFlash = false }) => {
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [isScanned, setIsScanned] = useState(false);
  const [hasFlash, setHasFlash] = useState(false);
  const [isFlashOn, setIsFlashOn] = useState(false);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const scannerId = useRef(`reader-${Math.random().toString(36).substring(2, 9)}`);

  const toggleFlash = async () => {
    if (!html5QrCodeRef.current || !isStarted || !hasFlash) return;

    try {
      const newState = !isFlashOn;
      // html5-qrcode doesn't have a direct toggleFlash, but we can use applyVideoConstraints
      // if the browser supports it via the track
      const track = html5QrCodeRef.current.getRunningTrackCapabilities();
      if (track && (track as any).torch) {
        await (html5QrCodeRef.current as any).applyVideoConstraints({
          advanced: [{ torch: newState }]
        });
        setIsFlashOn(newState);
      }
    } catch (err) {
      console.error("Failed to toggle flash:", err);
    }
  };

  const startScanner = async () => {
    if (!html5QrCodeRef.current) {
      try {
        html5QrCodeRef.current = new Html5Qrcode(scannerId.current);
      } catch (e) {
        console.error("Failed to create Html5Qrcode instance", e);
        return;
      }
    }

    if (html5QrCodeRef.current.isScanning) {
      return;
    }

    // Check permission status if API is available
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
        if (result.state === 'denied') {
          setError("Camera permission is denied in your browser settings. Please reset it and refresh the page.");
          return;
        }
      } catch (e) {
        // Ignore errors from permissions.query
      }
    }

    setIsInitializing(true);
    setIsStarted(true);
    setError(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Your browser does not support camera access or it is blocked by security policies.");
      }

      const config = {
        fps: 30,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          // Barcodes are usually horizontal, so we want a wider box
          const width = Math.min(viewfinderWidth * 0.85, 500);
          const height = Math.min(viewfinderHeight * 0.3, 250);
          return { width, height };
        },
        aspectRatio: undefined,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true,
        },
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.CODE_93,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.DATA_MATRIX,
        ],
      };

      await html5QrCodeRef.current.start(
        { facingMode: "environment" },
        config,
        async (decodedText) => {
          if (html5QrCodeRef.current?.isScanning) {
            try {
              setIsScanned(true);
              await html5QrCodeRef.current.stop();
              setTimeout(() => onScan(decodedText), 500);
            } catch (err) {
              console.error("Failed to stop scanner after scan", err);
              onScan(decodedText);
            }
          }
        },
        () => {}
      );

      // Check for flashlight capability after starting
      try {
        const capabilities = html5QrCodeRef.current.getRunningTrackCapabilities();
        if (capabilities && (capabilities as any).torch) {
          setHasFlash(true);
          
          // Auto-enable flash if requested
          if (autoFlash) {
            try {
              await (html5QrCodeRef.current as any).applyVideoConstraints({
                advanced: [{ torch: true }]
              });
              setIsFlashOn(true);
            } catch (flashErr) {
              console.error("Failed to auto-enable flash:", flashErr);
            }
          }
        }
      } catch (e) {
        console.log("Flashlight capability check failed", e);
      }

      setIsInitializing(false);
    } catch (err: any) {
      console.error("Scanner initialization error:", err);
      let message = "Could not start camera. ";
      
      if (err.name === "NotAllowedError" || err.message?.includes("Permission denied")) {
        message = "Camera permission denied. To fix this, click the lock icon in your browser's address bar, reset the camera permission, and refresh the page. If you're in AI Studio, you may also need to ensure the main page has camera access.";
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        message = "No camera found on this device.";
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        message = "Camera is already in use.";
      } else if (err.name === "OverconstrainedError") {
        message = "Camera constraints could not be satisfied.";
      } else {
        message += err.message || "An unknown error occurred.";
      }
      
      setError(message);
      setIsInitializing(false);
    }
  };

  useEffect(() => {
    const checkPermission = async () => {
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
          if (result.state === 'denied') {
            setError("Camera permission is denied. Please reset it in your browser settings and refresh the page.");
          }
        } catch (e) {}
      }
    };
    checkPermission();

    const scanner = html5QrCodeRef.current;
    return () => {
      if (scanner) {
        if (scanner.isScanning) {
          scanner.stop()
            .then(() => {
              try { scanner.clear(); } catch (e) {}
            })
            .catch(err => console.error("Failed to stop scanner on unmount", err));
        } else {
          try { scanner.clear(); } catch (e) {}
        }
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center">
      <div className="absolute top-6 right-6 z-[110] flex items-center space-x-4">
        {hasFlash && isStarted && !isInitializing && !isScanned && (
          <button
            onClick={toggleFlash}
            className={cn(
              "flex flex-col items-center justify-center p-2 rounded-2xl transition-all backdrop-blur-md active:scale-90 min-w-[64px]",
              isFlashOn ? "bg-yellow-400 text-black shadow-[0_0_15px_rgba(250,204,21,0.5)]" : "bg-white/20 text-white hover:bg-white/30"
            )}
            title={isFlashOn ? "Turn flash off" : "Turn flash on"}
          >
            {isFlashOn ? <Zap className="h-6 w-6 fill-current" /> : <ZapOff className="h-6 w-6" />}
            <span className="text-[10px] font-bold uppercase mt-1 tracking-wider">
              Flash {isFlashOn ? "On" : "Off"}
            </span>
          </button>
        )}
        <button
          onClick={onClose}
          className="p-3 bg-white/20 text-white rounded-full hover:bg-white/30 transition-all backdrop-blur-md active:scale-90"
        >
          <X className="h-6 w-6" />
        </button>
      </div>
      
      <div className="w-full h-full relative">
        <div id={scannerId.current} className="w-full h-full object-cover" />
        
        {/* Scanning UI Overlays */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {/* Viewfinder area - matching the qrbox logic */}
          <div className="w-[85%] max-w-[500px] h-[30%] max-h-[250px] border-2 border-white/30 rounded-3xl relative">
            <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-blue-500 rounded-tl-2xl -translate-x-1 -translate-y-1" />
            <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-blue-500 rounded-tr-2xl translate-x-1 -translate-y-1" />
            <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-blue-500 rounded-bl-2xl -translate-x-1 translate-y-1" />
            <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-blue-500 rounded-br-2xl translate-x-1 translate-y-1" />
            
            {/* Animated scan line */}
            {!error && isStarted && !isInitializing && !isScanned && (
              <div className="absolute top-1/2 left-0 w-full h-1 bg-blue-500 shadow-[0_0_20px_rgba(59,130,246,1)] animate-scan" />
            )}
          </div>

          <div className="mt-8 text-center px-6">
            <h3 className="text-white text-lg font-bold drop-shadow-md">Scan Barcode</h3>
            <p className="text-white/70 text-sm mt-2 drop-shadow-md">
              Position the barcode within the frame
            </p>
          </div>

          {isScanned && (
            <motion.div 
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="absolute bg-green-500 text-white p-6 rounded-full shadow-2xl flex flex-col items-center z-50 pointer-events-auto"
            >
              <CheckCircle className="h-12 w-12 mb-2" />
              <span className="font-bold text-xl">Detected!</span>
            </motion.div>
          )}

          {!isStarted && !error && !isScanned && (
            <div className="p-8 text-center flex flex-col items-center pointer-events-auto bg-black/60 backdrop-blur-sm rounded-3xl m-4">
              <div className="bg-blue-500/20 p-4 rounded-full mb-4">
                <ScanLine className="h-10 w-10 text-blue-400" />
              </div>
              <p className="text-white font-bold mb-2">Camera Access Required</p>
              <p className="text-white/60 text-sm mb-6 max-w-[240px]">
                We need your permission to use the camera for scanning.
              </p>
              <button
                onClick={startScanner}
                className="px-8 py-3 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all active:scale-95 shadow-lg shadow-blue-500/20"
              >
                Enable Camera
              </button>
            </div>
          )}
          
          {isInitializing && (
            <div className="flex flex-col items-center text-white bg-black/40 p-6 rounded-2xl backdrop-blur-sm">
              <RefreshCw className="h-8 w-8 animate-spin mb-2" />
              <p className="text-sm font-medium">Initializing camera...</p>
            </div>
          )}
          
          {error && (
            <div className="p-8 text-center flex flex-col items-center pointer-events-auto bg-white rounded-3xl m-4 shadow-2xl max-w-sm">
              <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
              <p className="text-gray-900 font-bold mb-2">Camera Error</p>
              <p className="text-sm text-gray-500 mb-6 px-4">{error}</p>
              <div className="bg-gray-50 p-4 rounded-xl text-left mb-6 w-full">
                <p className="text-xs font-bold text-gray-400 uppercase mb-2">How to fix:</p>
                <ol className="text-xs text-gray-600 space-y-1 list-decimal pl-4">
                  <li>Click the <b>lock icon</b> in your address bar.</li>
                  <li>Reset the <b>Camera</b> permission.</li>
                  <li><b>Refresh</b> the page.</li>
                </ol>
              </div>
              <button
                onClick={startScanner}
                className="px-6 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Scanner;
