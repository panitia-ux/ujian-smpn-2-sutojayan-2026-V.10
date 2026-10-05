import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Copy,
  Check,
  RefreshCw,
  UploadCloud,
  DownloadCloud,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Database,
  ShieldCheck,
  ExternalLink
} from 'lucide-react';
import {
  GOOGLE_APPS_SCRIPT_TEMPLATE,
  fetchMasterFromSpreadsheet,
  pushAllMasterToSpreadsheet,
  getSavedSpreadsheetUrl,
  saveSpreadsheetUrlLocally
} from '../lib/spreadsheetService';

interface SpreadsheetDatabasePanelProps {
  appSettings: any;
  setAppSettings: React.Dispatch<React.SetStateAction<any>>;
  onSaveSettingsUrl: (url: string) => Promise<void>;
  users: any[];
  exams: any[];
  subjects: any[];
  schedules?: any[];
  masterPlan?: any[];
  onApplySpreadsheetData: (data: {
    users: any[];
    exams: any[];
    subjects?: any[];
    schedules?: any[];
    masterPlan?: any[];
    appSettings?: any;
  }) => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export const SpreadsheetDatabasePanel: React.FC<SpreadsheetDatabasePanelProps> = ({
  appSettings,
  setAppSettings,
  onSaveSettingsUrl,
  users,
  exams,
  subjects,
  schedules,
  masterPlan,
  onApplySpreadsheetData,
  showToast
}) => {
  const [webAppUrl, setWebAppUrl] = useState<string>(() =>
    getSavedSpreadsheetUrl(appSettings?.spreadsheetWebAppUrl)
  );
  const [copiedScript, setCopiedScript] = useState(false);
  const [showStepGuide, setShowStepGuide] = useState(true);
  const [showScriptPreview, setShowScriptPreview] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [statusInfo, setStatusInfo] = useState<{
    type: 'idle' | 'success' | 'error';
    message: string;
  }>({ type: 'idle', message: '' });

  // Sinkronkan bila appSettings baru dimuat dari penyimpanan lokal / Spreadsheet / Firebase
  React.useEffect(() => {
    if (appSettings?.spreadsheetWebAppUrl && appSettings.spreadsheetWebAppUrl !== webAppUrl) {
      setWebAppUrl(appSettings.spreadsheetWebAppUrl);
      saveSpreadsheetUrlLocally(appSettings.spreadsheetWebAppUrl);
    }
  }, [appSettings?.spreadsheetWebAppUrl]);

  const handleCopyAppsScript = async () => {
    try {
      await navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_TEMPLATE);
      setCopiedScript(true);
      showToast('Kode Google Apps Script berhasil disalin! Silakan tempel di menu Ekstensi > Apps Script.', 'success');
      setTimeout(() => setCopiedScript(false), 3500);
    } catch (e) {
      showToast('Gagal menyalin otomatis, silakan buka pratinjau kode dan salin manual.', 'error');
      setShowScriptPreview(true);
    }
  };

