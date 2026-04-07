import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import webpush from "web-push";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import cors from "cors";
import nodemailer from "nodemailer";
import twilio from "twilio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
let dbPromise: Promise<admin.firestore.Firestore> | null = null;
try {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  let firebaseConfig: any = null;
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  if (!admin.apps.length) {
    const options: admin.AppOptions = {};
    // Prioritize config project ID as it's explicitly set by set_up_firebase
    if (firebaseConfig?.projectId) {
      options.projectId = firebaseConfig.projectId;
      console.log(`Using config project ID: ${firebaseConfig.projectId}`);
    } else {
      const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
      if (envProjectId) {
        options.projectId = envProjectId;
        console.log(`Using environment project ID: ${envProjectId}`);
      }
    }
    admin.initializeApp(options);
    console.log(`Firebase Admin initialized. Project ID: ${admin.app().options.projectId}`);
  }
  
  const currentProjectId = admin.app().options.projectId;
  const configProjectId = firebaseConfig?.projectId;
  
  if (configProjectId && currentProjectId && configProjectId !== currentProjectId) {
    console.warn(`Project ID mismatch! Config: ${configProjectId}, Current: ${currentProjectId}. This is common in remixed apps.`);
  }

  // Try to use the configured database ID if it exists
  const databaseId = firebaseConfig?.firestoreDatabaseId;
  const initializeFirestore = async (dbId?: string): Promise<admin.firestore.Firestore> => {
    const projectId = admin.app().options.projectId;
    console.log(`Attempting to initialize Firestore. Project: ${projectId}, Database: ${dbId || '(default)'}`);
    
    try {
      const firestore = dbId ? getFirestore(admin.app(), dbId) : getFirestore(admin.app());
      // Test the connection with a simple get
      await firestore.collection('health-check').limit(1).get();
      console.log(`Firestore initialized successfully. Project: ${projectId}, Database: ${firestore.databaseId}`);
      return firestore;
    } catch (e: any) {
      const isNotFound = e.message.includes('NOT_FOUND') || e.code === 5;
      
      if (dbId) {
        console.warn(`Firestore initialization failed for database ID "${dbId}" in project "${projectId}": ${e.message}. Falling back to default database.`);
        // If the custom database ID fails, try the default one
        return initializeFirestore();
      }
      
      if (isNotFound) {
        const errorMsg = `CRITICAL: Firestore database not found in project "${projectId}". Please ensure a database is provisioned.`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      } else {
        console.error(`Firestore initialization failed for default database in project "${projectId}":`, e.message);
        throw e;
      }
    }
  };

  dbPromise = initializeFirestore(databaseId).catch(err => {
    console.error("Final Firestore initialization failure:", err.message);
    return null as any; // Allow server to start but DB operations will fail gracefully
  });
  dbPromise.then(firestore => {
    // Initialize VAPID after DB is ready
    initializeVapid(firestore).catch(err => console.error("Background VAPID initialization failed:", err));
  });
} catch (error: any) {
  console.error("Failed to initialize Firebase Admin:", error.message);
}

// Push Notification VAPID Keys
let vapidKeys = {
  publicKey: (process.env.VAPID_PUBLIC_KEY || "").replace(/=/g, ""),
  privateKey: (process.env.VAPID_PRIVATE_KEY || "").replace(/=/g, "")
};

