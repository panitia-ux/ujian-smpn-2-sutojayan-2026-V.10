import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { db } from './firebase';
import { 
  doc, 
  setDoc, 
  collection, 
  getDocs, 
  addDoc, 
  serverTimestamp 
} from 'firebase/firestore';
import { 
  GraduationCap, 
  UserCheck, 
  Shield, 
  User, 
  Hash, 
  School, 
  Building2, 
  ArrowRight, 
  LogOut, 
  AlertCircle,
  Plus
} from 'lucide-react';
import { DEFAULT_CLASSES, DEFAULT_ROOMS, normalizeClassName, getMergedClassList, getGradeLevelFromClass, normalizeRoomName, compareRoomNames } from './lib/classConstants';
import { isSuperAdminEmail } from './lib/adminConfig';
import { saveUpdatedUserLocally, upsertUserToSpreadsheet } from './lib/spreadsheetService';

const withOnboardingTimeout = <T,>(promise: Promise<T>, ms = 2500): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ONBOARDING_TIMEOUT')), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
};

interface RegistrationOnboardingProps {
  onComplete?: () => void;
}

export default function RegistrationOnboarding({ onComplete }: RegistrationOnboardingProps) {
  const { user, userProfile, logout } = useAuth();

  const [role, setRole] = useState<'siswa' | 'pengawas' | 'admin'>('siswa');
  const [fullName, setFullName] = useState(userProfile?.username || user?.displayName || '');
  const [nis, setNis] = useState(userProfile?.nis || '');
  const [selectedClass, setSelectedClass] = useState('7A');
  const [isCustomClass, setIsCustomClass] = useState(false);
  const [customClassName, setCustomClassName] = useState('');
  const [ruang, setRuang] = useState(userProfile?.ruang || '-');
  
  const [existingClassrooms, setExistingClassrooms] = useState<string[]>([]);
  const [roomsList, setRoomsList] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load existing classes & rooms from Firestore for selection options
  useEffect(() => {
    async function loadOptions() {
      try {
        const classSnap = await getDocs(collection(db, 'classrooms'));
        const dbClasses = classSnap.docs.map(d => d.data().name).filter(Boolean);
        setExistingClassrooms(getMergedClassList(dbClasses));

        const roomSnap = await getDocs(collection(db, 'rooms'));
        const dbRooms = Array.from(
          new Set(
            roomSnap.docs
              .map(d => normalizeRoomName(d.data().name || ''))
              .filter(Boolean)
          )
        ).sort(compareRoomNames);
        setRoomsList(dbRooms.length > 0 ? dbRooms : DEFAULT_ROOMS);
      } catch (err) {
        console.warn('Could not load classroom/room options:', err);
        // Fallback to default classes & rooms
        setExistingClassrooms(DEFAULT_CLASSES);
        setRoomsList(DEFAULT_ROOMS);
      }
    }
    loadOptions();
  }, []);

  const classOptions = existingClassrooms.length > 0 ? existingClassrooms : DEFAULT_CLASSES;
  const roomOptions = roomsList.length > 0 ? roomsList : DEFAULT_ROOMS;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError('');

    const cleanName = fullName.trim();
    if (!cleanName) {
      setError('Nama lengkap wajib diisi.');
      return;
    }

    let finalClass = '-';
    if (role === 'siswa') {
      if (isCustomClass) {
        const cleanedCustom = normalizeClassName(customClassName);
        if (!cleanedCustom) {
          setError('Silakan ketik nama kelas Anda (contoh: 7K, 8 Tahfidz).');
          return;
        }
        finalClass = cleanedCustom;

        // Auto-save the new class to the 'classrooms' collection if not already in DB (non-blocking with timeout)
        const alreadyExists = classOptions.some(c => c.toUpperCase() === finalClass.toUpperCase());
        if (!alreadyExists) {
          withOnboardingTimeout(
            addDoc(collection(db, 'classrooms'), {
              name: finalClass,
              gradeLevel: getGradeLevelFromClass(finalClass),
              createdAt: serverTimestamp(),
              createdBy: user.uid
            }),
            2000
          ).catch((clsErr) => {
            console.warn('Could not auto-add classroom document:', clsErr);
          });
        }
      } else {
        finalClass = selectedClass || '7A';
      }
    }
    
    setLoading(true);
    try {
      const isSuper = isSuperAdminEmail(user.email);
      // Admin otomatis disetujui, pendaftar lain langsung aktif sebagai role pilihannya agar tidak tertahan
      const assignedRole = isSuper ? 'admin' : role;

      const profilePayload = {
        id: user.uid,
        uid: user.uid,
        username: cleanName,
        email: user.email?.toLowerCase() || '',
        role: assignedRole,
        requestedRole: role,
        nis: role === 'siswa' ? (nis.trim() || '') : '',
        kelas: role === 'siswa' ? finalClass : '-',
        ruang: role === 'siswa' ? (ruang || '-') : '-',
        verified: true,
        isRegistrationComplete: true,
        isProfileCompletedByUser: Boolean(role === 'siswa' ? (nis.trim() && user.email) : user.email),
      };

      // 1. Simpan di cache lokal & registri user terlebih dahulu (0ms)
      saveUpdatedUserLocally(profilePayload);
      try {
        localStorage.setItem(`cached_user_profile_${user.uid}`, JSON.stringify(profilePayload));
      } catch (e) {}

      // 2. Sinkronkan ke Google Spreadsheet & Firestore di latar belakang dengan proteksi timeout agar tidak pernah mutar terus
      upsertUserToSpreadsheet(profilePayload).catch(() => {});
      const userDocRef = doc(db, 'users', user.uid);
      await withOnboardingTimeout(
        setDoc(userDocRef, {
          ...profilePayload,
          updatedAt: serverTimestamp(),
          createdAt: userProfile?.createdAt || serverTimestamp(),
        }, { merge: true }),
        2200
      ).catch((fsErr: any) => {
        console.warn('Could not write to Firestore (quota or offline), proceeding with local cache:', fsErr);
      });

      if (onComplete) onComplete();
    } catch (err: any) {
      console.error('Error saving registration profile:', err);
      setError(err.message || 'Gagal menyimpan data identitas. Silakan coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50/50 via-gray-50 to-white flex flex-col items-center justify-center p-4 py-8">
      <div className="w-full max-w-xl bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-6 sm:p-8 text-white relative">
          <div className="flex items-center justify-between mb-4">
            <span className="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-semibold uppercase tracking-wider">
              Langkah Terakhir Pendaftaran
            </span>
            <button 
              onClick={logout}
              className="text-xs text-white/80 hover:text-white flex items-center gap-1.5 transition-colors"
              title="Keluar akun"
            >
              <LogOut size={14} /> Ganti Akun
            </button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Lengkapi Data Identitas</h1>
          <p className="text-blue-100 text-xs sm:text-sm mt-1 max-w-md">
            Pilih peran Anda dan lengkapi data agar langsung terkelompok di sistem ujian.
          </p>
          <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center font-bold text-sm">
              {user?.email?.charAt(0).toUpperCase()}
            </div>
            <div className="text-xs">
              <p className="text-white/70">Terhubung sebagai:</p>
              <p className="font-semibold text-white truncate max-w-xs">{user?.email}</p>
            </div>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-2xl text-xs font-medium flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Role Selection */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block">
              Daftar Sebagai / Role:
            </label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setRole('siswa')}
                className={`p-3.5 sm:p-4 rounded-2xl border-2 text-center transition-all flex flex-col items-center gap-2 ${
                  role === 'siswa'
                    ? 'border-blue-600 bg-blue-50/60 text-blue-700 shadow-md shadow-blue-100'
                    : 'border-gray-200 hover:border-gray-300 text-gray-600'
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  role === 'siswa' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'
                }`}>
                  <GraduationCap size={22} />
                </div>
                <div>
                  <p className="font-bold text-xs sm:text-sm">Siswa</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Peserta Ujian</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRole('pengawas')}
                className={`p-3.5 sm:p-4 rounded-2xl border-2 text-center transition-all flex flex-col items-center gap-2 ${
                  role === 'pengawas'
                    ? 'border-indigo-600 bg-indigo-50/60 text-indigo-700 shadow-md shadow-indigo-100'
                    : 'border-gray-200 hover:border-gray-300 text-gray-600'
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  role === 'pengawas' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500'
                }`}>
                  <UserCheck size={22} />
                </div>
                <div>
                  <p className="font-bold text-xs sm:text-sm">Pengawas</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Guru / Proktor</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRole('admin')}
                className={`p-3.5 sm:p-4 rounded-2xl border-2 text-center transition-all flex flex-col items-center gap-2 ${
                  role === 'admin'
                    ? 'border-purple-600 bg-purple-50/60 text-purple-700 shadow-md shadow-purple-100'
                    : 'border-gray-200 hover:border-gray-300 text-gray-600'
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  role === 'admin' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-500'
                }`}>
                  <Shield size={22} />
                </div>
                <div>
                  <p className="font-bold text-xs sm:text-sm">Admin</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Panitia Utama</p>
                </div>
              </button>
            </div>
          </div>

          {/* Full Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
              <User size={14} className="text-blue-600" /> Nama Lengkap Sesuai Dokumen
            </label>
            <input 
              type="text"
              required
              placeholder="Masukkan nama lengkap Anda"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all text-sm font-medium text-gray-900"
            />
          </div>

          {/* SISWA SPECIFIC FIELDS */}
          {role === 'siswa' && (
            <div className="space-y-5 pt-2 border-t border-gray-100">
              
              {/* NIS - OPTIONAL */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
                    <Hash size={14} className="text-blue-600" /> Nomor Induk Siswa (NIS)
                  </label>
                  <span className="text-[11px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-semibold">
                    Opsional / Boleh Kosong
                  </span>
                </div>
                <input 
                  type="text"
                  placeholder="Contoh: 240101 (Kosongkan jika belum punya)"
                  value={nis}
                  onChange={(e) => setNis(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all text-sm font-medium text-gray-900"
                />
                <p className="text-[11px] text-gray-400">
                  *Siswa baru atau kelas 7 yang belum memiliki NIS dari sekolah boleh mengosongkan kolom ini.
                </p>
              </div>

              {/* Class Selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
                  <School size={14} className="text-blue-600" /> Kelas
                </label>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <select
                      value={isCustomClass ? '__custom__' : selectedClass}
                      onChange={(e) => {
                        if (e.target.value === '__custom__') {
                          setIsCustomClass(true);
                        } else {
                          setIsCustomClass(false);
                          setSelectedClass(e.target.value);
                        }
                      }}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all text-sm font-semibold text-gray-800"
                    >
                      <optgroup label="Kelas VII">
                        {classOptions.filter(c => getGradeLevelFromClass(c) === 'Kelas VII').map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Kelas VIII">
                        {classOptions.filter(c => getGradeLevelFromClass(c) === 'Kelas VIII').map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Kelas IX">
                        {classOptions.filter(c => getGradeLevelFromClass(c) === 'Kelas IX').map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </optgroup>
                      <option value="__custom__" className="text-blue-600 font-bold">
                        ✍️ + Ketik Kelas Lain...
                      </option>
                    </select>
                  </div>

                  <div>
                    {isCustomClass ? (
                      <div className="relative animate-in fade-in zoom-in-95 duration-200">
                        <input 
                          type="text"
                          required={isCustomClass}
                          placeholder="Ketik nama kelas (cth: 7K)"
                          value={customClassName}
                          onChange={(e) => setCustomClassName(e.target.value)}
                          className="w-full px-4 py-3 bg-blue-50/60 border-2 border-blue-500 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all text-sm font-bold text-blue-900 uppercase"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsCustomClass(true)}
                        className="w-full h-full py-3 px-3 border border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50/50 rounded-xl text-xs font-semibold text-gray-500 hover:text-blue-600 flex items-center justify-center gap-1.5 transition-all"
                      >
                        <Plus size={14} /> Kelas Belum Ada? Ketik Sendiri
                      </button>
                    )}
                  </div>
                </div>

                {isCustomClass && (
                  <p className="text-[11px] text-blue-600 font-medium">
                    ✓ Kelas baru yang Anda ketik akan otomatis disimpan ke sistem dan menjadi pilihan dropdown bagi siswa lain.
                  </p>
                )}
              </div>

              {/* Room (Ruang) - Optional */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
                  <Building2 size={14} className="text-blue-600" /> Ruang Ujian (Opsional)
                </label>
                <select
                  value={ruang}
                  onChange={(e) => setRuang(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all text-sm font-medium text-gray-800"
                >
                  <option value="-">- Belum Ditentukan -</option>
                  {roomOptions.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* PENGAWAS & ADMIN INFO */}
          {role === 'pengawas' && (
            <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl text-xs text-indigo-800 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <UserCheck size={16} /> Konfirmasi Pendaftaran Pengawas
              </p>
              <p className="text-indigo-600">
                Sebagai Pengawas, Anda dapat merilis token ujian, memantau absensi peserta, dan melihat laporan integritas ujian secara real-time.
              </p>
            </div>
          )}

          {role === 'admin' && (
            <div className="p-4 bg-purple-50 border border-purple-100 rounded-2xl text-xs text-purple-800 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <Shield size={16} /> Akses Administrator Panitia
              </p>
              <p className="text-purple-600">
                Anda mendaftar sebagai Admin. Pendaftaran ini akan terhubung ke panel manajemen ujian dan kelola data master seluruh pengguna.
              </p>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-200 transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-70 disabled:cursor-not-allowed text-sm sm:text-base"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <>
                <span>Simpan Identitas & Selesaikan</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
