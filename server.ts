import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import twilio from "twilio";
import nodemailer from "nodemailer";
import webpush from "web-push";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
let db: admin.firestore.Firestore | null = null;
try {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  let firebaseConfig: any = null;
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  if (!admin.apps.length) {
    const adminConfig: any = {};
    if (firebaseConfig && firebaseConfig.projectId) {
      adminConfig.projectId = firebaseConfig.projectId;
    }
    admin.initializeApp(adminConfig);
    console.log(`Firebase Admin initialized${adminConfig.projectId ? ` for project: ${adminConfig.projectId}` : " with default credentials"}`);
  }
  
  if (firebaseConfig) {
    const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
    try {
      db = getFirestore(admin.app(), databaseId);
      console.log(`Firestore initialized with database ID: ${databaseId}`);
    } catch (e: any) {
      console.warn(`Could not initialize Firestore with database ID ${databaseId}, falling back to default:`, e.message);
      db = getFirestore(admin.app());
    }
  } else {
    db = getFirestore(admin.app());
    console.log("Firestore initialized with default database");
  }
} catch (error: any) {
  console.error("Failed to initialize Firebase Admin:", error.message);
}

// Push Notification VAPID Keys
let vapidKeys = {
  publicKey: (process.env.VAPID_PUBLIC_KEY || "").replace(/=/g, ""),
  privateKey: (process.env.VAPID_PRIVATE_KEY || "").replace(/=/g, "")
};

async function initializeVapid() {
  console.log("Initializing VAPID for push notifications...");
  
    // Try to get VAPID keys from Firestore if available
    if (db) {
      try {
        const secretDoc = await db.collection("secrets").doc("vapid").get();
        if (secretDoc.exists) {
          const secretData = secretDoc.data();
          if (secretData?.publicKey && secretData?.privateKey) {
            vapidKeys.publicKey = secretData.publicKey.trim();
            vapidKeys.privateKey = secretData.privateKey.trim();
            console.log("Found VAPID keys in Firestore secrets");
          }
        } else {
          console.log("No VAPID keys found in Firestore 'secrets/vapid'.");
        }
      } catch (err: any) {
        console.error("Error fetching VAPID secrets from Firestore:", err.message);
        if (err.message.includes("PERMISSION_DENIED")) {
          console.error("PERMISSION_DENIED: The service account may not have sufficient permissions. Attempting fallback to default database...");
          try {
            const defaultDb = getFirestore(admin.app());
            const fallbackDoc = await defaultDb.collection("secrets").doc("vapid").get();
            if (fallbackDoc.exists) {
              const secretData = fallbackDoc.data();
              if (secretData?.publicKey && secretData?.privateKey) {
                vapidKeys.publicKey = secretData.publicKey.trim();
                vapidKeys.privateKey = secretData.privateKey.trim();
                console.log("Found VAPID keys in default Firestore secrets");
              }
            }
          } catch (fallbackErr: any) {
            console.error("Fallback to default database also failed:", fallbackErr.message);
          }
        }
      }
    }

  // Helper to ensure key is valid Base64 URL-safe and correct length
  const prepareKey = (key: string, expectedLength: number | null = null): Buffer | null => {
    if (!key || typeof key !== 'string') return null;
    
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
      console.log("VAPID keys missing or invalid in environment/Firestore. Generating new ones...");
      const newKeys = webpush.generateVAPIDKeys();
      // Store the generated strings for logging
      const genPub = newKeys.publicKey;
      const genPriv = newKeys.privateKey;
      
      pub = prepareKey(genPub, 65);
      priv = prepareKey(genPriv, 32);
      
      console.log("--- NEW VAPID KEYS GENERATED ---");
      console.log("Public Key:", genPub);
      console.log("Private Key:", genPriv);
      console.log("Please save these to Firestore 'secrets/vapid' to persist them.");
      console.log("--------------------------------");
      
      // Update the global keys so they can be served via API
      vapidKeys = newKeys;
    }

    if (pub && priv) {
      // web-push setVapidDetails expects URL-safe base64 strings
      webpush.setVapidDetails(
        'mailto:Antar7theman@gmail.com',
        pub.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
        priv.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
      );
      console.log("VAPID details set successfully");
    } else {
      throw new Error("Failed to prepare valid VAPID keys even after generation.");
    }
  } catch (error: any) {
    console.error("Failed to set VAPID details:", error.message);
    
    // Final fallback: generate and set immediately with raw generated keys
    try {
      console.log("Attempting final emergency VAPID generation...");
      const finalKeys = webpush.generateVAPIDKeys();
      webpush.setVapidDetails(
        'mailto:Antar7theman@gmail.com',
        finalKeys.publicKey,
        finalKeys.privateKey
      );
      vapidKeys = finalKeys;
      console.log("Emergency VAPID details set successfully");
    } catch (finalError: any) {
      console.error("CRITICAL: All VAPID initialization attempts failed:", finalError.message);
    }
  }
}

// Store push subscriptions in memory for this demo
const pushSubscriptions: any[] = [];

