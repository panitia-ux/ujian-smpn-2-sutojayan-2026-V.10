import { db } from '../firebase';
import { doc, setDoc, onSnapshot, collection, serverTimestamp } from 'firebase/firestore';

export interface SupervisorPresenceRecord {
  uid?: string;
  email: string;
  name: string;
  ruang?: string;
  role?: string;
  lastActiveMs: number;
  isOnline: boolean;
  manualOverride?: boolean;
}

const PRESENCE_STORAGE_KEY = 'active_supervisors_presence';
const MANUAL_ONLINE_KEY = 'manual_online_supervisors';
const BROADCAST_CHANNEL_NAME = 'smpn2_supervisor_presence';

export const normalizeSupervisorEmail = (email?: string): string => {
  return String(email || '').toLowerCase().trim();
};

export const normalizeSupervisorName = (name?: string): string => {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const sanitizeDocId = (email: string, uid?: string): string => {
  const norm = normalizeSupervisorEmail(email);
  if (norm) {
    return norm.replace(/[^a-z0-9]/g, '_');
  }
  return String(uid || 'anon_sup').replace(/[^a-z0-9]/g, '_');
};

let broadcastChannelInstance: BroadcastChannel | null = null;
const getBroadcastChannel = (): BroadcastChannel | null => {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!broadcastChannelInstance) {
    try {
      broadcastChannelInstance = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    } catch (e) {
      console.warn('BroadcastChannel not supported in this environment');
    }
  }
  return broadcastChannelInstance;
};

// Baca snapshot cache lokal seketika (0ms)
export const getCachedSupervisorsPresence = (): Record<string, SupervisorPresenceRecord> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PRESENCE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (e) {}
  return {};
};

export const getManualOnlineSupervisors = (): Set<string> => {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(MANUAL_ONLINE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.map(e => normalizeSupervisorEmail(e)));
      }
    }
  } catch (e) {}
  return new Set();
};

export const setManualOnlineSupervisor = (email: string, isOnline: boolean) => {
  const normEmail = normalizeSupervisorEmail(email);
  if (!normEmail) return;

  const current = getManualOnlineSupervisors();
  if (isOnline) {
    current.add(normEmail);
  } else {
    current.delete(normEmail);
  }

  try {
    localStorage.setItem(MANUAL_ONLINE_KEY, JSON.stringify(Array.from(current)));
  } catch (e) {}

  // Catat ke presence
  recordSupervisorPresence({
    email: normEmail,
    name: normEmail,
    ruang: 'Semua Ruang'
  }, isOnline, true);
};

let lastFirestoreSyncTimestamp = 0;

/**
 * Catat atau perbarui kehadiran pengawas (Heartbeat / Aktivasi Online).
 * Menyimpan ke:
 * 1. LocalStorage (seketika 0ms untuk tab lokal)
 * 2. BroadcastChannel (seketika 0ms antar tab/jendela di browser sama)
 * 3. Firestore collection `supervisors_presence` (untuk sinkronisasi real-time antar perangkat)
 */
export const recordSupervisorPresence = (
  sup: {
    email?: string;
    name?: string;
    uid?: string;
    ruang?: string;
    role?: string;
  },
  isOnline: boolean = true,
  isManualOverride: boolean = false
) => {
  const normEmail = normalizeSupervisorEmail(sup.email);
  const normName = String(sup.name || sup.email || 'Pengawas').trim();
  const uid = String(sup.uid || '');
  const now = Date.now();

  if (!normEmail && !uid && !normName) return;

  const record: SupervisorPresenceRecord = {
    email: normEmail,
    name: normName,
    uid: uid || undefined,
    ruang: sup.ruang || '-',
    role: sup.role || 'pengawas',
    lastActiveMs: now,
    isOnline,
    manualOverride: isManualOverride
  };

  // 1. Simpan ke LocalStorage
  try {
    const presenceMap = getCachedSupervisorsPresence();
    const primaryKey = normEmail || uid || normalizeSupervisorName(normName);
    presenceMap[primaryKey] = record;
    if (normEmail) presenceMap[normEmail] = record;
    if (uid) presenceMap[uid] = record;
    if (normName) presenceMap[normalizeSupervisorName(normName)] = record;

    localStorage.setItem(PRESENCE_STORAGE_KEY, JSON.stringify(presenceMap));
  } catch (e) {}

  // 2. Siarkan via BroadcastChannel
  try {
    const ch = getBroadcastChannel();
    if (ch) {
      ch.postMessage({
        type: 'SUPERVISOR_PRESENCE_UPDATE',
        record,
        timestamp: now
      });
    }
  } catch (e) {}

  // 3. Sinkronkan ke Firestore (Throttle 15 detik jika otomatis, langsung jika manual override)
  const shouldSyncFirestore = isManualOverride || (now - lastFirestoreSyncTimestamp > 15000);
  if (shouldSyncFirestore && normEmail) {
    lastFirestoreSyncTimestamp = now;
    const docId = sanitizeDocId(normEmail, uid);
    try {
      const docRef = doc(db, 'supervisors_presence', docId);
      setDoc(docRef, {
        email: normEmail,
        name: normName,
        uid: uid || null,
        ruang: sup.ruang || '-',
        role: sup.role || 'pengawas',
        lastActiveMs: now,
        isOnline,
        manualOverride: isManualOverride,
        updatedAt: serverTimestamp()
      }, { merge: true }).catch((err) => {
        console.warn('Benign Firestore presence sync note:', err?.message);
      });
    } catch (e) {}
  }
};

