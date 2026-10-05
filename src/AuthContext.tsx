import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  User, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, isFirestoreQuotaExhausted, checkAndHandleQuotaError } from './firebase';
import { isSuperAdminEmail } from './lib/adminConfig';
import { isDemoUserRecord, hasRealUsersConfigured } from './lib/spreadsheetService';

interface AuthContextType {
  user: User | null;
  userProfile: any | null;
  loading: boolean;
  isProfileLoading: boolean;
  quotaExceeded: boolean;
  quotaMessage: string | null;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, pass: string) => Promise<void>;
  signUp: (email: string, pass: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  setProfile: (role: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  quickLocalLogin: (role?: 'admin' | 'pengawas' | 'siswa', name?: string, email?: string) => void;
  loginWithRoster: (rosterUser: {
    id?: string;
    uid?: string;
    username: string;
    email?: string;
    nis?: string;
    nip?: string;
    password?: string;
    role?: 'admin' | 'pengawas' | 'siswa' | string;
    kelas?: string;
    ruang?: string;
  }) => void;
  updateLocalUserProfile: (updates: Record<string, any>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [quotaMessage, setQuotaMessage] = useState<string | null>(null);

  // Check for local emergency session on mount (allows instant zero-read login)
  useEffect(() => {
    try {
      const savedLocal = localStorage.getItem('cached_local_auth_session');
      if (savedLocal) {
        const parsed = JSON.parse(savedLocal);
        if (parsed.profile && isDemoUserRecord(parsed.profile) && hasRealUsersConfigured()) {
          localStorage.removeItem('cached_local_auth_session');
          return;
        }
        if (parsed.user && parsed.profile) {
          setUser(parsed.user as User);
          setUserProfile(parsed.profile);
          setLoading(false);
          setIsProfileLoading(false);
        }
      }
    } catch (e) {
      console.warn("Could not parse cached_local_auth_session:", e);
    }
  }, []);

  useEffect(() => {
    let profileUnsub = () => {};

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // If user is already set from a local emergency session, don't overwrite with null
      if (!firebaseUser) {
        try {
          const savedLocal = localStorage.getItem('cached_local_auth_session');
          if (savedLocal) {
            const parsed = JSON.parse(savedLocal);
            if (parsed.profile && isDemoUserRecord(parsed.profile) && hasRealUsersConfigured()) {
              localStorage.removeItem('cached_local_auth_session');
            } else {
              setLoading(false);
              return;
            }
          }
        } catch (e) {}
        setUser(null);
        setUserProfile(null);
        setIsProfileLoading(false);
        setLoading(false);
        return;
      }

      setUser(firebaseUser);
      profileUnsub(); // Clear previous listener

      const userEmail = firebaseUser.email?.toLowerCase() || '';
      const isAdmin = isSuperAdminEmail(userEmail);
      const userDocRef = doc(db, 'users', firebaseUser.uid);

      // 1. Instant access via local profile or Super Admin promotion (ZERO Firestore read units!)
      let activeProfile: any = null;
      try {
        const cached = localStorage.getItem(`cached_user_profile_${firebaseUser.uid}`);
        if (cached) {
          activeProfile = JSON.parse(cached);
        }
      } catch (e) {}

      if (isAdmin) {
        activeProfile = {
          uid: firebaseUser.uid,
          username: activeProfile?.username || firebaseUser.displayName || 'Candra Kurniawan (Admin)',
          email: firebaseUser.email,
          role: 'admin',
          isRegistrationComplete: true,
          verified: true,
          ...(activeProfile || {})
        };
        activeProfile.role = 'admin';
        activeProfile.isRegistrationComplete = true;
        try {
          localStorage.setItem(`cached_user_profile_${firebaseUser.uid}`, JSON.stringify(activeProfile));
        } catch (e) {}
      }

      if (activeProfile) {
        setUserProfile(activeProfile);
        setIsProfileLoading(false);
        setLoading(false);
      } else {
        setIsProfileLoading(true);
      }

      // 2. Minimal Firestore sync: Single direct document read (1 read unit ONLY)
      if (isFirestoreQuotaExhausted()) {
        setQuotaExceeded(true);
        setQuotaMessage("Batas kuota harian Firestore (Free Tier) telah tercapai. Mode Google Spreadsheet & Cache Lokal aktif.");
        setIsProfileLoading(false);
        setLoading(false);
        return;
      }

      try {
        const directDoc = await getDoc(userDocRef);
        if (directDoc.exists()) {
          const docData = directDoc.data();
          const merged = { ...docData };
          if (isAdmin) {
            merged.role = 'admin';
            merged.isRegistrationComplete = true;
          }
          setUserProfile(merged);
          try {
            localStorage.setItem(`cached_user_profile_${firebaseUser.uid}`, JSON.stringify(merged));
          } catch (e) {}
        } else if (!activeProfile) {
          // New profile
          const newProfile = {
            uid: firebaseUser.uid,
            username: firebaseUser.displayName || 'User',
            email: firebaseUser.email,
            role: isAdmin ? 'admin' : 'pending',
            isRegistrationComplete: isAdmin,
            createdAt: serverTimestamp(),
          };
          setUserProfile(newProfile);
          try {
            localStorage.setItem(`cached_user_profile_${firebaseUser.uid}`, JSON.stringify(newProfile));
            if (!isFirestoreQuotaExhausted()) {
              await setDoc(userDocRef, newProfile).catch(checkAndHandleQuotaError);
            }
          } catch (e) {}
        }
      } catch (err: any) {
        const isQuota = checkAndHandleQuotaError(err);
        if (isQuota) {
          setQuotaExceeded(true);
          setQuotaMessage("Batas kuota harian Firestore (Free Tier) telah tercapai. Mode Google Spreadsheet & Cache Lokal aktif.");
        }
        // Fallback if no profile yet
        if (!activeProfile) {
          const fallbackProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            username: firebaseUser.displayName || (isAdmin ? 'Candra Kurniawan (Admin)' : 'User'),
            role: isAdmin ? 'admin' : 'pending',
            isRegistrationComplete: isAdmin
          };
          setUserProfile(fallbackProfile);
          try {
            localStorage.setItem(`cached_user_profile_${firebaseUser.uid}`, JSON.stringify(fallbackProfile));
          } catch (e) {}
        }
      } finally {
        setIsProfileLoading(false);
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      profileUnsub();
    };
  }, []);

  const setProfile = async (role: string) => {
    if (!user) return;
    setIsProfileLoading(true);
    try {
      const newProfile = {
        uid: user.uid,
        username: user.displayName || 'User',
        email: user.email,
        role: role,
        createdAt: serverTimestamp(),
      };
      try {
        await setDoc(doc(db, 'users', user.uid), newProfile);
      } catch (e) {
        console.warn("Could not save to firestore, saved locally:", e);
      }
      localStorage.setItem(`cached_user_profile_${user.uid}`, JSON.stringify(newProfile));
      setUserProfile(newProfile);
    } catch (error) {
      console.error("Error setting profile:", error);
    } finally {
      setIsProfileLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Google Login error:', error);
      throw error;
    }
  };

  const loginWithEmail = async (email: string, pass: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (error: any) {
      console.error('Email Login error:', error);
      throw error;
    }
  };

  const signUp = async (email: string, pass: string, name: string) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(userCredential.user, { displayName: name });
      
      const isAdmin = isSuperAdminEmail(email);
      const newProfile = {
        uid: userCredential.user.uid,
        username: name,
        email: email,
        role: isAdmin ? 'admin' : 'pending',
        isRegistrationComplete: isAdmin,
        createdAt: serverTimestamp(),
      };
      try {
        await setDoc(doc(db, 'users', userCredential.user.uid), newProfile);
      } catch (err: any) {
        console.warn("Could not save profile to firestore (quota/offline), saved locally:", err);
      }
      try {
        localStorage.setItem(`cached_user_profile_${userCredential.user.uid}`, JSON.stringify(newProfile));
      } catch (e) {}
      setUserProfile(newProfile);
    } catch (error) {
      console.error('Signup error:', error);
      throw error;
    }
  };

  const resetPassword = async (email: string) => {
    const { sendPasswordResetEmail } = await import('firebase/auth');
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      console.error('Password reset error:', error);
      throw error;
    }
  };

  /**
   * Fast emergency bypass login that works 100% locally with ZERO Firebase network calls.
   * Useful when Firebase Firestore quota is reached or for instant offline access.
   */
  const quickLocalLogin = (
    role: 'admin' | 'pengawas' | 'siswa' = 'admin',
    name?: string,
    email?: string
  ) => {
    const defaultEmail = role === 'admin' 
      ? 'candrakurniawan@smpn2sutojayan.sch.id' 
      : (role === 'pengawas' ? 'pengawas@smpn2sutojayan.sch.id' : 'siswa@smpn2sutojayan.sch.id');
    const defaultName = role === 'admin'
      ? 'Candra Kurniawan (Admin)'
      : (role === 'pengawas' ? 'Pengawas Ruang' : 'Siswa Peserta');

    const finalEmail = email || defaultEmail;
    const finalName = name || defaultName;
    const uid = `local_${role}_${Date.now().toString(36)}`;

    const mockUser: any = {
      uid,
      email: finalEmail,
      displayName: finalName,
      emailVerified: true,
      isAnonymous: false,
      metadata: {},
      providerData: [],
      refreshToken: '',
      tenantId: null,
      delete: async () => {},
      getIdToken: async () => 'mock-token',
      getIdTokenResult: async () => ({ token: 'mock-token' } as any),
      reload: async () => {},
      toJSON: () => ({})
    };

    const mockProfile = {
      uid,
      email: finalEmail,
      username: finalName,
      role: role,
      isRegistrationComplete: true,
      verified: true,
      kelas: role === 'siswa' ? '7A' : '-',
      ruang: role === 'siswa' ? 'R.01' : '-'
    };

    try {
      localStorage.setItem('cached_local_auth_session', JSON.stringify({
        user: mockUser,
        profile: mockProfile
      }));
      localStorage.setItem(`cached_user_profile_${uid}`, JSON.stringify(mockProfile));
    } catch (e) {}

    setUser(mockUser);
    setUserProfile(mockProfile);
    setLoading(false);
    setIsProfileLoading(false);
  };

  /**
   * Pre-provisioned Roster Login (1,000+ User Mode):
   * Allows students and supervisors created by Admin to log in directly using NIS / Email / Name
   * without triggering Google OAuth rate limits or requiring self-registration.
   */
  const loginWithRoster = (rosterUser: {
    id?: string;
    uid?: string;
    username: string;
    email?: string;
    nis?: string;
    nip?: string;
    password?: string;
    role?: 'admin' | 'pengawas' | 'siswa' | string;
    kelas?: string;
    ruang?: string;
  }) => {
    const cleanRole = (rosterUser.role || 'siswa').toLowerCase().trim();
    const finalRole = (cleanRole === 'admin' || cleanRole === 'pengawas') ? cleanRole : 'siswa';
    const identifier = rosterUser.nis || rosterUser.nip || rosterUser.email || rosterUser.username;
    const uid = rosterUser.uid || rosterUser.id || `roster_${finalRole}_${String(identifier).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
    const rawEmail = (rosterUser.email || '').trim().toLowerCase();
    const authEmail = rawEmail || `${rosterUser.nis || rosterUser.nip || uid}@${finalRole}.sekolah.sch.id`;
    const finalName = rosterUser.username || 'Peserta Ujian';

    const mockUser: any = {
      uid,
      email: authEmail,
      displayName: finalName,
      emailVerified: true,
      isAnonymous: false,
      metadata: {},
      providerData: [],
      refreshToken: '',
      tenantId: null,
      delete: async () => {},
      getIdToken: async () => 'roster-token',
      getIdTokenResult: async () => ({ token: 'roster-token' } as any),
      reload: async () => {},
      toJSON: () => ({})
    };

    const mockProfile = {
      id: rosterUser.id || uid,
      uid,
      email: rawEmail,
      username: finalName,
      nis: rosterUser.nis || '',
      nip: rosterUser.nip || '',
      password: rosterUser.password || '',
      role: finalRole,
      isRegistrationComplete: true,
      verified: true,
      kelas: rosterUser.kelas || (finalRole === 'siswa' ? '7A' : '-'),
      ruang: rosterUser.ruang || (finalRole === 'siswa' ? 'Ruang 01' : '-')
    };

    try {
      localStorage.setItem('cached_local_auth_session', JSON.stringify({
        user: mockUser,
        profile: mockProfile
      }));
      localStorage.setItem(`cached_user_profile_${uid}`, JSON.stringify(mockProfile));
    } catch (e) {}

    setUser(mockUser);
    setUserProfile(mockProfile);
    setLoading(false);
    setIsProfileLoading(false);
  };

  const updateLocalUserProfile = (updates: Record<string, any>) => {
    setUserProfile((prev: any) => {
      if (!prev) return prev;
      const nextProfile = { ...prev, ...updates };
      const targetUid = nextProfile.uid || nextProfile.id || user?.uid;
      try {
        if (targetUid) {
          localStorage.setItem(`cached_user_profile_${targetUid}`, JSON.stringify(nextProfile));
        }
        const savedLocal = localStorage.getItem('cached_local_auth_session');
        if (savedLocal) {
          const parsed = JSON.parse(savedLocal);
          const baseUser = parsed.user || {};
          const nextUser = {
            uid: baseUser.uid || targetUid || '',
            email: nextProfile.email || baseUser.email || '',
            displayName: nextProfile.username || baseUser.displayName || '',
            emailVerified: true,
            isAnonymous: false,
          };
          localStorage.setItem('cached_local_auth_session', JSON.stringify({
            user: nextUser,
            profile: nextProfile
          }));
          setUser(nextUser as User);
        }
      } catch (e) {}
      return nextProfile;
    });
  };

  const logout = async () => {
    try {
      localStorage.removeItem('cached_local_auth_session');
    } catch (e) {}
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      setUserProfile(null);
      setIsProfileLoading(false);
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      userProfile, 
      loading, 
      isProfileLoading, 
      quotaExceeded,
      quotaMessage,
      loginWithGoogle, 
      loginWithEmail, 
      signUp, 
      logout,
      setProfile,
      resetPassword,
      quickLocalLogin,
      loginWithRoster,
      updateLocalUserProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
