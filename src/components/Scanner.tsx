import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { X, AlertCircle, RefreshCw, ScanLine, CheckCircle, Zap, ZapOff, ZoomIn, ZoomOut, Camera, Pause, Play, Barcode, Package } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

interface ScannerProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
  continuous?: boolean;
  quickUpdate?: boolean;
  foundProduct?: { name: string; currentStock: number } | null;
}

const Scanner: React.FC<ScannerProps> = ({ 
  onScan, 
  onClose, 
  continuous = false,
  quickUpdate = false,
  foundProduct = null
}) => {
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isScanned, setIsScanned] = useState(false);
  const [scannedText, setScannedText] = useState<string | null>(null);
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [currentCameraId, setCurrentCameraId] = useState<string | null>(null);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null);
  const [currentZoom, setCurrentZoom] = useState(1);
  const [manualBarcode, setManualBarcode] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerRef = useRef<HTMLDivElement>(null);
  const [scannerId] = useState(() => `scanner-${Math.random().toString(36).substring(2, 9)}`);
  const isInitializingRef = useRef(false);
  const isTransitioningRef = useRef(false);
  const lastScannedRef = useRef<string | null>(null);

  // Get available cameras
  const initCameras = async (requestPermission = false) => {
    if (isInitializingRef.current) return;
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      if (requestPermission) {
        setError("Your browser does not support camera access or it is blocked by security policies.");
      }
      return;
    }

    isInitializingRef.current = true;
    setIsInitializing(true);
    setError(null);
    try {
      // In some browsers, we need to call getUserMedia first to get labels
      if (requestPermission) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          stream.getTracks().forEach(track => track.stop());
          // Give the browser a moment to release the camera
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (e: any) {
          console.warn("Direct getUserMedia failed", e);
          const isPermissionError = e.name === "NotAllowedError" || 
                                   e.name === "PermissionDeniedError" || 
                                   e.message?.toLowerCase().includes("permission denied");
          if (isPermissionError) {
            setError("Camera permission denied. Please allow camera access in your browser settings.");
            setIsInitializing(false);
            isInitializingRef.current = false;
            return;
          }
        }
      }

      let devices: { id: string; label: string }[] = [];
      try {
        const cameraDevices = await Html5Qrcode.getCameras();
        if (cameraDevices && cameraDevices.length > 0) {
          devices = cameraDevices.map(d => ({ id: d.id, label: d.label || `Camera ${d.id.substring(0, 4)}` }));
          setCameras(devices);
        }
      } catch (e) {
        console.warn("Html5Qrcode.getCameras failed, will try starting with facingMode", e);
      }

      if (devices.length > 0) {
        // Try to find a back camera by default
        const backCamera = devices.find(d => 
          d.label.toLowerCase().includes('back') || 
          d.label.toLowerCase().includes('rear') ||
          d.label.toLowerCase().includes('environment') ||
          d.label.toLowerCase().includes('facing back')
        );
        
        const initialCameraId = backCamera ? backCamera.id : devices[0].id;
        setCurrentCameraId(initialCameraId);

        // Check permissions and auto-start if granted
        if (navigator.permissions && navigator.permissions.query) {
          try {
            const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
            if (result.state === 'granted' && !isStarted) {
              // Small delay to ensure everything is settled
              setTimeout(() => startScanner(initialCameraId), 100);
            }
          } catch (e) {}
        }
      } else if (requestPermission && !isStarted) {
        // If we requested permission and it succeeded (or we didn't catch a hard permission error),
        // but getCameras returned nothing, try starting with facingMode anyway
        startScanner();
      }
    } catch (err: any) {
      console.error("Error in initCameras", err);
      const isPermissionError = err.name === "NotAllowedError" || 
                               err.name === "PermissionDeniedError" || 
                               err.message?.toLowerCase().includes("permission denied");
                               
      if (requestPermission || !isPermissionError) {
        setError("Failed to access camera. Please ensure you have granted camera permissions.");
      }
    } finally {
      setIsInitializing(false);
      isInitializingRef.current = false;
    }
  };

  useEffect(() => {
    // Small delay to ensure DOM is ready and avoid race conditions
    const timer = setTimeout(() => {
      initCameras();
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.01);
      gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.1);

      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.1);
    } catch (e) {
      console.error("Failed to play beep", e);
    }
  };

  const vibrate = () => {
    if (navigator.vibrate) {
      navigator.vibrate(100);
    }
  };

  const handleZoom = async (value: number) => {
    if (!html5QrCodeRef.current || !isStarted || !zoomRange) return;

    try {
      const track = html5QrCodeRef.current.getRunningTrackCapabilities();
      if (track && (track as any).zoom) {
        await (html5QrCodeRef.current as any).applyVideoConstraints({
          advanced: [{ zoom: value }]
        });
        setCurrentZoom(value);
      }
    } catch (err) {
      console.error("Failed to set zoom:", err);
    }
  };

  const switchCamera = async () => {
    if (cameras.length < 2 || !html5QrCodeRef.current) return;
    
    const currentIndex = cameras.findIndex(c => c.id === currentCameraId);
    const nextIndex = (currentIndex + 1) % cameras.length;
    const nextCameraId = cameras[nextIndex].id;
    
    setIsInitializing(true);
    try {
      if (html5QrCodeRef.current.isScanning) {
        await html5QrCodeRef.current.stop();
      }
      setCurrentCameraId(nextCameraId);
      // We'll restart with the new camera ID
      startScanner(nextCameraId);
    } catch (err) {
      console.error("Failed to switch camera", err);
      setError("Failed to switch camera.");
      setIsInitializing(false);
    }
  };

  const stopScanner = async () => {
    if (isTransitioningRef.current) {
      console.warn("Stop requested during transition, skipping...");
      return;
    }
    isTransitioningRef.current = true;

    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        try {
          html5QrCodeRef.current.clear();
        } catch (e) {}
      } catch (e) {
        console.error("Failed to stop scanner", e);
      }
    }
    setIsStarted(false);
    setIsPaused(false);
    isTransitioningRef.current = false;
  };

  const startScanner = async (cameraId?: string) => {
    if (isTransitioningRef.current) {
      console.warn("Start requested during transition, skipping...");
      return;
    }
    
    // If already scanning with the same camera, do nothing
    if (html5QrCodeRef.current?.isScanning && cameraId === currentCameraId) {
      return;
    }

    // Internal stop that doesn't check transition ref (since we're already in a start transition)
    const internalStop = async () => {
      if (html5QrCodeRef.current) {
        try {
          if (html5QrCodeRef.current.isScanning) {
            await html5QrCodeRef.current.stop();
          }
          try {
            html5QrCodeRef.current.clear();
          } catch (e) {}
        } catch (e) {
          console.error("Internal stop failed", e);
        }
      }
    };

    isTransitioningRef.current = true;
    await internalStop();
    // Give the browser a moment to release the camera after stop
    // Increased delay to be more resilient to slow camera releases
    await new Promise(resolve => setTimeout(resolve, 500));

    // Ensure the element exists in DOM
    let element = scannerContainerRef.current;
    if (!element) {
      // Fallback to getElementById if ref is not available for some reason
      element = document.getElementById(scannerId) as HTMLDivElement;
    }

    if (!element) {
      console.warn("Scanner element not found in DOM, retrying in 200ms...", scannerId);
      // One-time retry
      await new Promise(resolve => setTimeout(resolve, 200));
      element = scannerContainerRef.current || document.getElementById(scannerId) as HTMLDivElement;
      
      if (!element) {
        console.error("Scanner element still not found in DOM after retry", scannerId);
        setError("Scanner initialization failed: element not found. Please try refreshing the page.");
        isTransitioningRef.current = false;
        return;
      }
    }

    if (!html5QrCodeRef.current) {
      try {
        html5QrCodeRef.current = new Html5Qrcode(scannerId);
      } catch (e) {
        console.error("Failed to create Html5Qrcode instance", e);
        setError("Failed to initialize scanner engine.");
        isTransitioningRef.current = false;
        return;
      }
    }

    if (html5QrCodeRef.current.isScanning) {
      isTransitioningRef.current = false;
      return;
    }

    // Check permission status if API is available
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
        // We don't block here anymore because query can be unreliable in iframes
        if (result.state === 'denied') {
          console.warn("Camera permission state is 'denied' according to permissions API.");
        }
      } catch (e) {
        // Ignore errors from permissions.query
      }
    }

    setIsInitializing(true);
    setIsStarted(true);
    setIsPaused(false);
    setError(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Your browser does not support camera access or it is blocked by security policies.");
      }

      const config = {
        fps: 30, // Lower FPS for better compatibility
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          // Optimized for 1D barcodes: wide and short
          // Minimum size must be 50px
          const width = Math.max(50, Math.min(viewfinderWidth * 0.9, 600));
          const height = Math.max(50, Math.min(viewfinderHeight * 0.25, 200));
          return { width, height };
        },
        aspectRatio: undefined,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.CODE_93,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
      };

      // Try to start with the requested camera or facingMode with retry logic
      let retryCount = 0;
      const maxRetries = 2;
      
      const attemptStart = async (): Promise<void> => {
        try {
          await html5QrCodeRef.current!.start(
            cameraId ? cameraId : { facingMode: "environment" },
            config,
            async (decodedText) => {
              if (html5QrCodeRef.current?.isScanning && !isPaused) {
                // Prevent duplicate scans in continuous mode within a short window
                if (continuous && decodedText === lastScannedRef.current) return;

                try {
                  setIsScanned(true);
                  setScannedText(decodedText);
                  playBeep();
                  vibrate();
                  
                  if (continuous) {
                    lastScannedRef.current = decodedText;
                    onScan(decodedText);
                    // Reset scanned state after a bit to show feedback again
                    setTimeout(() => {
                      setIsScanned(false);
                      setScannedText(null);
                      lastScannedRef.current = null;
                    }, 2000);
                  } else {
                    await html5QrCodeRef.current.stop();
                    setTimeout(() => onScan(decodedText), 500);
                  }
                } catch (err) {
                  console.error("Failed to handle scan", err);
                  onScan(decodedText);
                }
              }
            },
            () => {}
          );
        } catch (startErr: any) {
          if ((startErr.name === "NotReadableError" || startErr.name === "TrackStartError") && retryCount < maxRetries) {
            retryCount++;
            console.warn(`Scanner start failed with NotReadableError, retrying (${retryCount}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, 800));
            return attemptStart();
          }
          throw startErr;
        }
      };

      try {
        await attemptStart();
      } catch (startErr: any) {
        console.error("Scanner start error:", startErr);
        
        // Fallback if environment camera fails
        if (!cameraId && startErr.name !== "NotAllowedError" && startErr.name !== "PermissionDeniedError") {
          console.warn("Environment camera failed, trying user camera...", startErr);
          try {
            await html5QrCodeRef.current.start(
              { facingMode: "user" },
              config,
              async (decodedText) => {
                // Same callback logic
                if (html5QrCodeRef.current?.isScanning && !isPaused) {
                  if (continuous && decodedText === lastScannedRef.current) return;
                  try {
                    setIsScanned(true);
                    setScannedText(decodedText);
                    playBeep();
                    vibrate();
                    if (continuous) {
                      lastScannedRef.current = decodedText;
                      onScan(decodedText);
                      setTimeout(() => {
                        setIsScanned(false);
                        setScannedText(null);
                        lastScannedRef.current = null;
                      }, 2000);
                    } else {
                      await html5QrCodeRef.current.stop();
                      setTimeout(() => onScan(decodedText), 500);
                    }
                  } catch (err) {
                    onScan(decodedText);
                  }
                }
              },
              () => {}
            );
          } catch (userCamErr: any) {
            throw userCamErr;
          }
        } else {
          throw startErr;
        }
      }

      // Store current camera ID if not already set
      if (!cameraId) {
        try {
          // This is a bit hacky as html5-qrcode doesn't expose the active camera ID easily after start with facingMode
          const devices = await Html5Qrcode.getCameras();
          if (devices && devices.length > 0) {
            // Usually the first one if we requested environment
            setCurrentCameraId(devices[0].id);
          }
        } catch (e) {}
      } else {
        setCurrentCameraId(cameraId);
      }

      // Check for capabilities after starting
      try {
        const capabilities = html5QrCodeRef.current.getRunningTrackCapabilities();
        
        // Zoom check
        if (capabilities && (capabilities as any).zoom) {
          const zoom = (capabilities as any).zoom;
          setZoomRange({
            min: zoom.min || 1,
            max: zoom.max || 1,
            step: zoom.step || 0.1
          });
          setCurrentZoom(zoom.min || 1);
        }
      } catch (e) {
        console.log("Capabilities check failed", e);
      }

      setIsInitializing(false);
      isTransitioningRef.current = false;
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
      isTransitioningRef.current = false;
    }
  };

  useEffect(() => {
    const checkPermission = async () => {
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
          // If denied, we show a helpful message but don't necessarily block the UI
          // as the user might be able to fix it or use manual entry
          if (result.state === 'denied') {
            console.warn("Camera permission is denied by browser settings.");
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
      <div className="absolute top-6 right-6 z-[110] flex items-center space-x-3">
        {cameras.length > 1 && isStarted && !isInitializing && !isScanned && (
          <button
            onClick={switchCamera}
            className="p-3 bg-white/20 text-white rounded-full hover:bg-white/30 transition-all backdrop-blur-md active:scale-90"
            title="Switch Camera"
          >
            <Camera className="h-6 w-6" />
          </button>
        )}
        {isStarted && !isInitializing && !isScanned && (
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={cn(
              "p-3 rounded-full transition-all backdrop-blur-md active:scale-90",
              isPaused ? "bg-amber-500 text-white" : "bg-white/20 text-white hover:bg-white/30"
            )}
            title={isPaused ? "Resume Scanning" : "Pause Scanning"}
          >
            {isPaused ? <Play className="h-6 w-6" /> : <Pause className="h-6 w-6" />}
          </button>
        )}
        {zoomRange && zoomRange.max > zoomRange.min && isStarted && !isInitializing && !isScanned && (
          <div className="flex items-center bg-white/20 backdrop-blur-md rounded-2xl p-1">
            <button
              onClick={() => handleZoom(Math.max(zoomRange.min, currentZoom - zoomRange.step * 5))}
              className="p-2 text-white hover:bg-white/10 rounded-xl transition-all"
              disabled={currentZoom <= zoomRange.min}
            >
              <ZoomOut className="h-5 w-5" />
            </button>
            <span className="text-white text-[10px] font-bold w-8 text-center">{currentZoom.toFixed(1)}x</span>
            <button
              onClick={() => handleZoom(Math.min(zoomRange.max, currentZoom + zoomRange.step * 5))}
              className="p-2 text-white hover:bg-white/10 rounded-xl transition-all"
              disabled={currentZoom >= zoomRange.max}
            >
              <ZoomIn className="h-5 w-5" />
            </button>
          </div>
        )}
        <button
          onClick={onClose}
          className="p-3 bg-white/20 text-white rounded-full hover:bg-white/30 transition-all backdrop-blur-md active:scale-90"
        >
          <X className="h-6 w-6" />
        </button>
      </div>
      
      <div className="w-full h-full relative">
        <div 
          ref={scannerContainerRef}
          id={scannerId} 
          className="w-full h-full object-cover" 
        />
        
        {/* Scanning UI Overlays */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {/* Viewfinder area - matching the qrbox logic */}
          <div className="w-[85%] max-w-[500px] h-[20%] max-h-[180px] border-2 border-white/20 rounded-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-red-500 rounded-tl-xl -translate-x-1 -translate-y-1" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-red-500 rounded-tr-xl translate-x-1 -translate-y-1" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-red-500 rounded-bl-xl -translate-x-1 translate-y-1" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-red-500 rounded-br-xl translate-x-1 translate-y-1" />
            
            {/* Animated scan line - Red laser style */}
            {!error && isStarted && !isInitializing && !isScanned && !isPaused && (
              <div className="absolute top-1/2 left-0 w-full h-0.5 bg-red-500 shadow-[0_0_15px_rgba(239,68,68,1)] animate-scan z-10" />
            )}
            
            {/* Background pattern to suggest "reading bars" */}
            <div className="absolute inset-0 opacity-10 flex items-center justify-center">
              <Barcode className="w-full h-full text-white" />
            </div>

            {isPaused && (
              <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center rounded-2xl">
                <div className="bg-amber-500 text-white p-3 rounded-full">
                  <Pause className="h-8 w-8" />
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 text-center px-6">
            {quickUpdate && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="inline-flex items-center space-x-2 bg-green-500/90 backdrop-blur-md px-4 py-1.5 rounded-full mb-3 border border-green-400/50 shadow-lg shadow-green-500/20"
              >
                <Zap className="h-3 w-3 text-white fill-current" />
                <span className="text-white text-[10px] font-bold uppercase tracking-[0.1em]">Quick Update Mode Active</span>
              </motion.div>
            )}
            <div className="inline-flex items-center space-x-2 bg-black/40 backdrop-blur-md px-4 py-1.5 rounded-full mb-4 border border-white/10">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-white text-[10px] font-bold uppercase tracking-[0.2em]">Reading Bars...</span>
            </div>
            <h3 className="text-white text-lg font-bold drop-shadow-md">
              {isPaused ? "Scanner Paused" : "Align Barcode"}
            </h3>
            <p className="text-white/70 text-sm mt-1 drop-shadow-md">
              {isPaused ? "Tap the play button to resume" : "Position the bars within the red frame"}
            </p>
          </div>

          {isScanned && (
            <motion.div 
              initial={{ scale: 0.5, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="absolute bg-white text-gray-900 p-6 rounded-[2rem] shadow-2xl flex flex-col items-center z-50 pointer-events-auto min-w-[280px] border border-gray-100"
            >
              <div className="bg-green-500 text-white p-3 rounded-full mb-4">
                <CheckCircle className="h-8 w-8" />
              </div>
              
              {foundProduct ? (
                <div className="text-center space-y-1">
                  <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Product Found</span>
                  <h4 className="font-bold text-xl leading-tight">{foundProduct.name}</h4>
                  <div className="flex items-center justify-center space-x-2 mt-2">
                    <span className="text-xs font-medium text-gray-500">Current Stock:</span>
                    <span className="text-sm font-bold bg-gray-100 px-2 py-0.5 rounded-lg">{foundProduct.currentStock}</span>
                  </div>
                </div>
              ) : (
                <div className="text-center space-y-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Barcode Detected</span>
                  <h4 className="font-mono font-bold text-lg">{scannedText}</h4>
                  <p className="text-xs text-gray-500 mt-1">Searching inventory...</p>
                </div>
              )}
              
              {continuous && (
                <div className="mt-4 w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 2, ease: "linear" }}
                    className="h-full bg-blue-500"
                  />
                </div>
              )}
            </motion.div>
          )}

          {!isStarted && !error && !isScanned && (
            <div className="p-8 text-center flex flex-col items-center pointer-events-auto bg-black/60 backdrop-blur-sm rounded-3xl m-4 max-w-sm">
              <div className="bg-blue-500/20 p-4 rounded-full mb-4">
                <ScanLine className="h-10 w-10 text-blue-400" />
              </div>
              <p className="text-white font-bold mb-2">Camera Access Required</p>
              <p className="text-white/60 text-sm mb-6">
                We need your permission to use the camera for scanning.
              </p>
              <div className="flex flex-col space-y-3 w-full">
                <button
                  onClick={() => initCameras(true)}
                  className="w-full px-8 py-3 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all active:scale-95 shadow-lg shadow-blue-500/20"
                >
                  Enable Camera
                </button>
                <button
                  onClick={() => setShowManualInput(true)}
                  className="w-full px-8 py-3 bg-white/10 text-white border border-white/20 rounded-2xl font-bold hover:bg-white/20 transition-all active:scale-95"
                >
                  Enter Manually
                </button>
              </div>
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
                  <li>Ensure no other app is using the camera.</li>
                </ol>
              </div>
              <div className="flex flex-col space-y-3 w-full">
                <div className="flex space-x-3 w-full">
                  <button
                    onClick={async () => {
                      setError(null);
                      await stopScanner();
                      initCameras(true);
                    }}
                    className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-colors flex items-center justify-center"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Reset
                  </button>
                  <button
                    onClick={() => startScanner()}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors"
                  >
                    Try Again
                  </button>
                </div>
                
                <button
                  onClick={() => setShowManualInput(true)}
                  className="w-full px-4 py-2 bg-white border border-gray-200 text-gray-600 rounded-xl font-bold hover:bg-gray-50 transition-colors"
                >
                  Enter Barcode Manually
                </button>
              </div>
            </div>
          )}

          {showManualInput && (
            <div className="p-8 text-center flex flex-col items-center pointer-events-auto bg-white rounded-3xl m-4 shadow-2xl max-w-sm w-full">
              <Package className="h-12 w-12 text-blue-500 mb-4" />
              <p className="text-gray-900 font-bold mb-2">Manual Entry</p>
              <p className="text-sm text-gray-500 mb-6">Enter the barcode number printed below the bars.</p>
              
              <input
                type="text"
                autoFocus
                value={manualBarcode}
                onChange={(e) => setManualBarcode(e.target.value)}
                placeholder="e.g. 123456789012"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl mb-4 focus:ring-2 focus:ring-blue-500 outline-none font-mono"
              />
              
              <div className="flex space-x-3 w-full">
                <button
                  onClick={() => setShowManualInput(false)}
                  className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  disabled={!manualBarcode.trim()}
                  onClick={() => {
                    if (manualBarcode.trim()) {
                      onScan(manualBarcode.trim());
                    }
                  }}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  Submit
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Scanner;
