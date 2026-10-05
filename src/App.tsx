/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthProvider, useAuth } from './AuthContext';
import Dashboard from './Dashboard';
import RegistrationOnboarding from './RegistrationOnboarding';
import { Shield, LogIn, Mail, Lock, User, ArrowRight, AlertCircle, AlertTriangle, RefreshCw, CheckCircle2, Database, Eye, EyeOff } from 'lucide-react';
import * as React from 'react';
import { useState, ErrorInfo, ReactNode, Component, useEffect } from 'react';
import { db } from './firebase';
import { doc, getDoc, getDocs, setDoc, collection, query, where, limit } from 'firebase/firestore';
import { isSuperAdminEmail } from './lib/adminConfig';
import { DEFAULT_CLASSES } from './lib/classConstants';
import { fetchMasterFromSpreadsheet, SpreadsheetSyncResult, saveSpreadsheetUrlLocally, getSavedSpreadsheetUrl, getBundledAppSettings, sanitizeAppSettingsWithDefaults, getBundledUsers, seedBundledDataToFirestoreIfEmpty, getUpdatedUsersLocally, saveUpdatedUserLocally, isDemoUserRecord, canUseInitialOneTimeDemoAdmin, markOneTimeDemoAdminUsed, purgeDemoAccountsEverywhere } from './lib/spreadsheetService';

