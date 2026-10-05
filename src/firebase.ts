import { initializeApp } from 'firebase/app';
import { getAuth, indexedDBLocalPersistence, setPersistence } from 'firebase/auth';
import { 
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  setLogLevel,
  doc,
  getDocFromServer
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

// Matikan log internal SDK @firebase/firestore agar saat kuota harian Free Tier habis,
// WebChannel tidak membanjiri console dengan error backoff berulang setiap 60 detik.
try {
  setLogLevel('silent');
} catch (e) {}

// Fallback konfigurasi Firebase default yang valid apabila saat baru di-Remix
// file firebase-applet-config.json masih berisi teks placeholder ("REMPLACE_WITH_...") dari AI Studio
const DEFAULT_FALLBACK_FIREBASE_CONFIG = {
  projectId: 'gen-lang-client-0128225621',
  appId: '1:286912912449:web:d555e762c519fef72b3ac0',
  apiKey: 'AIzaSyBhFi3hHNT3FlcLYpnWBMjancgt8Nifluw',
  authDomain: 'gen-lang-client-0128225621.firebaseapp.com',
  firestoreDatabaseId: 'ai-studio-remixremixnewapl-66b126f6-b5a3-49f9-9e48-f8f855eca361',
  storageBucket: 'gen-lang-client-0128225621.firebasestorage.app',
  messagingSenderId: '286912912449',
};

const isValidFirebaseConfigValue = (val: unknown): val is string => {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  const upper = trimmed.toUpperCase();
  if (
    upper.includes('REMPLACE_') ||
    upper.includes('REPLACE_') ||
    upper.includes('YOUR_') ||
    upper.includes('PLACEHOLDER') ||
    upper === 'TODO' ||
    upper === 'UNDEFINED' ||
    upper === 'NULL'
  ) {
    return false;
  }
  return true;
};

const pickConfigValue = (primary: unknown, envVal: unknown, fallback: string): string => {
  if (isValidFirebaseConfigValue(primary)) return primary.trim();
  if (isValidFirebaseConfigValue(envVal)) return envVal.trim();
  return fallback;
};

// Prioritaskan firebase-applet-config.json jika valid (bukan placeholder Remix),
// dan otomatis fallback ke konfigurasi yang valid agar saat Remix maupun Restore tidak pernah error.
const activeFirebaseConfig = {
  apiKey: pickConfigValue(firebaseConfig.apiKey, import.meta.env?.VITE_FIREBASE_API_KEY, DEFAULT_FALLBACK_FIREBASE_CONFIG.apiKey),
  authDomain: pickConfigValue(firebaseConfig.authDomain, import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN, DEFAULT_FALLBACK_FIREBASE_CONFIG.authDomain),
  projectId: pickConfigValue(firebaseConfig.projectId, import.meta.env?.VITE_FIREBASE_PROJECT_ID, DEFAULT_FALLBACK_FIREBASE_CONFIG.projectId),
  storageBucket: pickConfigValue(firebaseConfig.storageBucket, import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET, DEFAULT_FALLBACK_FIREBASE_CONFIG.storageBucket),
  messagingSenderId: pickConfigValue(firebaseConfig.messagingSenderId, import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID, DEFAULT_FALLBACK_FIREBASE_CONFIG.messagingSenderId),
  appId: pickConfigValue(firebaseConfig.appId, import.meta.env?.VITE_FIREBASE_APP_ID, DEFAULT_FALLBACK_FIREBASE_CONFIG.appId),
  measurementId: isValidFirebaseConfigValue(firebaseConfig.measurementId)
    ? firebaseConfig.measurementId.trim()
    : (isValidFirebaseConfigValue(import.meta.env?.VITE_FIREBASE_MEASUREMENT_ID) ? String(import.meta.env?.VITE_FIREBASE_MEASUREMENT_ID).trim() : ''),
};

const firestoreDbId = pickConfigValue(
  (firebaseConfig as any).firestoreDatabaseId,
  import.meta.env?.VITE_FIREBASE_DATABASE_ID,
  DEFAULT_FALLBACK_FIREBASE_CONFIG.firestoreDatabaseId
);

const app = initializeApp(activeFirebaseConfig);

// Gunakan initializeFirestore dengan memoryLocalCache() eksplisit agar tidak memicu bug IndexedDB
// multi-tab coordination / lease acquisition di iframe AI Studio yang menyebabkan FIRESTORE (11.0.1) INTERNAL ASSERTION FAILED: Unexpected state.
export const db = (() => {
  try {
    return initializeFirestore(app, {
      localCache: memoryLocalCache(),
    }, firestoreDbId);
  } catch (e) {
    return getFirestore(app, firestoreDbId);
  }
})();

// Validasi koneksi awal ke Firestore sesuai standar skill
(async () => {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    // Normal jika dokumen tidak ada atau offline
  }
})();

const QUOTA_COOLDOWN_KEY = 'smpn2_firestore_quota_exhausted_until';
let quotaExhaustedInMemory = false;

export const resetFirestoreQuotaCooldown = (): void => {
  quotaExhaustedInMemory = false;
  try {
    sessionStorage.removeItem(QUOTA_COOLDOWN_KEY);
  } catch (e) {}
};

export const isFirestoreQuotaExhausted = (): boolean => {
  if (quotaExhaustedInMemory) return true;
  try {
    const until = Number(sessionStorage.getItem(QUOTA_COOLDOWN_KEY) || 0);
    if (until > Date.now()) {
      quotaExhaustedInMemory = true;
      return true;
    }
  } catch (e) {}
  return false;
};

export const markFirestoreQuotaExhausted = (): void => {
  quotaExhaustedInMemory = true;
  try {
    // Cooldown 30 menit di sesi browser ini agar aplikasi fokus ke Google Spreadsheet + Cache Lokal
    // Catatan: Jangan memanggil disableNetwork(db) saat listener aktif karena memicu bug Internal Assertion di Firestore 11.0.1
    sessionStorage.setItem(QUOTA_COOLDOWN_KEY, String(Date.now() + 30 * 60 * 1000));
  } catch (e) {}
};

export const checkAndHandleQuotaError = (err: any): boolean => {
  if (!err) return false;
  const code = String(err?.code || '').toLowerCase();
  const msg = String(err?.message || err || '').toLowerCase();
  if (
    code.includes('resource-exhausted') ||
    code.includes('resource_exhausted') ||
    msg.includes('resource-exhausted') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('free daily read units') ||
    msg.includes('free tier database') ||
    msg.includes('quota limit exceeded')
  ) {
    markFirestoreQuotaExhausted();
    return true;
  }
  return false;
};

export const auth = getAuth(app);

// Set persistence to indexedDB
setPersistence(auth, indexedDBLocalPersistence).catch(err => {
  console.warn("Auth persistence notice:", err);
});

export const storage = getStorage(app);

export default app;