async function initializeVapid(db: admin.firestore.Firestore) {
  console.log("Initializing VAPID for push notifications...");
  
  // Try to get VAPID keys from Firestore if available
  try {
    // Set a timeout for the Firestore fetch to prevent blocking server start indefinitely
    const fetchPromise = db.collection("secrets").doc("vapid").get();
    const timeoutPromise = new Promise<null>((_, reject) => 
      setTimeout(() => reject(new Error("Firestore timeout")), 5000)
    );

    const secretDoc = await Promise.race([fetchPromise, timeoutPromise]) as admin.firestore.DocumentSnapshot;
    
    if (secretDoc && secretDoc.exists) {
      const secretData = secretDoc.data();
      if (secretData?.publicKey && secretData?.privateKey) {
        vapidKeys.publicKey = secretData.publicKey.trim();
        vapidKeys.privateKey = secretData.privateKey.trim();
        console.log("Found VAPID keys in Firestore secrets");
      }
    }
  } catch (err: any) {
    console.warn("Note: Could not fetch VAPID secrets from Firestore:", err.message);
  }

  // Helper to ensure key is valid Base64 URL-safe and correct length
  const prepareKey = (key: string, expectedLength: number | null = null): Buffer | null => {
    if (!key || typeof key !== 'string' || key.length === 0) return null;
    
    try {
      // Normalize to standard Base64
      let normalized = key.trim().replace(/-/g, '+').replace(/_/g, '/');
      // Add padding if missing
      while (normalized.length % 4 !== 0) {
        normalized += '=';
      }
      
      const buffer = Buffer.from(normalized, 'base64');
      
      if (expectedLength && buffer.length !== expectedLength) {
        console.warn(`Key length mismatch: expected ${expectedLength} bytes, got ${buffer.length} bytes.`);
        return null;
      }
      return buffer;
    } catch (e) {
      console.warn("Failed to decode key:", e);
      return null;
    }
  };

  try {
    let pub = prepareKey(vapidKeys.publicKey, 65);
    let priv = prepareKey(vapidKeys.privateKey, 32);

    if (!pub || !priv) {
      console.log("VAPID keys missing or invalid. Generating new ones...");
      const newKeys = webpush.generateVAPIDKeys();
      const genPub = newKeys.publicKey;
      const genPriv = newKeys.privateKey;
      
      pub = prepareKey(genPub, 65);
      priv = prepareKey(genPriv, 32);
      
      console.log("--- NEW VAPID KEYS GENERATED ---");
      vapidKeys = newKeys;

      // Auto-save to Firestore if possible
      if (db) {
        try {
          await db.collection("secrets").doc("vapid").set({
            publicKey: genPub,
            privateKey: genPriv,
            updatedAt: admin.firestore.Timestamp.now()
          }, { merge: true });
          console.log("Auto-saved new VAPID keys to Firestore");
        } catch (saveErr: any) {
          console.warn("Failed to auto-save VAPID keys:", saveErr.message);
        }
      }
    }

    if (pub && priv) {
      webpush.setVapidDetails(
        'mailto:Antar7theman@gmail.com',
        pub.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
        priv.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
      );
      console.log("VAPID details set successfully. Public Key Length:", vapidKeys.publicKey.length);
    } else {
      throw new Error("Failed to prepare valid VAPID keys.");
    }
  } catch (error: any) {
    console.error("Failed to set VAPID details:", error.message);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/test", (req, res) => {
    res.json({ message: "API is working!" });
  });

  // Push Notification Routes
  app.get("/api/push-key", (req, res) => {
    if (!vapidKeys.publicKey) {
      console.warn("Push key requested but not yet initialized");
      return res.status(503).json({ error: "VAPID keys are still initializing. Please try again in a few seconds." });
    }
    res.json({ publicKey: vapidKeys.publicKey });
  });

  app.get("/api/admin/vapid-keys", async (req, res) => {
    // In a production app, we would verify the Firebase ID token here.
    // For this environment, we'll provide the keys to the frontend which handles admin checks.
    if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
      return res.status(503).json({ error: "VAPID keys not yet initialized" });
    }
    res.json(vapidKeys);
  });

  app.post("/api/push-subscribe", async (req, res) => {
    console.log("Received push subscription request");
    const subscription = req.body;
    if (!dbPromise) return res.status(500).json({ error: "Database not initialized" });

    try {
      const db = await dbPromise;
      if (!db) return res.status(500).json({ error: "Database not available" });
      
      if (!subscription || !subscription.endpoint) {
        return res.status(400).json({ error: "Invalid subscription data" });
      }
      
      // Use endpoint as a unique ID (hashed or encoded if needed, but Firestore IDs can be strings)
      const subscriptionId = Buffer.from(subscription.endpoint).toString('base64').replace(/\//g, '_').replace(/\+/g, '-');
      
      await db.collection("pushSubscriptions").doc(subscriptionId).set({
        ...subscription,
        updatedAt: admin.firestore.Timestamp.now()
      });
      
      console.log("Successfully saved subscription for:", subscription.endpoint, "Database:", db.databaseId);
      res.status(201).json({ success: true });
    } catch (error: any) {
      const db = dbPromise ? await dbPromise.catch(() => null) : null;
      console.error("Failed to save subscription:", error.message);
      res.status(500).json({ 
        error: error.message,
        code: error.code,
        dbId: db?.databaseId
      });
    }
  });

  app.post("/api/send-push", async (req, res) => {
    console.log("Received send-push request:", req.body);
    const { title, message } = req.body;
    if (!dbPromise) {
      console.warn("Database not initialized for send-push");
      return res.status(500).json({ error: "Database not initialized" });
    }

    const payload = JSON.stringify({
      title: title || "Inventory Alert",
      body: message
    });

    try {
      const db = await dbPromise;
      if (!db) throw new Error("Firestore database not available");
      
      const snapshot = await db.collection("pushSubscriptions").get();
      const subscriptions = snapshot.docs.map(doc => doc.data());
      console.log(`Sending push to ${subscriptions.length} subscribers. Database: ${db.databaseId}`);

      const results = await Promise.all(subscriptions.map(async (sub: any) => {
        try {
          if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
            throw new Error("VAPID keys not initialized");
          }
          await webpush.sendNotification(sub, payload);
          return { success: true };
        } catch (error: any) {
          console.error("Push failed for subscription:", sub.endpoint, error.message);
          if (error.statusCode === 410 || error.statusCode === 404) {
            // Subscription expired or no longer valid
            const subscriptionId = Buffer.from(sub.endpoint).toString('base64').replace(/\//g, '_').replace(/\+/g, '-');
            await db.collection("pushSubscriptions").doc(subscriptionId).delete().catch(() => {});
          }
          return { success: false, error: error.message };
        }
      }));

      res.json({ success: true, results });
    } catch (error: any) {
      const db = dbPromise ? await dbPromise.catch(() => null) : null;
      console.error("Failed to send push notifications:", error.message);
      
      let errorMsg = error.message;
      if (error.code === 5 || error.message.includes('NOT_FOUND')) {
        errorMsg = `Database not found (5 NOT_FOUND). Please ensure your Firestore database is provisioned and the ID is correct. Current DB: ${db?.databaseId || 'unknown'}`;
      }

      console.error("Error details:", {
        code: error.code,
        details: error.details,
        dbId: db?.databaseId
      });
      res.status(500).json({ 
        error: errorMsg, 
        code: error.code,
        dbId: db?.databaseId
      });
    }
  });

  app.post("/api/test-push", async (req, res) => {
    const { subscription, title, message } = req.body;

    const payload = JSON.stringify({
      title: title || "Test Notification",
      body: message || "This is a test push notification from ATR Store."
    });

    try {
      if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
        throw new Error("VAPID keys not initialized");
      }
      await webpush.sendNotification(subscription, payload);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Test push failed:", error.message);
      if (error.statusCode) {
        console.error("Push service error details:", {
          statusCode: error.statusCode,
          body: error.body,
          headers: error.headers
        });
        res.status(error.statusCode).json({ 
          error: error.message,
          details: error.body,
          statusCode: error.statusCode
        });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });

  app.post("/api/send-email", async (req, res) => {
    const { to, subject, text, html, gmailUser, gmailPass } = req.body;
    
    if (!gmailUser || !gmailPass) {
      return res.status(400).json({ error: "Gmail credentials missing" });
    }

    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: gmailUser,
          pass: gmailPass
        }
      });

      await transporter.sendMail({
        from: `"ATR Store" <${gmailUser}>`,
        to,
        subject,
        text,
        html
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Email failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/send-sms", async (req, res) => {
    const { to, message, twilioSid, twilioAuthToken, twilioFromNumber } = req.body;

    if (!twilioSid || !twilioAuthToken || !twilioFromNumber) {
      return res.status(400).json({ error: "Twilio credentials missing" });
    }

    try {
      const client = twilio(twilioSid, twilioAuthToken);
      await client.messages.create({
        body: message,
        from: twilioFromNumber,
        to
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("SMS failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