/**
 * Pasang listener presence terpadu:
 * Memadukan Firestore Realtime + BroadcastChannel + LocalStorage Event
 */
export const listenSupervisorsPresence = (
  onUpdate: (presenceMap: Record<string, SupervisorPresenceRecord>) => void
): (() => void) => {
  let localMap = getCachedSupervisorsPresence();
  onUpdate(localMap);

  // 1. BroadcastChannel Listener
  const ch = getBroadcastChannel();
  const handleBroadcast = (evt: MessageEvent) => {
    if (evt.data?.type === 'SUPERVISOR_PRESENCE_UPDATE' && evt.data?.record) {
      const rec: SupervisorPresenceRecord = evt.data.record;
      localMap = {
        ...localMap,
        ...(rec.email ? { [rec.email]: rec } : {}),
        ...(rec.uid ? { [rec.uid]: rec } : {}),
        ...(rec.name ? { [normalizeSupervisorName(rec.name)]: rec } : {})
      };
      onUpdate({ ...localMap });
    }
  };

  if (ch) {
    ch.addEventListener('message', handleBroadcast);
  }

  // 2. Storage event (jika tab lain mengupdate localStorage)
  const handleStorage = (evt: StorageEvent) => {
    if (evt.key === PRESENCE_STORAGE_KEY && evt.newValue) {
      try {
        const parsed = JSON.parse(evt.newValue);
        if (parsed && typeof parsed === 'object') {
          localMap = { ...localMap, ...parsed };
          onUpdate({ ...localMap });
        }
      } catch (e) {}
    }
  };
  window.addEventListener('storage', handleStorage);

  // 3. Firestore Real-time onSnapshot Listener
  let fsUnsub = () => {};
  try {
    fsUnsub = onSnapshot(collection(db, 'supervisors_presence'), (snapshot) => {
      const updated: Record<string, SupervisorPresenceRecord> = { ...localMap };
      snapshot.docs.forEach((d) => {
        const data = d.data() as any;
        if (data && (data.email || data.name)) {
          const rec: SupervisorPresenceRecord = {
            email: normalizeSupervisorEmail(data.email),
            name: data.name || '',
            uid: data.uid || undefined,
            ruang: data.ruang || '-',
            role: data.role || 'pengawas',
            lastActiveMs: typeof data.lastActiveMs === 'number' ? data.lastActiveMs : Date.now(),
            isOnline: data.isOnline !== false,
            manualOverride: Boolean(data.manualOverride)
          };
          if (rec.email) updated[rec.email] = rec;
          if (rec.uid) updated[rec.uid] = rec;
          if (rec.name) updated[normalizeSupervisorName(rec.name)] = rec;
        }
      });
      localMap = updated;
      try {
        localStorage.setItem(PRESENCE_STORAGE_KEY, JSON.stringify(localMap));
      } catch (e) {}
      onUpdate({ ...localMap });
    }, (err) => {
      console.warn('Firestore supervisors_presence listener benign note:', err?.message);
    });
  } catch (e) {}

  // 4. Periodik interval untuk merefresh status timeout (setiap 10 detik)
  const intervalId = window.setInterval(() => {
    onUpdate({ ...localMap });
  }, 10000);

  return () => {
    if (ch) ch.removeEventListener('message', handleBroadcast);
    window.removeEventListener('storage', handleStorage);
    fsUnsub();
    window.clearInterval(intervalId);
  };
};

/**
 * Pengecekan cerdas apakah pengawas tertentu sedang Online
 */
export const checkIsSupervisorOnline = (
  supervisor: {
    email?: string;
    uid?: string;
    name?: string;
    username?: string;
    id?: string;
  },
  presenceMap: Record<string, SupervisorPresenceRecord>,
  sessionContext: {
    currentUserEmail?: string;
    currentUserId?: string;
    currentUserName?: string;
    effectiveEmail?: string;
    simulatedEmail?: string;
    manualOnlineEmails?: Set<string>;
  }
): boolean => {
  const sEmail = normalizeSupervisorEmail(supervisor.email);
  const sUid = String(supervisor.uid || supervisor.id || '').trim();
  const sName = normalizeSupervisorName(supervisor.name || supervisor.username);

  // 1. Cek kecocokan sesi saat ini (Current Session / Simulation)
  const activeSim = normalizeSupervisorEmail(sessionContext.simulatedEmail);
  const curEmail = normalizeSupervisorEmail(sessionContext.currentUserEmail);
  const effEmail = normalizeSupervisorEmail(sessionContext.effectiveEmail);

  if (sEmail) {
    if (activeSim && sEmail === activeSim) return true;
    if (curEmail && sEmail === curEmail) return true;
    if (effEmail && sEmail === effEmail) return true;
  }

  // 2. Cek manual override
  if (sessionContext.manualOnlineEmails && sEmail && sessionContext.manualOnlineEmails.has(sEmail)) {
    return true;
  }

  // 3. Cek data kehadiran (Presence record)
  const pres = (sEmail ? presenceMap[sEmail] : null) ||
               (sUid ? presenceMap[sUid] : null) ||
               (sName ? presenceMap[sName] : null);

  if (pres) {
    if (pres.manualOverride && pres.isOnline) return true;
    if (pres.isOnline !== false) {
      const now = Date.now();
      // Aktif dalam 10 menit terakhir dianggap Online
      if (typeof pres.lastActiveMs === 'number' && now - pres.lastActiveMs < 10 * 60 * 1000) {
        return true;
      }
    }
  }

  return false;
};