const withQuickTimeout = <T,>(promise: Promise<T>, ms = 2500): Promise<T | null> =>
  Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))
  ]);

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState;
  public props: ErrorBoundaryProps;
  
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.props = props;
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const msg = String(error?.message || error || '').toLowerCase();
    if (
      msg.includes('internal assertion failed') ||
      msg.includes('unexpected state') ||
      msg.includes('quota') ||
      msg.includes('resource-exhausted') ||
      msg.includes('resource_exhausted') ||
      msg.includes('firestore_timeout') ||
      msg.includes('failed-precondition')
    ) {
      console.warn("Ignored Firestore benign internal error in ErrorBoundary:", error?.message);
      return { hasError: false, error: null };
    }
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const msg = String(error?.message || error || '').toLowerCase();
    if (
      msg.includes('internal assertion failed') ||
      msg.includes('unexpected state') ||
      msg.includes('quota') ||
      msg.includes('resource-exhausted') ||
      msg.includes('resource_exhausted') ||
      msg.includes('firestore_timeout') ||
      msg.includes('failed-precondition')
    ) {
      console.warn("Benign Firestore assertion caught and bypassed safely:", error?.message);
      return;
    }
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Terjadi kesalahan sistem. Silakan muat ulang halaman.";
      try {
        const parsed = JSON.parse(this.state.error?.message || '');
        if (parsed.error && parsed.operationType) {
          displayMessage = `Kesalahan Database (${parsed.operationType}): ${parsed.error}. Hubungi Admin jika masalah berlanjut.`;
        }
      } catch (e) {
        displayMessage = this.state.error?.message || displayMessage;
      }

      return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 text-center">
          <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 space-y-6">
            <div className="bg-red-100 w-20 h-20 rounded-full flex items-center justify-center text-red-600 mx-auto">
              <AlertCircle size={40} />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Ups! Terjadi Kesalahan</h2>
            <p className="text-gray-500">{displayMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all"
            >
              Muat Ulang Halaman
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function AuthScreen() {
  const { loginWithGoogle, loginWithEmail, signUp, resetPassword, quotaExceeded, quickLocalLogin, loginWithRoster } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [showManualLogin, setShowManualLogin] = useState(false);
  const [rosterIdentifier, setRosterIdentifier] = useState('');
  const [rosterPassword, setRosterPassword] = useState('');
  const [showRosterPassword, setShowRosterPassword] = useState(false);
  const [showManualPassword, setShowManualPassword] = useState(false);
  const [catalogUsersState, setCatalogUsersState] = useState<any[]>(() => {
    try {
      const c1 = localStorage.getItem('cached_roster_catalog');
      if (c1) {
        const p1 = JSON.parse(c1);
        if (Array.isArray(p1)) {
          const clean1 = p1.filter((u: any) => u && !isDemoUserRecord(u));
          if (clean1.length > 0) {
            purgeDemoAccountsEverywhere(clean1);
            return clean1;
          }
        }
      }
      const c2 = localStorage.getItem('cached_dashboard_users');
      if (c2) {
        const p2 = JSON.parse(c2);
        if (Array.isArray(p2)) {
          const clean2 = p2.filter((u: any) => u && !isDemoUserRecord(u));
          if (clean2.length > 0) {
            purgeDemoAccountsEverywhere(clean2);
            return clean2;
          }
        }
      }
    } catch (e) {}
    const bundled = getBundledUsers().filter((u: any) => u && !isDemoUserRecord(u));
    if (bundled.length > 0) {
      purgeDemoAccountsEverywhere(bundled);
    }
    return bundled;
  });
  const [isSyncingCatalog, setIsSyncingCatalog] = useState(false);
  const [appSettings, setAppSettings] = useState<any>(() => {
    try {
      const cached = localStorage.getItem('appSettingsCache');
      if (cached) {
        return sanitizeAppSettingsWithDefaults(JSON.parse(cached));
      }
    } catch (e) {}
    return getBundledAppSettings();
  });
  const [resetCooldown, setResetCooldown] = useState(() => {
    try {
      const saved = localStorage.getItem('auth_reset_cooldown');
      if (saved) {
        const remaining = Math.ceil((parseInt(saved) - Date.now()) / 1000);
        return remaining > 0 ? remaining : 0;
      }
    } catch (e) { console.error(e); }
    return 0;
  });

  // Fungsi Tarik Data Akun & Soal untuk Browser / Perangkat Baru (Otomatis menggunakan Link Spreadsheet dari Pengaturan Admin)
  const handleSyncLoginCatalog = React.useCallback(async (showFeedback = false): Promise<any[]> => {
    setIsSyncingCatalog(true);
    if (showFeedback) {
      setError('');
      setSuccess('');
    }
    try {
      let sheetUrl = getSavedSpreadsheetUrl(appSettings?.spreadsheetWebAppUrl);
      const mergedMap = new Map<string, any>();

      const isPlaceholderMail = (em?: string) => {
        if (!em) return true;
        const l = em.toLowerCase().trim();
        return l.endsWith('@siswa.sekolah.sch.id') || l.endsWith('@pengawas.sekolah.sch.id') || l.endsWith('@admin.sekolah.sch.id');
      };

      const addUsersToMap = (list: any[]) => {
        if (!Array.isArray(list)) return;
        list.forEach((u: any, idx: number) => {
          if (!u || isDemoUserRecord(u)) return;
          const uNis = String(u.nis || u.nisn || '').trim().toLowerCase();
          const uNip = String(u.nip || '').trim().toLowerCase();
          const uEmail = String(u.email || '').trim().toLowerCase();
          const uId = String(u.id || u.uid || '').trim().toLowerCase();

          // Cari apakah sudah ada entri user ini di mergedMap berdasarkan NIS, NIP, Email asli, atau ID
          let foundKey: string | null = null;
          for (const [k, existing] of mergedMap.entries()) {
            const eNis = String(existing.nis || existing.nisn || '').trim().toLowerCase();
            const eNip = String(existing.nip || '').trim().toLowerCase();
            const eEmail = String(existing.email || '').trim().toLowerCase();
            const eId = String(existing.id || existing.uid || '').trim().toLowerCase();
            if (uNis && eNis && uNis === eNis) { foundKey = k; break; }
            if (uNip && eNip && uNip === eNip) { foundKey = k; break; }
            if (uEmail && eEmail && !isPlaceholderMail(uEmail) && uEmail === eEmail) { foundKey = k; break; }
            if (uId && eId && uId === eId) { foundKey = k; break; }
          }

          const targetKey = foundKey || (uNis ? `nis_${uNis}` : uNip ? `nip_${uNip}` : uEmail ? `email_${uEmail}` : uId || `u_${idx}`);
          if (foundKey) {
            const existing = mergedMap.get(foundKey);
            // Utamakan password kustom non-kosong agar tidak tertimpa nilai default jika user sudah mengganti password
            const finalPass = String(u.password || existing.password || '').trim();
            mergedMap.set(targetKey, { ...existing, ...u, password: finalPass });
          } else {
            mergedMap.set(targetKey, u);
          }
        });
      };

      // Pertahankan data bawaan sekolah & cache lokal yang sudah ada sebagai dasar
      addUsersToMap(getBundledUsers());
      try {
        const existingCache = localStorage.getItem('cached_roster_catalog');
        if (existingCache) addUsersToMap(JSON.parse(existingCache));
      } catch (e) {}

      // 1. Pemeriksaan Ke-1 (UTAMA): Tarik dari Google Spreadsheet
      // Untuk 1.000 siswa: jika sudah memiliki cache lokal atau user bawaan dan tidak meminta sync manual (showFeedback=false),
      // hindari menembak Google Apps Script agar tidak memicu HTTP 429 Concurrency Limit (maks 30 eksekusi bersamaan)
      const hasExistingUsers = mergedMap.size > 10;
      const shouldFetchSheet = !hasExistingUsers || showFeedback;
      const sheetPromise = shouldFetchSheet
        ? fetchMasterFromSpreadsheet(sheetUrl, false, db)
        : Promise.resolve<SpreadsheetSyncResult>({ ok: true, users: Array.from(mergedMap.values()), exams: [] });

      // 2. Pemeriksaan Ke-2 (CADANGAN): Ambil dari Firebase secara paralel dengan batas waktu 2.5 detik
      // HINDARI query getDocs(users, limit(1200)) agar tidak membuang 1.200 read units per login siswa!
      const firebaseBackupPromise = !quotaExceeded
        ? Promise.allSettled([
            withQuickTimeout(getDoc(doc(db, 'settings', 'app')), 2500),
            withQuickTimeout(getDoc(doc(db, 'settings', 'public_bundle')), 2500),
            withQuickTimeout(getDoc(doc(db, 'settings', 'roster_catalog')), 2500),
          ])
        : Promise.resolve(null);

      const [sheetRes, fbResults] = await Promise.allSettled([sheetPromise, firebaseBackupPromise]);

      // Proses Cadangan Ke-2 (Firebase) terlebih dahulu jika tersedia
      if (fbResults.status === 'fulfilled' && Array.isArray(fbResults.value)) {
        const [appSnap, bundleSnap, catalogRes] = fbResults.value;
        try {
          const bundleData =
            bundleSnap.status === 'fulfilled' && bundleSnap.value && (bundleSnap.value as any).exists?.()
              ? ((bundleSnap.value as any).data() as any)
              : null;

          if (bundleData?.spreadsheetWebAppUrl && !sheetUrl) {
            sheetUrl = String(bundleData.spreadsheetWebAppUrl).trim();
            saveSpreadsheetUrlLocally(sheetUrl);
          }

          if (appSnap.status === 'fulfilled' && appSnap.value && (appSnap.value as any).exists?.()) {
            const data = (appSnap.value as any).data() as any;
            if (data.spreadsheetWebAppUrl && !sheetUrl) {
              sheetUrl = String(data.spreadsheetWebAppUrl).trim();
              saveSpreadsheetUrlLocally(sheetUrl);
            }
            const mergedSettings = sanitizeAppSettingsWithDefaults({
              ...(bundleData?.appSettings || {}),
              ...data,
              logoUrl: data.logoUrl || bundleData?.logoUrl || bundleData?.appSettings?.logoUrl || '',
            });
            setAppSettings(mergedSettings);
            try { localStorage.setItem('appSettingsCache', JSON.stringify(mergedSettings)); } catch (e) {}
          } else if (appSnap.status === 'fulfilled' && appSnap.value && !(appSnap.value as any).exists?.()) {
            const fallbackSettings = sanitizeAppSettingsWithDefaults(bundleData?.appSettings || bundleData || undefined);
            setAppSettings(fallbackSettings);
            try { localStorage.setItem('appSettingsCache', JSON.stringify(fallbackSettings)); } catch (e) {}
            seedBundledDataToFirestoreIfEmpty(db);
          }

          if (catalogRes.status === 'fulfilled' && catalogRes.value && (catalogRes.value as any).exists?.()) {
            const cData = (catalogRes.value as any).data();
            if (Array.isArray(cData?.users)) {
              addUsersToMap(cData.users);
            }
          }
        } catch (e) {}
      }

      // Masukkan dari Pemeriksaan Ke-1: Google Spreadsheet (Database Utama - menimpa/melengkapi dengan data terbaru dari Spreadsheet)
      let loadedFromSheetCount = 0;
      if (sheetRes.status === 'fulfilled' && sheetRes.value.ok) {
        if (Array.isArray(sheetRes.value.users)) {
          loadedFromSheetCount = sheetRes.value.users.length;
          addUsersToMap(sheetRes.value.users);
        }
        if (sheetRes.value.appSettings) {
          setAppSettings((prev: any) => {
            const merged = sanitizeAppSettingsWithDefaults({
              ...prev,
              ...sheetRes.value.appSettings,
              exitCountdownSeconds:
                sheetRes.value.appSettings.exitCountdownSeconds !== undefined
                  ? sheetRes.value.appSettings.exitCountdownSeconds
                  : (prev?.exitCountdownSeconds ?? 10),
            });
            try { localStorage.setItem('appSettingsCache', JSON.stringify(merged)); } catch (e) {}
            return merged;
          });
        }
      }

      // Selalu prioritaskan perubahan profil lokal terbaru (mis. siswa yang baru melengkapi NISN & Email)
      const localUpdated = getUpdatedUsersLocally();
      if (localUpdated.length > 0) {
        addUsersToMap(localUpdated);
      }

      const finalUsers = purgeDemoAccountsEverywhere(Array.from(mergedMap.values()));
      if (finalUsers.length > 0) {
        setCatalogUsersState(finalUsers);
        try {
          localStorage.setItem('cached_roster_catalog', JSON.stringify(finalUsers));
          localStorage.setItem('cached_dashboard_users', JSON.stringify(finalUsers));
        } catch (e) {}
      }

      if (showFeedback) {
        if (finalUsers.length > 0) {
          setSuccess(
            loadedFromSheetCount > 0
              ? `Berhasil menarik ${finalUsers.length} data akun dari Google Spreadsheet & Server! Silakan langsung Masuk.`
              : `Berhasil menarik ${finalUsers.length} data akun dari Server! Silakan langsung Masuk.`
          );
        } else {
          setError('Belum ada data akun yang terdeteksi. Pastikan URL Google Apps Script sudah disimpan di Pengaturan Admin.');
        }
      }

      return finalUsers;
    } catch (err: any) {
      if (showFeedback) {
        setError('Gagal menarik data akun: ' + (err?.message || 'Periksa koneksi internet Anda.'));
      }
      return catalogUsersState;
    } finally {
      setIsSyncingCatalog(false);
    }
  }, [appSettings?.spreadsheetWebAppUrl, quotaExceeded]);

  React.useEffect(() => {
    // Saat aplikasi dibuka di browser atau perangkat baru, langsung tarik seluruh data user dari Spreadsheet & Server
    handleSyncLoginCatalog(false);
  }, []);

  const handleRosterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanInput = rosterIdentifier.trim();
    const cleanPass = rosterPassword.trim();

    if (!cleanInput) {
      setError('Masukkan NISN / NIP / Email Anda.');
      return;
    }
    if (!cleanPass) {
      setError('Masukkan Kata Sandi / Password Anda.');
      return;
    }

    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const qLower = cleanInput.toLowerCase();
      let matchedUser: any = null;
      let catalogList: any[] = [...catalogUsersState];

      // Fungsi pencocokan user lintas role (Admin, Pengawas, Siswa) via NISN/NIS, NIP, Email, atau Nama
      const matchFromCatalog = (list: any[]) => {
        const candidates = list.filter((u: any) => {
          return (
            (u.email && String(u.email).trim().toLowerCase() === qLower) ||
            (u.nis && String(u.nis).trim().toLowerCase() === qLower) ||
            (u.nisn && String(u.nisn).trim().toLowerCase() === qLower) ||
            (u.nip && String(u.nip).trim().toLowerCase() === qLower) ||
            (u.username && String(u.username).trim().toLowerCase() === qLower)
          );
        });
        if (candidates.length > 0) {
          return (
            candidates.find((u: any) => {
              const emailPrefix = u.email ? String(u.email).split('@')[0].trim() : '';
              const expected = String(u.password || u.nis || u.nip || emailPrefix || '123456').trim();
              return expected && (expected === cleanPass || expected.toLowerCase() === cleanPass.toLowerCase());
            }) || candidates[0]
          );
        }
        return null;
      };

      if (catalogList.length > 0) {
        matchedUser = matchFromCatalog(catalogList);
      }

      // Jika dibuka di browser baru dan data belum selesai ditarik (atau user belum cocok),
      // tunggu penarikan langsung dari Google Spreadsheet & Firebase sekarang juga!
      if (!matchedUser) {
        const freshList = await handleSyncLoginCatalog(false);
        if (freshList.length > 0) {
          catalogList = freshList;
          matchedUser = matchFromCatalog(catalogList);
        }
      }

      // 3. Fallback targeted query to `users` collection if not yet in catalog (supports Email, NISN/NIS, and NIP across all roles)
      if (!matchedUser && !quotaExceeded) {
        try {
          const foundDocs: any[] = [];
          const byEmail = await getDocs(query(collection(db, 'users'), where('email', '==', qLower), limit(3)));
          byEmail.docs.forEach(d => foundDocs.push({ id: d.id, ...d.data() }));

          if (foundDocs.length === 0) {
            const byNis = await getDocs(query(collection(db, 'users'), where('nis', '==', cleanInput), limit(3)));
            byNis.docs.forEach(d => foundDocs.push({ id: d.id, ...d.data() }));
          }

          if (foundDocs.length === 0) {
            const byNip = await getDocs(query(collection(db, 'users'), where('nip', '==', cleanInput), limit(3)));
            byNip.docs.forEach(d => foundDocs.push({ id: d.id, ...d.data() }));
          }

          if (foundDocs.length > 0) {
            matchedUser =
              foundDocs.find(u => {
                const emailPrefix = u.email ? String(u.email).split('@')[0].trim() : '';
                const expected = String(u.password || u.nis || u.nip || emailPrefix || '123456').trim();
                return expected && (expected === cleanPass || expected.toLowerCase() === cleanPass.toLowerCase());
              }) || foundDocs[0];
          }
        } catch (e) {}
      }

      // 4. Akun Setup Awal 1x Pakai: HANYA aktif 1 kali saat aplikasi benar-benar baru di-Remix & belum ada user yang ditentukan.
      // Begitu sudah digunakan 1 kali ATAU data user utama telah ditentukan/di-restore, akun demo otomatis terhapus permanen!
      if (!matchedUser) {
        const isTryingDemoOrInitialAdmin =
          qLower === 'admin' ||
          qLower === 'demo' ||
          qLower === '19800101' ||
          qLower === 'pengawas' ||
          qLower === '19850202' ||
          qLower === 'siswa' ||
          qLower === '240101' ||
          qLower === 'admin@smpn2sutojayan.sch.id' ||
          qLower === 'pengawas@smpn2sutojayan.sch.id' ||
          qLower === 'siswa@smpn2sutojayan.sch.id';

        if (
          (qLower === 'admin' || qLower === 'demo') &&
          (cleanPass === 'admin123' || cleanPass === 'admin') &&
          canUseInitialOneTimeDemoAdmin(catalogList)
        ) {
          markOneTimeDemoAdminUsed();
          loginWithRoster({
            id: 'one_time_demo_admin',
            uid: 'one_time_demo_admin',
            username: 'Admin Setup Awal (Akun Demo 1x Pakai)',
            email: 'demo@smpn2sutojayan.sch.id',
            nip: '19800101',
            role: 'admin',
            kelas: '-',
            ruang: '-',
            isOneTimeDemo: true,
          });
          return;
        }

        if (isTryingDemoOrInitialAdmin) {
          setError('Akun Demo sudah otomatis dihapus karena data User utama sudah ditentukan. Silakan masuk menggunakan Email, NIP, atau NISN resmi Anda.');
          setLoading(false);
          return;
        }
      }

      // 5. Reject if user was not found in Data Master
      if (!matchedUser) {
        setError('Akun tidak ditemukan! Pastikan NISN, NIP, atau Email Anda sudah terdaftar di Data Master User.');
        setLoading(false);
        return;
      }

      if (matchedUser.role === 'pending') {
        setError('Akun Anda masih berstatus Pending dan belum diverifikasi oleh Admin.');
        setLoading(false);
        return;
      }

      // 6. Verify Password set by Admin (or fallback to NIS / NIP / Email prefix before @)
      const emailPrefix = matchedUser.email ? String(matchedUser.email).split('@')[0].trim() : '';
      const expectedPassword = String(matchedUser.password || matchedUser.nis || matchedUser.nip || emailPrefix || '123456').trim();
      let isPasswordMatch = Boolean(
        expectedPassword &&
        (cleanPass === expectedPassword || cleanPass.toLowerCase() === expectedPassword.toLowerCase())
      );

      // Jika password tidak cocok dengan data cache lama, JANGAN LANGSUNG DITOLAK!
      // Periksa apakah siswa/pengawas baru saja mengganti password di Firestore, registry profil lokal, atau settings/roster_catalog!
      if (!isPasswordMatch) {
        let freshMatch: any = null;

        // A. Cek registry pembaruan profil di HP/perangkat ini
        try {
          const locallyUpdated = getUpdatedUsersLocally();
          const foundLocal = locallyUpdated.find((u: any) => {
            const matchId = (u.id && (u.id === matchedUser.id || u.id === matchedUser.uid)) || (u.uid && (u.uid === matchedUser.id || u.uid === matchedUser.uid));
            const matchNis = u.nis && String(u.nis).trim().toLowerCase() === qLower;
            const matchEmail = u.email && String(u.email).trim().toLowerCase() === qLower;
            return matchId || matchNis || matchEmail;
          });
          if (foundLocal && foundLocal.password) {
            const freshExpected = String(foundLocal.password).trim();
            if (freshExpected === cleanPass || freshExpected.toLowerCase() === cleanPass.toLowerCase()) {
              freshMatch = { ...matchedUser, ...foundLocal };
            }
          }
        } catch (e) {}

        // B. Cek langsung ke Firestore koleksi users secara real-time
        if (!freshMatch && !quotaExceeded) {
          try {
            const targetIds = Array.from(new Set([matchedUser.id, matchedUser.uid, matchedUser.nis, cleanInput, `nis_${cleanInput}`])).filter(Boolean);
            for (const tId of targetIds) {
              const uSnap = await withQuickTimeout(getDoc(doc(db, 'users', String(tId))), 2000);
              if (uSnap && uSnap.exists()) {
                const uData = uSnap.data();
                if (uData && uData.password) {
                  const freshExpected = String(uData.password).trim();
                  if (freshExpected === cleanPass || freshExpected.toLowerCase() === cleanPass.toLowerCase()) {
                    freshMatch = { ...matchedUser, ...uData, id: uSnap.id };
                    break;
                  }
                }
              }
            }

            if (!freshMatch) {
              const qField = matchedUser.nis ? 'nis' : 'email';
              const qVal = matchedUser.nis ? matchedUser.nis : qLower;
              const qSnap = await withQuickTimeout(
                getDocs(query(collection(db, 'users'), where(qField, '==', qVal), limit(3))),
                2000
              );
              if (qSnap && !qSnap.empty) {
                for (const d of qSnap.docs) {
                  const uData = d.data();
                  if (uData && uData.password) {
                    const freshExpected = String(uData.password).trim();
                    if (freshExpected === cleanPass || freshExpected.toLowerCase() === cleanPass.toLowerCase()) {
                      freshMatch = { ...matchedUser, ...uData, id: d.id };
                      break;
                    }
                  }
                }
              }
            }
          } catch (e) {}
        }

        // C. Cek di settings/roster_catalog (jika admin/siswa menyinkronkan katalog)
        if (!freshMatch && !quotaExceeded) {
          try {
            const catSnap = await withQuickTimeout(getDoc(doc(db, 'settings', 'roster_catalog')), 2000);
            if (catSnap && catSnap.exists()) {
              const cData = catSnap.data();
              if (Array.isArray(cData?.users)) {
                const foundInCat = cData.users.find((u: any) => {
                  const matchNis = u.nis && String(u.nis).trim().toLowerCase() === qLower;
                  const matchEmail = u.email && String(u.email).trim().toLowerCase() === qLower;
                  const matchId = (u.id && (u.id === matchedUser.id || u.id === matchedUser.uid)) || (u.uid && (u.uid === matchedUser.id || u.uid === matchedUser.uid));
                  return matchNis || matchEmail || matchId;
                });
                if (foundInCat && foundInCat.password) {
                  const freshExpected = String(foundInCat.password).trim();
                  if (freshExpected === cleanPass || freshExpected.toLowerCase() === cleanPass.toLowerCase()) {
                    freshMatch = { ...matchedUser, ...foundInCat };
                  }
                }
              }
            }
          } catch (e) {}
        }

        if (freshMatch) {
          matchedUser = freshMatch;
          isPasswordMatch = true;
          // Perbarui juga registry lokal & state catalog agar login berikutnya instan 0ms!
          saveUpdatedUserLocally(freshMatch);
          setCatalogUsersState(prev => prev.map(u => (u.id === freshMatch.id || u.nis === freshMatch.nis) ? { ...u, ...freshMatch } : u));
        }
      }

      if (!isPasswordMatch) {
        setError('Kata Sandi / Password yang Anda masukkan salah. Jika baru saja mengganti password, pastikan huruf besar/kecil sesuai atau hubungi Pengawas / Admin.');
        setLoading(false);
        return;
      }

      // 7. Auto-detect Role (Admin, Pengawas, or Siswa) & Sync Profile directly with Master Data
      const rawDetectedRole = String(matchedUser.role || '').toLowerCase().trim();
      const detectedRole = isSuperAdminEmail(matchedUser.email || qLower)
        ? 'admin'
        : (rawDetectedRole === 'admin' || rawDetectedRole === 'pengawas' ? rawDetectedRole : 'siswa');

      loginWithRoster({
        id: matchedUser.id || matchedUser.uid,
        uid: matchedUser.uid || matchedUser.id,
        username: matchedUser.username || cleanInput,
        email: matchedUser.email || '',
        nis: matchedUser.nis || matchedUser.nisn || '',
        nip: matchedUser.nip || (detectedRole !== 'siswa' ? matchedUser.nis : '') || '',
        password: matchedUser.password || expectedPassword,
        role: detectedRole,
        kelas: matchedUser.kelas || '-',
        ruang: matchedUser.ruang || '-',
      });
    } catch (err: any) {
      setError(err.message || 'Gagal memverifikasi akun.');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (resetCooldown > 0) {
      const timer = setTimeout(() => {
        setResetCooldown(resetCooldown - 1);
        // Update localStorage to keep it in sync
        const targetTime = Date.now() + ((resetCooldown - 1) * 1000);
        localStorage.setItem('auth_reset_cooldown', targetTime.toString());
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      localStorage.removeItem('auth_reset_cooldown');
    }
  }, [resetCooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      if (isSignUp) {
        await signUp(email, password, name);
      } else {
        await loginWithEmail(email, password);
      }
    } catch (err: any) {
      let msg = err.message || 'Terjadi kesalahan. Silakan coba lagi.';
      try {
        const parsed = JSON.parse(err.message);
        if (parsed.error) msg = `Database Error: ${parsed.error}`;
      } catch (e) {}
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Silakan masukkan email Anda terlebih dahulu untuk mereset password.');
      return;
    }
    if (resetCooldown > 0) return;

    setError('');
    setSuccess('');
    setLoading(true);
    try {
      await resetPassword(email);
      setSuccess('Email reset password telah dikirim. Silakan cek inbox atau folder spam Anda.');
      const cooldown = 60;
      setResetCooldown(cooldown);
      localStorage.setItem('auth_reset_cooldown', (Date.now() + cooldown * 1000).toString());
    } catch (err: any) {
      if (err.message?.includes('too-many-requests')) {
        setError('Terlalu banyak permintaan. Silakan tunggu beberapa menit.');
        const cooldown = 300;
        setResetCooldown(cooldown);
        localStorage.setItem('auth_reset_cooldown', (Date.now() + cooldown * 1000).toString());
      } else {
        setError(err.message || 'Gagal mengirim email reset password.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (loading) return;
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      if (err.code === 'auth/cancelled-popup-request') {
        // Ignore this specific error as it's usually benign in this environment
        console.warn('Google Login popup cancelled or already pending.');
      } else if (err.code === 'auth/unauthorized-domain') {
        setError(`Domain ini (${window.location.hostname}) belum didaftarkan di Firebase Console > Authentication > Settings > Authorized domains. Silakan gunakan 'Masuk dengan Email' di bawah atau daftarkan domain Vercel Anda.`);
        setShowManualLogin(true);
      } else if (err.code === 'auth/popup-blocked') {
        setError('Popup login diblokir oleh browser. Silakan izinkan popup untuk situs ini atau gunakan Masuk dengan Email.');
      } else {
        setError(err.message || 'Gagal masuk dengan Google.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-md bg-white rounded-2xl sm:rounded-3xl shadow-xl p-6 sm:p-8 space-y-6 sm:space-y-8">
        <div className="text-center space-y-2">
          <div className={`${appSettings.logoUrl ? 'bg-transparent' : 'bg-blue-600'} w-16 h-16 sm:w-20 sm:h-20 rounded-xl sm:rounded-2xl flex items-center justify-center text-white mx-auto shadow-lg shadow-blue-200 mb-2 sm:mb-4 overflow-hidden`}>
            {appSettings.logoUrl ? (
              <img src={appSettings.logoUrl} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <>
                <Shield size={28} className="sm:hidden" />
                <Shield size={32} className="hidden sm:block" />
              </>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
            {isSignUp ? 'Buat Akun' : (appSettings.title || 'Selamat Datang')}
          </h1>
          <p className="text-sm sm:text-base text-gray-500">
            {isSignUp ? 'Daftar untuk memulai ujian' : (appSettings.loginSubtitle !== undefined && appSettings.loginSubtitle !== '' ? appSettings.loginSubtitle : 'Masuk ke sistem ujian anti-curang')}
          </p>
        </div>

        {quotaExceeded && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3.5 rounded-xl text-xs space-y-1.5 shadow-sm">
            <div className="flex items-center gap-1.5 font-bold text-amber-900">
              <AlertTriangle size={16} className="text-amber-600 shrink-0" />
              <span>Batas Kuota Database Tercapai</span>
            </div>
            <p className="text-amber-700 leading-relaxed">
              Kuota pembacaan harian Firebase Firestore (Free Tier) telah habis dan akan direset besok secara otomatis.
            </p>
            <a 
              href="https://console.firebase.google.com/project/gen-lang-client-0993514496/firestore/databases/ai-studio-newaplikasiujian-e9e6afe0-95b1-415a-b3fd-40c77977fa40/data?openUpgradeDialog=true" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-block font-bold text-blue-700 hover:underline pt-1"
            >
              Lihat Kuota / Upgrade di Firebase Console &rarr;
            </a>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl text-sm font-medium">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-100 text-green-600 px-4 py-3 rounded-xl text-sm font-medium">
            {success}
          </div>
        )}

        <div className="space-y-4">
          {/* Form Login Tunggal (Otomatis Mendeteksi Role: Siswa, Pengawas, atau Admin) */}
          <form onSubmit={handleRosterSubmit} className="border-2 border-blue-100 bg-blue-50/30 rounded-2xl p-5 space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700 uppercase ml-1">
                ID Pengguna (Email / NISN / NIS / NIP)
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-blue-600" size={18} />
                <input
                  type="text"
                  required
                  placeholder="Masukkan Email, NISN/NIS, atau NIP Anda"
                  value={rosterIdentifier}
                  onChange={(e) => setRosterIdentifier(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-white border border-blue-200 rounded-xl text-sm font-semibold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <p className="text-[11px] text-gray-500 ml-1 leading-relaxed">
                * Kelas 7/8/9 dapat masuk memakai <strong>Email</strong> atau <strong>NISN/NIS</strong>. Guru/Admin memakai <strong>NIP</strong> atau <strong>Email</strong>.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700 uppercase ml-1">Password / Kata Sandi</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-blue-600" size={18} />
                <input
                  type={showRosterPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  placeholder="Masukkan password Anda"
                  value={rosterPassword}
                  onChange={(e) => setRosterPassword(e.target.value)}
                  className="w-full pl-11 pr-11 py-3 bg-white border border-blue-200 rounded-xl text-sm font-semibold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowRosterPassword(prev => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600 transition-colors p-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer flex items-center justify-center"
                  title={showRosterPassword ? "Sembunyikan password" : "Lihat password"}
                  aria-label={showRosterPassword ? "Sembunyikan password" : "Lihat password"}
                  aria-pressed={showRosterPassword}
                >
                  {showRosterPassword ? <EyeOff size={18} className="text-blue-600" /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 shadow-blue-100 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 text-sm cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Memverifikasi & Menarik Data...</span>
                </>
              ) : (
                <>
                  <LogIn size={18} />
                  <span>Masuk</span>
                </>
              )}
            </button>

            {/* Info Akun Setup 1x Pakai HANYA tampil jika aplikasi baru di-Remix & belum ada 1 pun user yang ditentukan */}
            {canUseInitialOneTimeDemoAdmin(catalogUsersState) && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 space-y-1">
                <p className="font-extrabold text-amber-800">🔑 Akun Setup Awal (Hanya Muncul 1 Kali):</p>
                <p className="leading-relaxed">
                  Database baru terdeteksi belum memiliki user. Gunakan ID: <strong>admin</strong> &amp; Password: <strong>admin123</strong> (1x pakai) untuk masuk dan melakukan <strong>Restore File Backup (.JSON)</strong> atau menambahkan Admin baru. Begitu user ditentukan, akun demo ini otomatis terhapus permanen.
                </p>
              </div>
            )}

            {/* Panel Status Kesiapan Data & Tombol Segarkan / Tarik Data untuk Browser Baru */}
            <div className="pt-2 border-t border-blue-200/70 space-y-2">
              <div className="flex items-center justify-between gap-2 bg-white/90 px-3 py-2.5 rounded-xl border border-blue-200">
                <div className="flex items-center gap-2 min-w-0">
                  {isSyncingCatalog ? (
                    <RefreshCw size={15} className="text-blue-600 animate-spin shrink-0" />
                  ) : catalogUsersState.length > 0 ? (
                    <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                  ) : (
                    <Database size={15} className="text-amber-600 shrink-0" />
                  )}
                  <div className="truncate">
                    <p className="text-[11px] font-extrabold text-gray-800 truncate">
                      {isSyncingCatalog
                        ? 'Menarik data akun dari Spreadsheet...'
                        : catalogUsersState.length > 0
                        ? `${catalogUsersState.length} Akun Siap Login`
                        : 'Data Akun Belum Termuat di Browser Ini'}
                    </p>
                    <p className="text-[10px] text-gray-500 truncate">
                      {isSyncingCatalog
                        ? 'Mohon tunggu sebentar...'
                        : 'Klik Segarkan jika baru buka di browser/HP baru'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleSyncLoginCatalog(true)}
                  disabled={isSyncingCatalog}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg font-extrabold text-[11px] flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs transition-all"
                >
                  <RefreshCw size={12} className={isSyncingCatalog ? 'animate-spin' : ''} />
                  <span>{isSyncingCatalog ? 'Menarik...' : 'Segarkan / Tarik Data'}</span>
                </button>
              </div>
            </div>
          </form>

          {/* Tombol Masuk dengan Google: HANYA muncul jika diaktifkan (ON) oleh Admin di Menu Setelan */}
          {appSettings.allowGoogleLogin && (
            <div className="space-y-3 pt-1">
              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-gray-200"></div>
                <span className="flex-shrink mx-4 text-[10px] text-gray-400 font-bold uppercase">Atau Login Google</span>
                <div className="flex-grow border-t border-gray-200"></div>
              </div>
              <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className={`w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-200 hover:border-blue-300 hover:bg-blue-50/40 text-gray-800 font-bold py-3.5 rounded-xl transition-all text-xs sm:text-sm ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                {loading ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-blue-600"></div>
                ) : (
                  <div className="bg-white p-0.5 rounded-full">
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-4 h-4" />
                  </div>
                )}
                <span>{loading ? 'Menghubungkan...' : 'Masuk dengan Google'}</span>
              </button>
            </div>
          )}
        </div>

        {(showManualLogin || (isSignUp && appSettings.allowSelfRegistration)) && (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2 border-t border-gray-50">
            {isSignUp && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase ml-1">Nama Lengkap</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="text"
                    required
                    placeholder="Masukkan nama lengkap"
                    className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 uppercase ml-1">Email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="email"
                  required
                  placeholder="nama@email.com"
                  className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between ml-1">
                <label className="text-xs font-bold text-gray-700 uppercase">Password / Kata Sandi</label>
                {!isSignUp && (
                  <button 
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={resetCooldown > 0}
                    className="text-xs font-bold text-blue-600 hover:underline disabled:text-gray-400 cursor-pointer"
                  >
                    {resetCooldown > 0 ? `Tunggu ${resetCooldown}s` : 'Lupa Password?'}
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type={showManualPassword ? "text" : "password"}
                  required
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  placeholder={isSignUp ? "Minimal 6 karakter" : "Masukkan password Anda"}
                  className="w-full pl-12 pr-11 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-semibold text-gray-900"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowManualPassword(prev => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600 transition-colors p-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer flex items-center justify-center"
                  title={showManualPassword ? "Sembunyikan password" : "Lihat password"}
                  aria-label={showManualPassword ? "Sembunyikan password" : "Lihat password"}
                  aria-pressed={showManualPassword}
                >
                  {showManualPassword ? <EyeOff size={18} className="text-blue-600" /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gray-900 hover:bg-black text-white font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <span>{isSignUp ? 'Daftar Sekarang' : 'Masuk'}</span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
        )}

        {appSettings.allowSelfRegistration && (
          <div className="text-center pt-1 flex flex-col gap-2">
            <button
              onClick={() => {
                setIsSignUp(!isSignUp);
                setShowManualLogin(false);
              }}
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              {isSignUp ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Daftar'}
            </button>
          </div>
        )}

        <div className="pt-4 border-t border-gray-100 text-center space-y-0.5">
          <p className="text-xs font-semibold text-gray-500">© 2026 SMPN 2 Sutojayan</p>
          <p className="text-[11px] font-medium text-gray-400">Created by Candra</p>
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  const { user, userProfile, loading, isProfileLoading, logout, quotaExceeded } = useAuth();

  const quotaBanner = quotaExceeded ? (
    <div className="bg-amber-600 text-white px-4 py-2 text-xs sm:text-sm font-medium flex flex-wrap items-center justify-between gap-2 shadow-md sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <AlertTriangle size={18} className="shrink-0 text-amber-200" />
        <span>
          <strong>Batas Kuota Firestore Tercapai:</strong> Kuota pembacaan harian database (Free Tier) telah habis dan akan direset otomatis esok hari.
        </span>
      </div>
      <a
        href="https://console.firebase.google.com/project/gen-lang-client-0993514496/firestore/databases/ai-studio-newaplikasiujian-e9e6afe0-95b1-415a-b3fd-40c77977fa40/data?openUpgradeDialog=true"
        target="_blank"
        rel="noopener noreferrer"
        className="bg-white text-amber-800 px-3 py-1 rounded-lg text-xs font-bold hover:bg-amber-50 transition-colors shadow-sm"
      >
        Lihat Kuota / Upgrade di Firebase &rarr;
      </a>
    </div>
  ) : null;

  if (loading || isProfileLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4 text-center">
        {quotaBanner}
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600 mb-4"></div>
        <p className="text-gray-500 font-medium animate-pulse mb-6">Menyiapkan sistem ujian...</p>
        
        <div className="space-y-3 w-full max-w-xs">
          <button 
            onClick={() => window.location.reload()}
            className="w-full py-2 text-xs font-bold text-blue-600 bg-white border border-blue-100 rounded-lg hover:bg-blue-50 transition-all"
          >
            Muat Ulang Halaman
          </button>
          <button 
            onClick={logout}
            className="w-full py-2 text-xs font-bold text-gray-400 hover:text-gray-600 transition-all"
          >
            Batal / Keluar
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  const isSuperAdmin = isSuperAdminEmail(user.email) || isSuperAdminEmail(userProfile?.email);

  // Check if onboarding needs to be filled (new user, or hasn't finished registration onboarding)
  const isProfileComplete = 
    isSuperAdmin || 
    userProfile?.isRegistrationComplete === true || 
    (userProfile?.role && userProfile.role !== 'pending' && (userProfile.role !== 'siswa' || (userProfile.kelas && userProfile.kelas !== '-')));

  if (!isProfileComplete) {
    return (
      <>
        {quotaBanner}
        <RegistrationOnboarding />
      </>
    );
  }

  if (userProfile?.role === 'pending' && !isSuperAdmin) {
    const requested = userProfile?.requestedRole || 'siswa';
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50/40 via-gray-50 to-white flex flex-col items-center justify-center p-4 text-center">
        {quotaBanner}
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-amber-100 p-6 sm:p-8 space-y-6">
          <div className="bg-amber-100/80 w-20 h-20 rounded-2xl flex items-center justify-center text-amber-600 mx-auto shadow-inner">
            <Shield size={36} />
          </div>
          <div className="space-y-2">
            <span className="px-3 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded-full uppercase tracking-wider inline-block">
              Menunggu Verifikasi Admin
            </span>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Pendaftaran Berhasil Dikirim</h2>
            <p className="text-xs sm:text-sm text-gray-500 leading-relaxed">
              Akun Anda telah terdaftar dan menunggu persetujuan Panitia Ujian sebelum dapat mengakses sistem ujian.
            </p>
          </div>

          <div className="p-4 bg-gray-50 rounded-2xl text-left text-xs space-y-2 text-gray-700 border border-gray-100">
            <div className="flex justify-between items-center pb-2 border-b border-gray-200">
              <span className="text-gray-400 font-medium">Peran yang Diajukan:</span>
              <span className="font-bold uppercase px-2 py-0.5 bg-blue-100 text-blue-700 rounded-md">
                {requested}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400 font-medium">Nama Lengkap:</span>
              <span className="font-bold text-gray-900">{userProfile?.username || '-'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400 font-medium">Email Akun:</span>
              <span className="font-medium text-gray-600">{user.email}</span>
            </div>
            {requested === 'siswa' && (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 font-medium">Kelas:</span>
                  <span className="font-bold text-blue-600">{userProfile?.kelas || '-'}</span>
                </div>
                {userProfile?.nis && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 font-medium">NIS:</span>
                    <span className="font-mono font-bold text-gray-800">{userProfile.nis}</span>
                  </div>
                )}
                {userProfile?.ruang && userProfile.ruang !== '-' && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 font-medium">Ruang:</span>
                    <span className="font-medium text-gray-800">{userProfile.ruang}</span>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="space-y-2 pt-2">
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all text-sm shadow-lg shadow-blue-100"
            >
              Cek Status / Muat Ulang
            </button>
            <button 
              onClick={logout}
              className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-all text-sm"
            >
              Keluar Akun
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!userProfile) {
    return (
      <>
        {quotaBanner}
        <AuthScreen />
      </>
    );
  }

  return (
    <>
      {quotaBanner}
      <Dashboard />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}