  const handleSaveAndTestUrl = async () => {
    const clean = webAppUrl.trim();
    saveSpreadsheetUrlLocally(clean);
    setAppSettings((prev: any) => ({ ...prev, spreadsheetWebAppUrl: clean }));

    if (!clean) {
      onSaveSettingsUrl('').catch(() => {});
      setStatusInfo({
        type: 'idle',
        message: 'URL Spreadsheet dikosongkan. Sistem menggunakan penyimpanan lokal & cadangan ke-2.'
      });
      showToast('URL Spreadsheet dikosongkan.', 'success');
      return;
    }

    if (!clean.startsWith('https://script.google.com/')) {
      setStatusInfo({
        type: 'error',
        message: 'Format URL harus diawali https://script.google.com/macros/s/.../exec'
      });
      showToast('URL harus berasal dari deployment Google Apps Script Web App.', 'error');
      return;
    }

    setIsTesting(true);
    setStatusInfo({ type: 'idle', message: 'Menyimpan URL & menguji koneksi ke Google Spreadsheet (Database Utama)...' });
    try {
      // Non-blocking save ke cadangan ke-2 (Firebase) agar tidak pernah menahan proses Spreadsheet
      onSaveSettingsUrl(clean).catch(() => {});
      const res = await fetchMasterFromSpreadsheet(clean, true);
      if (res.ok) {
        setStatusInfo({
          type: 'success',
          message: `Terhubung ke Database Utama! Ditemukan ${res.users?.length || 0} Data User & ${res.exams?.length || 0} Alamat Soal di Google Spreadsheet.`
        });
        showToast('Koneksi Google Spreadsheet (Database Utama) berhasil & siap digunakan!', 'success');
      } else {
        setStatusInfo({
          type: 'error',
          message: `URL tersimpan, namun tes baca gagal: ${res.message || 'Pastikan akses Web App diatur ke "Siapa saja / Anyone"'}`
        });
      }
    } catch (err: any) {
      setStatusInfo({
        type: 'error',
        message: err?.message || 'Gagal menguji koneksi Spreadsheet.'
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handlePushToSpreadsheet = async () => {
    const clean = webAppUrl.trim();
    if (!clean) {
      showToast('Masukkan URL Web App Google Apps Script terlebih dahulu.', 'error');
      return;
    }
    setIsPushing(true);
    setStatusInfo({ type: 'idle', message: 'Menulis seluruh Data User, Alamat Soal, Jadwal & Konfigurasi ke Google Spreadsheet (Database Utama)...' });
    try {
      saveSpreadsheetUrlLocally(clean);
      onSaveSettingsUrl(clean).catch(() => {});
      const res = await pushAllMasterToSpreadsheet(clean, {
        users,
        exams,
        subjects,
        schedules,
        masterPlan,
        appSettings: { ...appSettings, spreadsheetWebAppUrl: clean }
      });
      if (res.ok) {
        setStatusInfo({
          type: 'success',
          message: res.message || 'Data User, Soal, Jadwal & Konfigurasi berhasil dikirim ke Google Spreadsheet!'
        });
        showToast(res.message || 'Berhasil mengirim data ke Google Spreadsheet!', 'success');
      } else {
        setStatusInfo({
          type: 'error',
          message: res.message || 'Gagal menulis data ke Google Spreadsheet.'
        });
        showToast(res.message || 'Gagal menulis ke Spreadsheet.', 'error');
      }
    } finally {
      setIsPushing(false);
    }
  };

  const handlePullFromSpreadsheet = async () => {
    const clean = webAppUrl.trim();
    if (!clean) {
      showToast('Masukkan URL Web App Google Apps Script terlebih dahulu.', 'error');
      return;
    }
    setIsPulling(true);
    setStatusInfo({ type: 'idle', message: 'Menarik Data User, Alamat Soal, Jadwal & Konfigurasi dari Google Spreadsheet (Database Utama)...' });
    try {
      saveSpreadsheetUrlLocally(clean);
      onSaveSettingsUrl(clean).catch(() => {});
      const res = await fetchMasterFromSpreadsheet(clean, true);
      if (res.ok) {
        const pulledUsers = res.users || [];
        const pulledExams = res.exams || [];
        if (pulledUsers.length === 0 && pulledExams.length === 0 && !res.appSettings) {
          setStatusInfo({
            type: 'error',
            message: 'Spreadsheet masih kosong. Klik tombol "Kirim Data Aplikasi ke Spreadsheet" terlebih dahulu untuk mengisi otomatis.'
          });
          showToast('Spreadsheet masih kosong. Silakan klik Kirim Data Aplikasi ke Spreadsheet dulu.', 'error');
        } else {
          onApplySpreadsheetData({
            users: pulledUsers,
            exams: pulledExams,
            subjects: res.subjects,
            schedules: res.schedules,
            masterPlan: res.masterPlan,
            appSettings: res.appSettings
          });
          setStatusInfo({
            type: 'success',
            message: `Berhasil menarik ${pulledUsers.length} User, ${pulledExams.length} Soal${res.appSettings ? ' & Pengaturan/Menu Custom' : ''} dari Google Spreadsheet ke Aplikasi!`
          });
          showToast(`Berhasil menarik ${pulledUsers.length} User & ${pulledExams.length} Soal dari Spreadsheet!`, 'success');
        }
      } else {
        setStatusInfo({
          type: 'error',
          message: res.message || 'Gagal menarik data dari Google Spreadsheet.'
        });
        showToast(res.message || 'Gagal menarik data dari Spreadsheet.', 'error');
      }
    } finally {
      setIsPulling(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-6 sm:p-8 rounded-3xl border-2 border-emerald-200 shadow-sm space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-emerald-100 pb-5">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-200">
            <FileSpreadsheet size={24} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-extrabold text-gray-900">
                Database Hybrid: Google Spreadsheet (Utama) + Firebase (Cadangan Ke-2)
              </h3>
              <span className="px-2.5 py-0.5 bg-emerald-600 text-white rounded-full text-[10px] font-extrabold uppercase tracking-wider">
                Baca & Tulis 2 Arah (Apps Script)
              </span>
            </div>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              <strong>Pemeriksaan Ke-1 (Utama):</strong> Mengambil & menulis <strong>Nama User</strong> serta <strong>Alamat Soal</strong> langsung di Google Spreadsheet (0 Kuota Firebase).{' '}
              <strong>Pemeriksaan Ke-2 (Cadangan Otomatis):</strong> Jika Spreadsheet sedang error/kosong, sistem otomatis mengambil dari Firebase tanpa gangguan.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowStepGuide(!showStepGuide)}
          className="px-3.5 py-2 bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl font-bold text-xs flex items-center gap-1.5 shrink-0 cursor-pointer transition-all"
        >
          <HelpCircle size={15} />
          <span>{showStepGuide ? 'Sembunyikan Panduan' : 'Lihat Panduan Step-by-Step'}</span>
          {showStepGuide ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {/* Ringkasan Arsitektur Pemeriksaan Ke-1 & Ke-2 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-4 bg-white rounded-2xl border border-emerald-200 flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-black text-xs shrink-0">
            1
          </div>
          <div>
            <p className="text-xs font-extrabold text-emerald-900 uppercase">
              Pemeriksaan Ke-1: Google Spreadsheet (Utama)
            </p>
            <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">
              Menyimpan <strong>DATA_USER</strong> (Siswa, Pengawas, Admin) & <strong>DATA_SOAL</strong> (Link Google Form). Bisa diedit dari Excel/Spreadsheet maupun langsung dari aplikasi ini.
            </p>
          </div>
        </div>
        <div className="p-4 bg-white rounded-2xl border border-blue-200 flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-black text-xs shrink-0">
            2
          </div>
          <div>
            <p className="text-xs font-extrabold text-blue-900 uppercase">
              Pemeriksaan Ke-2: Firebase (Cadangan + Transaksi)
            </p>
            <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">
              Data di Firebase <strong>tidak dihapus</strong> melainkan menjadi cadangan otomatis apabila Spreadsheet gagal diakses, sekaligus menangani transaksi real-time (pelanggaran, status ujian, reset kunci).
            </p>
          </div>
        </div>
      </div>

      {/* Panduan Step-by-Step Lengkap */}
      {showStepGuide && (
        <div className="bg-white rounded-2xl border border-emerald-200 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
            <h4 className="text-xs font-extrabold text-emerald-950 uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck size={16} className="text-emerald-600" />
              Panduan Step-by-Step Menghubungkan Google Spreadsheet (Hanya 3 Menit)
            </h4>
            <a
              href="https://sheets.new"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-800 underline"
            >
              <span>Buka Google Spreadsheet Baru (sheets.new)</span>
              <ExternalLink size={13} />
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-700">
            <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-1.5">
              <p className="font-extrabold text-gray-900">Langkah 1: Buat File Google Spreadsheet</p>
              <p className="text-[11px] text-gray-600 leading-relaxed">
                Buka Google Drive sekolah/pribadi, buat <strong>Google Spreadsheet kosong baru</strong>, beri nama misalnya: <code className="bg-white px-1.5 py-0.5 rounded border">DATABASE UJIAN SMPN 2 SUTOJAYAN</code>. (Tidak perlu membuat kolom manual karena akan dibuat otomatis).
              </p>
            </div>

            <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
              <p className="font-extrabold text-gray-900">Langkah 2: Tempel Kode Google Apps Script</p>
              <p className="text-[11px] text-gray-600 leading-relaxed">
                Di menu atas Spreadsheet, klik <strong>Ekstensi (Extensions) &rarr; Apps Script</strong>. Hapus kode bawaan <code className="bg-white px-1 rounded">function myFunction()</code>, lalu klik tombol di bawah untuk menyalin kode dan tempel (Paste) di sana:
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCopyAppsScript}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
                >
                  {copiedScript ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedScript ? 'Kode Berhasil Disalin!' : 'Salin Kode Google Apps Script'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowScriptPreview(!showScriptPreview)}
                  className="px-2.5 py-1.5 bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 rounded-lg font-bold text-[11px] cursor-pointer"
                >
                  {showScriptPreview ? 'Tutup Kode' : 'Lihat Kode'}
                </button>
              </div>
            </div>

            <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-1.5">
              <p className="font-extrabold text-gray-900">Langkah 3: Terapkan Sebagai Aplikasi Web (Deploy)</p>
              <p className="text-[11px] text-gray-600 leading-relaxed">
                1. Tekan ikon <strong>Simpan (💾)</strong> di Apps Script.<br />
                2. Klik tombol biru <strong>Terapkan (Deploy) &rarr; Deployment baru</strong>.<br />
                3. Pilih jenis: <strong>Aplikasi Web (Web app)</strong>.<br />
                4. Jalankan sebagai: <strong>Saya (Me)</strong>.<br />
                5. Yang memiliki akses: Wajib pilih <strong>Siapa saja (Anyone)</strong>.<br />
                6. Klik <strong>Terapkan</strong> (jika muncul izin akses, klik <em>Izinkan / Advanced &rarr; Go to Project</em>).
              </p>
            </div>

            <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-1.5">
              <p className="font-extrabold text-gray-900">Langkah 4: Salin URL Web App & Klik Kirim Data</p>
              <p className="text-[11px] text-gray-600 leading-relaxed">
                Salin <strong>URL Aplikasi Web</strong> (berakhiran <code className="bg-white px-1 rounded">/exec</code>), tempel pada kolom di bawah, klik <strong>Simpan & Tes Koneksi</strong>, lalu klik <strong>Kirim Data Aplikasi ke Spreadsheet</strong> agar sheet <code className="bg-white px-1 rounded">DATA_USER</code> dan <code className="bg-white px-1 rounded">DATA_SOAL</code> langsung terisi otomatis!
              </p>
            </div>
          </div>

          {showScriptPreview && (
            <div className="mt-3">
              <div className="flex items-center justify-between bg-gray-900 text-gray-200 px-4 py-2 rounded-t-xl text-[11px] font-mono">
                <span>Kode.gs (Google Apps Script)</span>
                <button
                  type="button"
                  onClick={handleCopyAppsScript}
                  className="text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Copy size={12} />
                  <span>Salin Semua</span>
                </button>
              </div>
              <pre className="bg-gray-950 text-emerald-300 p-4 rounded-b-xl text-[11px] font-mono overflow-x-auto max-h-64 leading-relaxed">
                {GOOGLE_APPS_SCRIPT_TEMPLATE}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Input URL Web App & Tombol Aksi 2 Arah */}
      <div className="bg-white p-5 rounded-2xl border border-emerald-200 space-y-4">
        <div>
          <label className="block text-xs font-extrabold text-gray-700 uppercase mb-2">
            URL Web App Google Apps Script (Berakhiran <code className="text-emerald-700">/exec</code>)
          </label>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="url"
              value={webAppUrl}
              onChange={(e) => setWebAppUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/AKfycb.../exec"
              className="flex-1 px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none font-mono text-xs text-gray-800"
            />
            <button
              type="button"
              onClick={handleSaveAndTestUrl}
              disabled={isTesting}
              className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl font-extrabold text-xs flex items-center justify-center gap-2 shrink-0 cursor-pointer shadow-sm transition-all"
            >
              <RefreshCw size={15} className={isTesting ? 'animate-spin' : ''} />
              <span>{isTesting ? 'Menguji...' : 'Simpan & Tes Koneksi'}</span>
            </button>
          </div>
        </div>

        {/* Status Koneksi */}
        {statusInfo.message && (
          <div
            className={`p-3.5 rounded-xl border text-xs font-bold flex items-start gap-2.5 ${
              statusInfo.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : statusInfo.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}
          >
            {statusInfo.type === 'success' ? (
              <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-emerald-600" />
            ) : (
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
            )}
            <span>{statusInfo.message}</span>
          </div>
        )}

        {/* Tombol Sinkronisasi 2 Arah */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            onClick={handlePushToSpreadsheet}
            disabled={isPushing || !webAppUrl.trim()}
            className="p-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-2xl font-extrabold text-xs flex items-center justify-center gap-2.5 shadow-md shadow-emerald-100 cursor-pointer transition-all"
          >
            <UploadCloud size={18} className={isPushing ? 'animate-bounce' : ''} />
            <div className="text-left">
              <div>{isPushing ? 'Menulis ke Spreadsheet...' : '📤 Kirim Data Aplikasi ke Spreadsheet'}</div>
              <div className="text-[10px] font-normal text-emerald-100">
                Tulis {users.length} Akun User & {exams.length} Soal ke Sheet otomatis
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={handlePullFromSpreadsheet}
            disabled={isPulling || !webAppUrl.trim()}
            className="p-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-2xl font-extrabold text-xs flex items-center justify-center gap-2.5 shadow-md shadow-blue-100 cursor-pointer transition-all"
          >
            <DownloadCloud size={18} className={isPulling ? 'animate-bounce' : ''} />
            <div className="text-left">
              <div>{isPulling ? 'Menarik dari Spreadsheet...' : '📥 Tarik Data dari Spreadsheet ke Aplikasi'}</div>
              <div className="text-[10px] font-normal text-blue-100">
                Muat pembaruan Nama User & Link Soal dari Google Sheet
              </div>
            </div>
          </button>
        </div>

        <p className="text-[11px] text-gray-500 flex items-center gap-1.5 pt-1">
          <Database size={13} className="text-emerald-600 shrink-0" />
          <span>
            <strong>Sinkronisasi Otomatis Aktif:</strong> Setiap kali Admin menambah/mengubah User atau Soal Ujian di aplikasi, data otomatis ditulis ke Google Spreadsheet (Utama) sekaligus disimpan di Firebase (Pemeriksaan Ke-2).
          </span>
        </p>
      </div>
    </div>
  );
};