async function startServer() {
  const app = express();
  const PORT = 3000;

  await initializeVapid();

  app.use(express.json());

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // SMS Route
  app.post("/api/send-sms", async (req, res) => {
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: "Missing 'to' or 'message' field" });
    }

    const accountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
    const authToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
    const fromRaw = (process.env.TWILIO_PHONE_NUMBER || "").trim();
    const from = fromRaw.startsWith('+') ? fromRaw : `+${fromRaw.replace(/\D/g, '')}`;

    if (!accountSid || !authToken || !fromRaw) {
      console.error("Twilio credentials missing or empty in environment variables");
      return res.status(500).json({ 
        error: "SMS service not configured", 
        details: "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER is missing." 
      });
    }

    try {
      const client = twilio(accountSid, authToken);
      // Ensure 'to' is also trimmed and formatted
      const formattedTo = to.trim().startsWith('+') ? to.trim() : `+${to.trim().replace(/\D/g, '')}`;
      
      const result = await client.messages.create({
        body: message,
        from: from,
        to: formattedTo
      });
      console.log(`SMS sent successfully: ${result.sid}`);
      res.json({ success: true, sid: result.sid });
    } catch (error: any) {
      const errorCode = error?.code || 'Unknown';
      const errorStatus = error?.status || 500;
      const errorMessage = error?.message || 'An unexpected error occurred with Twilio';
      const errorMoreInfo = error?.moreInfo || 'https://www.twilio.com/docs/errors';

      console.error("Twilio SMS Error Details:", {
        code: errorCode,
        status: errorStatus,
        message: errorMessage,
        moreInfo: errorMoreInfo
      });

      const errorMap: Record<string | number, string> = {
        20003: "Authentication Failed: Please check your Twilio Account SID and Auth Token.",
        21211: "Invalid Phone Number: The 'To' number is not a valid phone number.",
        21408: "Permission Denied: You don't have permission to send to this region.",
        21608: "Twilio Trial Limit: You can only send to verified numbers with a trial account. Please verify the number in your Twilio Console.",
        21610: "Unsubscribed: The recipient has opted out of receiving messages.",
        21614: "Invalid 'To' Number: The number is not a valid mobile number.",
        20404: "Resource Not Found: The Twilio phone number might be incorrect.",
      };

      const userFriendlyMessage = errorMap[errorCode] || `Twilio Error (${errorCode}): ${errorMessage}`;
      
      res.status(errorStatus).json({ 
        error: "Failed to send SMS", 
        details: userFriendlyMessage,
        code: errorCode 
      });
    }
  });

  // Email Route (Gmail)
  app.post("/api/send-email", async (req, res) => {
    const { to, subject, message } = req.body;

    if (!to || !subject || !message) {
      return res.status(400).json({ error: "Missing 'to', 'subject', or 'message' field" });
    }

    const gmailUser = process.env.GMAIL_USER;
    let gmailPass = process.env.GMAIL_PASS;

    // Try to get Gmail pass from Firestore if available
    if (db) {
      try {
        const secretDoc = await db.collection("secrets").doc("gmail").get();
        if (secretDoc.exists) {
          const secretData = secretDoc.data();
          if (secretData?.pass) {
            gmailPass = secretData.pass;
            console.log("Using Gmail App Password from Firestore secrets");
          }
        }
      } catch (err: any) {
        console.error("Error fetching secrets from Firestore:", err.message);
        if (err.message.includes("PERMISSION_DENIED")) {
          console.error("PERMISSION_DENIED: The service account may not have 'Cloud Datastore User' or 'Firebase Admin' permissions for the database.");
        }
      }
    }

    if (!gmailUser || !gmailPass) {
      console.error("Gmail credentials missing in environment variables");
      return res.status(500).json({ error: "Email service not configured" });
    }

    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: gmailUser,
          pass: gmailPass
        }
      });

      const mailOptions = {
        from: gmailUser,
        to: to,
        subject: subject,
        text: message
      };

      await transporter.sendMail(mailOptions);
      console.log(`Email sent successfully to ${to}`);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Failed to send email:", error);
      let errorMessage = "Failed to send email";
      let details = error.message;

      if (error.message.includes("534-5.7.9") || error.message.includes("Application-specific password required")) {
        errorMessage = "Gmail App Password Required";
        details = "The password provided is your regular Gmail password. You MUST generate a 16-character 'App Password' in your Google Account Security settings to allow this app to send emails. Go to: https://myaccount.google.com/apppasswords";
        console.error("CRITICAL: Gmail App Password required. Regular password will not work.");
      } else if (error.message.includes("Invalid login") || error.message.includes("auth")) {
        errorMessage = "Invalid Gmail Credentials";
        details = "The Gmail username or App Password is incorrect. Please check your Settings and ensure you are using a 16-character App Password.";
      }
      
      res.status(500).json({ error: errorMessage, details: details });
    }
  });

  // Push Notification Routes
  app.get("/api/push-key", (req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
  });

  app.post("/api/push-subscribe", (req, res) => {
    const subscription = req.body;
    // Check if already exists
    const exists = pushSubscriptions.find(s => s.endpoint === subscription.endpoint);
    if (!exists) {
      pushSubscriptions.push(subscription);
    }
    res.status(201).json({});
  });

  app.post("/api/send-push", async (req, res) => {
    const { title, message } = req.body;

    const payload = JSON.stringify({
      title: title || "Inventory Alert",
      body: message
    });

    const results = await Promise.all(pushSubscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload);
        return { success: true };
      } catch (error: any) {
        console.error("Push failed for subscription:", sub.endpoint, error.message);
        if (error.statusCode === 410 || error.statusCode === 404) {
          // Subscription expired or no longer valid
          const index = pushSubscriptions.indexOf(sub);
          if (index > -1) pushSubscriptions.splice(index, 1);
        }
        return { success: false, error: error.message };
      }
    }));

    res.json({ success: true, results });
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
