import React, { useState, useEffect, useMemo } from 'react';
import {
  FileSpreadsheet,
  Megaphone,
  Plus,
  Edit,
  Trash2,
  ExternalLink,
  RefreshCw,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
  CheckCircle2,
  X,
  Settings,
  Bell,
  Users,
  School,
  Layers,
  Check,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Shield,
} from 'lucide-react';

export interface CustomPortalItem {
  id: string;
  title: string;
  category: 'spreadsheet' | 'announcement' | 'both';
  spreadsheetUrl: string;
  embedUrl: string;
  announcementText: string;
  badgeText?: string;
  targetRole: 'all' | 'siswa' | 'pengawas' | 'custom';
  targetClass?: string;
  // Kontrol visibilitas spesifik per menu
  visibleToSupervisor?: boolean;
  visibleToStudent?: boolean;
  studentScope?: 'all_students' | 'by_grade' | 'by_class';
  allowedGrades?: string[]; // ['7', '8', '9']
  allowedClasses?: string[]; // ['7A', '7B', ...]
  order?: number;
  isActive: boolean;
  showInPopup: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomPortalConfig {
  menuTitle: string;
  menuSubtitle?: string;
  enabledForSupervisor: boolean;
  enabledForStudent: boolean;
  enableStartupPopup: boolean;
  popupFrequency: 'every_open' | 'once_per_session' | 'once_per_update';
  items: CustomPortalItem[];
}

export const DEFAULT_CUSTOM_PORTAL_CONFIG: CustomPortalConfig = {
  menuTitle: 'Hasil Ujian / Nilai',
  menuSubtitle: 'Daftar Nilai Hasil Ujian & Pengumuman Resmi Sekolah',
  enabledForSupervisor: true,
  enabledForStudent: true,
  enableStartupPopup: true,
  popupFrequency: 'every_open',
  items: [],
};

/**
 * Mengonversi link Google Spreadsheet / Google Docs / Google Drive biasa menjadi format /preview
 * agar tampil bersih sebagai tabel datar tanpa toolbar edit.
 */
export const toSpreadsheetPreviewUrl = (rawUrl: string): string => {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';

  try {
    if (trimmed.includes('/spreadsheets/d/e/') && trimmed.includes('/pubhtml')) {
      const glue = trimmed.includes('?') ? '&' : '?';
      return trimmed.includes('widget=true') ? trimmed : `${trimmed}${glue}widget=true&headers=false`;
    }

    const gidMatch = trimmed.match(/[?#&]gid=([0-9]+)/i);
    const gidParam = gidMatch ? `gid=${gidMatch[1]}` : '';

    const sheetMatch = trimmed.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
    if (sheetMatch && sheetMatch[1] && sheetMatch[1] !== 'e') {
      const gidPart = gidParam ? `&${gidParam}` : '';
      return `https://docs.google.com/spreadsheets/d/${sheetMatch[1]}/preview?widget=true&headers=false${gidPart}`;
    }

    const docMatch = trimmed.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/i);
    if (docMatch && docMatch[1] && docMatch[1] !== 'e') {
      return `https://docs.google.com/document/d/${docMatch[1]}/preview`;
    }

    const driveMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9-_]+)/i);
    if (driveMatch && driveMatch[1]) {
      return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;
    }

    return trimmed;
  } catch {
    return trimmed;
  }
};

export const sanitizeCustomPortalConfig = (raw?: any): CustomPortalConfig => {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_CUSTOM_PORTAL_CONFIG, items: [] };
  }
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const cleanItems: CustomPortalItem[] = itemsRaw
    .filter((it: any) => it && typeof it === 'object' && it.id)
    .map((it: any, idx: number) => {
      const rawSheetUrl = String(it.spreadsheetUrl || '').trim();
      const legacyRole =
        it.targetRole === 'siswa' ||
        it.targetRole === 'pengawas' ||
        it.targetRole === 'custom' ||
        it.targetRole === 'all'
          ? it.targetRole
          : 'all';
      const legacyClass = String(it.targetClass || 'ALL').trim() || 'ALL';

      // Migrasi otomatis dari properti lama ke kontrol visibilitas baru
      const visibleToSupervisor =
        typeof it.visibleToSupervisor === 'boolean'
          ? it.visibleToSupervisor
          : legacyRole !== 'siswa';

      const visibleToStudent =
        typeof it.visibleToStudent === 'boolean'
          ? it.visibleToStudent
          : legacyRole !== 'pengawas';

      let studentScope: 'all_students' | 'by_grade' | 'by_class' =
        it.studentScope === 'by_grade' ||
        it.studentScope === 'by_class' ||
        it.studentScope === 'all_students'
          ? it.studentScope
          : 'all_students';

      let allowedGrades: string[] = Array.isArray(it.allowedGrades)
        ? it.allowedGrades.map((g: any) => String(g).trim()).filter(Boolean)
        : [];

      let allowedClasses: string[] = Array.isArray(it.allowedClasses)
        ? it.allowedClasses.map((c: any) => String(c).toUpperCase().trim()).filter(Boolean)
        : [];

      if (!it.studentScope && legacyClass !== 'ALL') {
        if (legacyClass === 'GRADE_7') {
          studentScope = 'by_grade';
          allowedGrades = ['7'];
        } else if (legacyClass === 'GRADE_8') {
          studentScope = 'by_grade';
          allowedGrades = ['8'];
        } else if (legacyClass === 'GRADE_9') {
          studentScope = 'by_grade';
          allowedGrades = ['9'];
        } else {
          studentScope = 'by_class';
          allowedClasses = [legacyClass.toUpperCase()];
        }
      }

      return {
        id: String(it.id),
        title: String(it.title || 'Daftar Nilai / Pengumuman').trim(),
        category:
          it.category === 'announcement' || it.category === 'both' || it.category === 'spreadsheet'
            ? it.category
            : rawSheetUrl && it.announcementText
            ? 'both'
            : rawSheetUrl
            ? 'spreadsheet'
            : 'announcement',
        spreadsheetUrl: rawSheetUrl,
        embedUrl: rawSheetUrl ? toSpreadsheetPreviewUrl(rawSheetUrl) : '',
        announcementText: String(it.announcementText || ''),
        badgeText: String(it.badgeText || '').trim(),
        targetRole: legacyRole,
        targetClass: legacyClass,
        visibleToSupervisor,
        visibleToStudent,
        studentScope,
        allowedGrades,
        allowedClasses,
        order: typeof it.order === 'number' ? it.order : idx,
        isActive: it.isActive !== false,
        showInPopup: Boolean(it.showInPopup),
        createdAt: String(it.createdAt || new Date().toISOString()),
        updatedAt: String(it.updatedAt || new Date().toISOString()),
      };
    });

  return {
    menuTitle:
      String(raw.menuTitle || DEFAULT_CUSTOM_PORTAL_CONFIG.menuTitle).trim() ||
      DEFAULT_CUSTOM_PORTAL_CONFIG.menuTitle,
    menuSubtitle:
      raw.menuSubtitle !== undefined
        ? String(raw.menuSubtitle)
        : DEFAULT_CUSTOM_PORTAL_CONFIG.menuSubtitle,
    enabledForSupervisor: raw.enabledForSupervisor !== false,
    enabledForStudent: raw.enabledForStudent !== false,
    enableStartupPopup: raw.enableStartupPopup !== false,
    popupFrequency:
      raw.popupFrequency === 'once_per_session' ||
      raw.popupFrequency === 'once_per_update' ||
      raw.popupFrequency === 'every_open'
        ? raw.popupFrequency
        : 'every_open',
    items: cleanItems,
  };
};

/**
 * Mengecek apakah sebuah menu/tab item sesuai dengan Role & Kelas pengguna saat ini
 */
export const isPortalItemVisibleToUser = (
  item: CustomPortalItem,
  role: 'admin' | 'pengawas' | 'siswa',
  studentClass?: string
): boolean => {
  if (!item.isActive) return false;
  if (role === 'admin') return true;

  if (role === 'pengawas') {
    return item.visibleToSupervisor !== false;
  }

  if (role === 'siswa') {
    if (item.visibleToStudent === false) return false;

    const cleanStudentClass = String(studentClass || '').toUpperCase().trim();
    const studentGradeMatch = cleanStudentClass.match(/^([789])/);
    const studentGrade = studentGradeMatch ? studentGradeMatch[1] : '';

    if (item.studentScope === 'by_grade') {
      const grades = item.allowedGrades || [];
      if (grades.length === 0) return true;
      if (!studentGrade) return true;
      return grades.includes(studentGrade);
    }

    if (item.studentScope === 'by_class') {
      const classes = (item.allowedClasses || []).map((c) => c.toUpperCase().trim());
      if (classes.length === 0) return true;
      if (!cleanStudentClass) return true;
      return classes.includes(cleanStudentClass);
    }

    return true;
  }

  return true;
};

/**
 * Menghasilkan ringkasan teks siapa saja yang bisa melihat menu ini
 */
export const getVisibilitySummaryText = (item: CustomPortalItem): string => {
  const sup = item.visibleToSupervisor !== false;
  const stu = item.visibleToStudent !== false;

  let stuText = 'Semua Siswa (Kls 7, 8, 9)';
  if (stu) {
    if (item.studentScope === 'by_grade' && (item.allowedGrades || []).length > 0) {
      stuText = `Siswa Kelas ${(item.allowedGrades || []).join(', ')}`;
    } else if (item.studentScope === 'by_class' && (item.allowedClasses || []).length > 0) {
      stuText = `Siswa Kelas ${(item.allowedClasses || []).join(', ')}`;
    }
  }

  if (sup && stu) {
    if (item.studentScope === 'all_students' || !item.studentScope) {
      return 'Semua (Guru/Pengawas & Semua Siswa)';
    }
    return `Guru/Pengawas & ${stuText}`;
  }
  if (sup && !stu) {
    return 'Khusus Guru / Pengawas';
  }
  if (!sup && stu) {
    return `Khusus ${stuText}`;
  }
  return 'Hanya Admin (Disembunyikan dari Guru & Siswa)';
};

interface ExamResultsAndAnnouncementPortalProps {
  config: CustomPortalConfig;
  isAdmin: boolean;
  role: 'admin' | 'pengawas' | 'siswa';
  studentClass?: string;
  classrooms: { id: string; name: string }[];
  onSaveConfig: (nextConfig: CustomPortalConfig, toastMsg?: string) => Promise<void>;
  onOpenPopupPreview: () => void;
}

export const ExamResultsAndAnnouncementPortal: React.FC<ExamResultsAndAnnouncementPortalProps> = ({
  config,
  isAdmin,
  role,
  studentClass,
  classrooms,
  onSaveConfig,
  onOpenPopupPreview,
}) => {
  const cleanConfig = useMemo(() => sanitizeCustomPortalConfig(config), [config]);

  const visibleItems = useMemo(() => {
    if (isAdmin) return cleanConfig.items;
    return cleanConfig.items.filter((it) => isPortalItemVisibleToUser(it, role, studentClass));
  }, [cleanConfig.items, isAdmin, role, studentClass]);

  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [iframeRefreshKey, setIframeRefreshKey] = useState<number>(0);
  const [isFullscreenPreview, setIsFullscreenPreview] = useState<boolean>(false);

  // Admin states
  const [showConfigPanel, setShowConfigPanel] = useState<boolean>(false);
  const [showItemForm, setShowItemForm] = useState<boolean>(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Menu settings form state
  const [menuTitleInput, setMenuTitleInput] = useState(cleanConfig.menuTitle);
  const [menuSubtitleInput, setMenuSubtitleInput] = useState(cleanConfig.menuSubtitle || '');
  const [enabledForSupervisor, setEnabledForSupervisor] = useState(cleanConfig.enabledForSupervisor);
  const [enabledForStudent, setEnabledForStudent] = useState(cleanConfig.enabledForStudent);
  const [enableStartupPopup, setEnableStartupPopup] = useState(cleanConfig.enableStartupPopup);
  const [popupFrequency, setPopupFrequency] = useState<'every_open' | 'once_per_session' | 'once_per_update'>(
    cleanConfig.popupFrequency
  );

  // Item form state
  const [itemTitle, setItemTitle] = useState('');
  const [itemCategory, setItemCategory] = useState<'spreadsheet' | 'announcement' | 'both'>('spreadsheet');
  const [itemSpreadsheetUrl, setItemSpreadsheetUrl] = useState('');
  const [itemAnnouncementText, setItemAnnouncementText] = useState('');
  const [itemBadgeText, setItemBadgeText] = useState('DAFTAR NILAI');
  const [itemVisibleToSupervisor, setItemVisibleToSupervisor] = useState<boolean>(true);
  const [itemVisibleToStudent, setItemVisibleToStudent] = useState<boolean>(true);
  const [itemStudentScope, setItemStudentScope] = useState<'all_students' | 'by_grade' | 'by_class'>('all_students');
  const [itemAllowedGrades, setItemAllowedGrades] = useState<string[]>(['7', '8', '9']);
  const [itemAllowedClasses, setItemAllowedClasses] = useState<string[]>([]);
  const [itemIsActive, setItemIsActive] = useState<boolean>(true);
  const [itemShowInPopup, setItemShowInPopup] = useState<boolean>(false);
  const [formError, setFormError] = useState<string>('');

  useEffect(() => {
    setMenuTitleInput(cleanConfig.menuTitle);
    setMenuSubtitleInput(cleanConfig.menuSubtitle || '');
    setEnabledForSupervisor(cleanConfig.enabledForSupervisor);
    setEnabledForStudent(cleanConfig.enabledForStudent);
    setEnableStartupPopup(cleanConfig.enableStartupPopup);
    setPopupFrequency(cleanConfig.popupFrequency);
  }, [cleanConfig]);

  useEffect(() => {
    if (visibleItems.length > 0) {
      if (!selectedItemId || !visibleItems.some((it) => it.id === selectedItemId)) {
        const firstActive = visibleItems.find((it) => it.isActive) || visibleItems[0];
        setSelectedItemId(firstActive.id);
      }
    } else {
      setSelectedItemId('');
    }
  }, [visibleItems, selectedItemId]);

  const activeItem = useMemo(
    () => visibleItems.find((it) => it.id === selectedItemId) || visibleItems[0] || null,
    [visibleItems, selectedItemId]
  );

  // Buka form tambah dengan opsi preset cepat (misal: Kelas 7, Kelas 8, Kelas 9, Untuk Guru)
  const handleOpenAddFormWithPreset = (preset?: {
    title?: string;
    category?: 'spreadsheet' | 'announcement' | 'both';
    badgeText?: string;
    visibleToSupervisor?: boolean;
    visibleToStudent?: boolean;
    studentScope?: 'all_students' | 'by_grade' | 'by_class';
    allowedGrades?: string[];
  }) => {
    setEditingItemId(null);
    setItemTitle(preset?.title || '');
    setItemCategory(preset?.category || 'spreadsheet');
    setItemSpreadsheetUrl('');
    setItemAnnouncementText('');
    setItemBadgeText(preset?.badgeText || 'DAFTAR NILAI');
    setItemVisibleToSupervisor(preset?.visibleToSupervisor ?? true);
    setItemVisibleToStudent(preset?.visibleToStudent ?? true);
    setItemStudentScope(preset?.studentScope || 'all_students');
    setItemAllowedGrades(preset?.allowedGrades || ['7', '8', '9']);
    setItemAllowedClasses([]);
    setItemIsActive(true);
    setItemShowInPopup(cleanConfig.items.length === 0);
    setFormError('');
    setShowItemForm(true);
  };

  const handleOpenEditForm = (item: CustomPortalItem) => {
    setEditingItemId(item.id);
    setItemTitle(item.title);
    setItemCategory(item.category);
    setItemSpreadsheetUrl(item.spreadsheetUrl);
    setItemAnnouncementText(item.announcementText);
    setItemBadgeText(item.badgeText || '');
    setItemVisibleToSupervisor(item.visibleToSupervisor !== false);
    setItemVisibleToStudent(item.visibleToStudent !== false);
    setItemStudentScope(item.studentScope || 'all_students');
    setItemAllowedGrades(
      item.allowedGrades && item.allowedGrades.length > 0 ? item.allowedGrades : ['7', '8', '9']
    );
    setItemAllowedClasses(item.allowedClasses || []);
    setItemIsActive(item.isActive);
    setItemShowInPopup(item.showInPopup);
    setFormError('');
    setShowItemForm(true);
  };

  const handleSaveMenuSettings = async () => {
    setIsSaving(true);
    try {
      const nextConfig: CustomPortalConfig = {
        ...cleanConfig,
        menuTitle: menuTitleInput.trim() || 'Hasil Ujian / Nilai',
        menuSubtitle: menuSubtitleInput.trim(),
        enabledForSupervisor,
        enabledForStudent,
        enableStartupPopup,
        popupFrequency,
      };
      await onSaveConfig(nextConfig, 'Pengaturan judul menu bilah kiri & pop-up berhasil disimpan!');
      setShowConfigPanel(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const cleanTitle = itemTitle.trim();
    const cleanSheet = itemSpreadsheetUrl.trim();
    const cleanText = itemAnnouncementText.trim();

    if (!cleanTitle) {
      setFormError('Nama Tombol Menu / Judul wajib diisi (contoh: "HASIL UJIAN KELAS 7" atau "UNTUK GURU").');
      return;
    }
    if ((itemCategory === 'spreadsheet' || itemCategory === 'both') && !cleanSheet) {
      setFormError('Link Google Spreadsheet wajib diisi untuk menampilkan tabel nilai.');
      return;
    }
    if (itemCategory === 'announcement' && !cleanText) {
      setFormError('Isi teks pengumuman wajib diisi.');
      return;
    }
    if (itemVisibleToStudent && itemStudentScope === 'by_grade' && itemAllowedGrades.length === 0) {
      setFormError('Pilih minimal 1 Tingkat Kelas Siswa (Kelas 7, 8, atau 9).');
      return;
    }
    if (itemVisibleToStudent && itemStudentScope === 'by_class' && itemAllowedClasses.length === 0) {
      setFormError('Pilih minimal 1 Kelas spesifik.');
      return;
    }

    setIsSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const computedTargetRole: 'all' | 'siswa' | 'pengawas' | 'custom' =
        itemVisibleToSupervisor && itemVisibleToStudent
          ? 'all'
          : itemVisibleToSupervisor
          ? 'pengawas'
          : 'siswa';

      const newItem: CustomPortalItem = {
        id: editingItemId || `portal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title: cleanTitle,
        category: itemCategory,
        spreadsheetUrl: itemCategory === 'announcement' ? '' : cleanSheet,
        embedUrl: itemCategory === 'announcement' ? '' : toSpreadsheetPreviewUrl(cleanSheet),
        announcementText: cleanText,
        badgeText: itemBadgeText.trim() || (itemCategory === 'announcement' ? 'PENGUMUMAN' : 'DAFTAR NILAI'),
        targetRole: computedTargetRole,
        targetClass:
          !itemVisibleToStudent || itemStudentScope === 'all_students'
            ? 'ALL'
            : itemStudentScope === 'by_grade' && itemAllowedGrades.length === 1
            ? `GRADE_${itemAllowedGrades[0]}`
            : 'ALL',
        visibleToSupervisor: itemVisibleToSupervisor,
        visibleToStudent: itemVisibleToStudent,
        studentScope: itemStudentScope,
        allowedGrades: itemStudentScope === 'by_grade' ? itemAllowedGrades : ['7', '8', '9'],
        allowedClasses: itemStudentScope === 'by_class' ? itemAllowedClasses : [],
        isActive: itemIsActive,
        showInPopup: itemShowInPopup,
        createdAt: editingItemId
          ? cleanConfig.items.find((i) => i.id === editingItemId)?.createdAt || nowIso
          : nowIso,
        updatedAt: nowIso,
      };

      const nextItems = editingItemId
        ? cleanConfig.items.map((i) => (i.id === editingItemId ? newItem : i))
        : [...cleanConfig.items, newItem];

      const nextConfig: CustomPortalConfig = {
        ...cleanConfig,
        items: nextItems,
      };

      await onSaveConfig(
        nextConfig,
        editingItemId
          ? `Tombol menu "${cleanTitle}" berhasil diperbarui!`
          : `Tombol menu "${cleanTitle}" berhasil ditambahkan!`
      );
      setSelectedItemId(newItem.id);
      setShowItemForm(false);
    } finally {
      setIsSaving(false);
    }
  };

  // Update cepat siapa yang boleh melihat item langsung dari bar atas spreadsheet
  const handleQuickUpdateAudience = async (
    item: CustomPortalItem,
    patch: Partial<CustomPortalItem>,
    labelMsg: string
  ) => {
    const updatedItem: CustomPortalItem = {
      ...item,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    const nextItems = cleanConfig.items.map((i) => (i.id === item.id ? updatedItem : i));
    await onSaveConfig(
      { ...cleanConfig, items: nextItems },
      `Hak akses "${item.title}" diatur ke: ${labelMsg}`
    );
  };

  const handleMoveItemOrder = async (itemId: string, direction: 'left' | 'right') => {
    const idx = cleanConfig.items.findIndex((i) => i.id === itemId);
    if (idx === -1) return;
    const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= cleanConfig.items.length) return;

    const copy = [...cleanConfig.items];
    const temp = copy[idx];
    copy[idx] = copy[targetIdx];
    copy[targetIdx] = temp;

    await onSaveConfig({ ...cleanConfig, items: copy }, 'Urutan tombol menu diperbarui.');
  };

  const handleToggleItemActive = async (item: CustomPortalItem) => {
    const nextItems = cleanConfig.items.map((i) =>
      i.id === item.id ? { ...i, isActive: !i.isActive, updatedAt: new Date().toISOString() } : i
    );
    await onSaveConfig(
      { ...cleanConfig, items: nextItems },
      `Status tombol menu "${item.title}" diubah menjadi ${!item.isActive ? 'Aktif (Ditampilkan)' : 'Disembunyikan'}.`
    );
  };

  const handleToggleItemPopup = async (item: CustomPortalItem) => {
    const nextItems = cleanConfig.items.map((i) =>
      i.id === item.id ? { ...i, showInPopup: !i.showInPopup, updatedAt: new Date().toISOString() } : i
    );
    await onSaveConfig(
      {
        ...cleanConfig,
        items: nextItems,
        enableStartupPopup: !item.showInPopup ? true : cleanConfig.enableStartupPopup,
      },
      !item.showInPopup
        ? `"${item.title}" akan ditampilkan sebagai Pop-up saat aplikasi dibuka!`
        : `Pop-up otomatis untuk "${item.title}" dinonaktifkan.`
    );
  };

  const handleDeleteItem = async (id: string) => {
    const target = cleanConfig.items.find((i) => i.id === id);
    const nextItems = cleanConfig.items.filter((i) => i.id !== id);
    setDeleteConfirmId(null);
    await onSaveConfig(
      { ...cleanConfig, items: nextItems },
      `Menu "${target?.title || ''}" berhasil dihapus.`
    );
  };

  const toggleGradeInForm = (grade: string) => {
    setItemAllowedGrades((prev) =>
      prev.includes(grade) ? prev.filter((g) => g !== grade) : [...prev, grade].sort()
    );
  };

  const toggleClassInForm = (clsName: string) => {
    setItemAllowedClasses((prev) =>
      prev.includes(clsName) ? prev.filter((c) => c !== clsName) : [...prev, clsName]
    );
  };

  const previewConvertedUrl = useMemo(() => toSpreadsheetPreviewUrl(itemSpreadsheetUrl), [itemSpreadsheetUrl]);

  return (
    <div className="space-y-5">
      {/* Header Utama */}
      <div className="bg-white rounded-3xl border border-gray-200 p-5 sm:p-6 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-blue-100">
            <FileSpreadsheet size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight">
                {cleanConfig.menuTitle}
              </h2>
              {isAdmin && (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-blue-50 text-blue-700 border border-blue-200">
                  Kontrol Penuh Admin
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
              {cleanConfig.menuSubtitle || 'Daftar Nilai Hasil Ujian & Pengumuman Resmi Sekolah'}
            </p>
          </div>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowConfigPanel((prev) => !prev)}
              className={`px-3.5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 border transition-all cursor-pointer ${
                showConfigPanel
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200'
              }`}
            >
              <Settings size={15} />
              <span>Kustom Judul Menu & Pop-up</span>
            </button>

            {cleanConfig.items.some((i) => i.isActive) && (
              <button
                type="button"
                onClick={onOpenPopupPreview}
                className="px-3.5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 transition-all cursor-pointer"
                title="Lihat tampilan Pop-up saat aplikasi dibuka"
              >
                <Bell size={15} />
                <span>Tes Pop-up</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleOpenAddFormWithPreset()}
              className="px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-100 transition-all cursor-pointer"
            >
              <Plus size={16} />
              <span>Tambah Menu Nilai / Pengumuman</span>
            </button>
          </div>
        )}
      </div>

      {/* Baris Tombol Menu Custom di Atas Spreadsheet + Pintasan Tambah Cepat (Untuk Admin, Guru, dan Siswa) */}
      <div className="bg-white rounded-3xl border border-gray-200 p-4 sm:p-5 shadow-xs space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-blue-600 shrink-0" />
            <span className="text-xs font-extrabold uppercase tracking-wider text-gray-700">
              Pilih Menu Daftar Nilai / Pengumuman ({visibleItems.length} Menu)
            </span>
          </div>

          {/* Pintasan 1-Klik Tambah Menu per Tingkat / Guru (Khusus Admin) */}
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold text-gray-400 mr-1">Tambah Cepat:</span>
              <button
                type="button"
                onClick={() =>
                  handleOpenAddFormWithPreset({
                    title: 'HASIL UJIAN KELAS 7',
                    category: 'spreadsheet',
                    badgeText: 'KELAS 7',
                    visibleToSupervisor: true,
                    visibleToStudent: true,
                    studentScope: 'by_grade',
                    allowedGrades: ['7'],
                  })
                }
                className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 flex items-center gap-1 cursor-pointer transition-all"
              >
                <Plus size={12} /> Hasil Kelas 7
              </button>
              <button
                type="button"
                onClick={() =>
                  handleOpenAddFormWithPreset({
                    title: 'HASIL UJIAN KELAS 8',
                    category: 'spreadsheet',
                    badgeText: 'KELAS 8',
                    visibleToSupervisor: true,
                    visibleToStudent: true,
                    studentScope: 'by_grade',
                    allowedGrades: ['8'],
                  })
                }
                className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center gap-1 cursor-pointer transition-all"
              >
                <Plus size={12} /> Hasil Kelas 8
              </button>
              <button
                type="button"
                onClick={() =>
                  handleOpenAddFormWithPreset({
                    title: 'HASIL UJIAN KELAS 9',
                    category: 'spreadsheet',
                    badgeText: 'KELAS 9',
                    visibleToSupervisor: true,
                    visibleToStudent: true,
                    studentScope: 'by_grade',
                    allowedGrades: ['9'],
                  })
                }
                className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 flex items-center gap-1 cursor-pointer transition-all"
              >
                <Plus size={12} /> Hasil Kelas 9
              </button>
              <button
                type="button"
                onClick={() =>
                  handleOpenAddFormWithPreset({
                    title: 'REKAP NILAI UNTUK GURU',
                    category: 'spreadsheet',
                    badgeText: 'KHUSUS GURU',
                    visibleToSupervisor: true,
                    visibleToStudent: false,
                    studentScope: 'all_students',
                    allowedGrades: ['7', '8', '9'],
                  })
                }
                className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-200 flex items-center gap-1 cursor-pointer transition-all"
              >
                <Plus size={12} /> Untuk Guru / Pengawas
              </button>
              <button
                type="button"
                onClick={() =>
                  handleOpenAddFormWithPreset({
                    title: 'PENGUMUMAN UJIAN',
                    category: 'announcement',
                    badgeText: 'PENGUMUMAN',
                    visibleToSupervisor: true,
                    visibleToStudent: true,
                    studentScope: 'all_students',
                    allowedGrades: ['7', '8', '9'],
                  })
                }
                className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1 cursor-pointer transition-all"
              >
                <Plus size={12} /> Pengumuman
              </button>
            </div>
          )}
        </div>

        {/* Daftar Tombol Menu */}
        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          {visibleItems.map((it) => {
            const isSelected = activeItem?.id === it.id;
            const audienceShort =
              it.visibleToSupervisor !== false && it.visibleToStudent === false
                ? 'Khusus Guru'
                : it.visibleToStudent !== false &&
                  it.studentScope === 'by_grade' &&
                  (it.allowedGrades || []).length > 0
                ? `Kls ${(it.allowedGrades || []).join(',')}${it.visibleToSupervisor !== false ? ' & Guru' : ''}`
                : it.visibleToStudent !== false &&
                  it.studentScope === 'by_class' &&
                  (it.allowedClasses || []).length > 0
                ? `${(it.allowedClasses || []).join(',')}`
                : 'Semua';

            return (
              <button
                key={it.id}
                type="button"
                onClick={() => setSelectedItemId(it.id)}
                className={`px-4 py-2.5 rounded-2xl font-extrabold text-xs flex items-center gap-2 border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-100 scale-[1.01]'
                    : 'bg-gray-50 hover:bg-blue-50/60 text-gray-800 border-gray-200 hover:border-blue-300'
                }`}
              >
                {it.category === 'announcement' ? (
                  <Megaphone size={15} className="shrink-0" />
                ) : (
                  <FileSpreadsheet size={15} className="shrink-0" />
                )}
                <span className="uppercase tracking-wide">{it.title}</span>

                {isAdmin && (
                  <span
                    className={`px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-tight ${
                      isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-gray-200/80 text-gray-700'
                    }`}
                    title={`Dilihat oleh: ${getVisibilitySummaryText(it)}`}
                  >
                    👁️ {audienceShort}
                  </span>
                )}

                {it.showInPopup && (
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[9px] uppercase font-extrabold flex items-center gap-0.5 ${
                      isSelected ? 'bg-amber-300 text-amber-950' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    <Bell size={10} /> POP-UP
                  </span>
                )}

                {isAdmin && !it.isActive && (
                  <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[9px] uppercase font-extrabold">
                    NONAKTIF
                  </span>
                )}
              </button>
            );
          })}

          {isAdmin && (
            <button
              type="button"
              onClick={() => handleOpenAddFormWithPreset()}
              className="px-3.5 py-2.5 rounded-2xl font-bold text-xs flex items-center gap-1.5 border-2 border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 transition-all cursor-pointer"
            >
              <Plus size={15} />
              <span>Tambah Menu Custom</span>
            </button>
          )}
        </div>
      </div>

      {/* Panel Pengaturan Judul Menu Bilah Kiri & Pop-up (Khusus Admin) */}
      {isAdmin && showConfigPanel && (
        <div className="bg-gradient-to-br from-slate-50 to-blue-50/40 rounded-3xl border border-blue-200 p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between border-b border-blue-100 pb-4">
            <div className="flex items-center gap-2.5">
              <Settings className="text-blue-600" size={20} />
              <div>
                <h3 className="font-extrabold text-gray-900 text-base">
                  Pengaturan Nama Menu Utama di Bilah Kiri & Pop-up Otomatis
                </h3>
                <p className="text-xs text-gray-500">
                  Ubah nama menu utama di bilah kiri (sidebar) dan atur kemunculan Pop-up saat aplikasi dibuka.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowConfigPanel(false)}
              className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-white transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-3 bg-white p-4 rounded-2xl border border-gray-200">
              <div>
                <label className="block text-xs font-extrabold text-gray-700 uppercase mb-1.5">
                  Judul Menu Utama di Bilah Kiri (Sidebar)
                </label>
                <input
                  type="text"
                  value={menuTitleInput}
                  onChange={(e) => setMenuTitleInput(e.target.value)}
                  placeholder="Contoh: Hasil Ujian / Nilai"
                  className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl font-bold text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="text-[10px] font-bold text-gray-400 mr-1">Pilihan Cepat:</span>
                  {[
                    'Hasil Ujian / Nilai',
                    'Daftar Nilai & Pengumuman',
                    'Pengumuman Sekolah',
                    'Rekap Nilai PTS/PAS',
                    'Info & Hasil Ujian',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setMenuTitleInput(preset)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                        menuTitleInput === preset
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-gray-50 hover:bg-blue-50 text-gray-600 border-gray-200'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-gray-700 uppercase mb-1.5">
                  Subjudul / Keterangan Halaman
                </label>
                <input
                  type="text"
                  value={menuSubtitleInput}
                  onChange={(e) => setMenuSubtitleInput(e.target.value)}
                  placeholder="Contoh: Daftar Nilai Hasil Ujian & Pengumuman Resmi Sekolah"
                  className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl text-sm text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>

            <div className="space-y-3 bg-white p-4 rounded-2xl border border-gray-200">
              <p className="text-xs font-extrabold text-gray-700 uppercase">
                Kontrol Akses Menu Bilah Kiri & Pop-up Saat Aplikasi Dibuka
              </p>

              <div className="flex items-center justify-between p-3 bg-orange-50/60 border border-orange-200/80 rounded-xl">
                <div className="pr-3">
                  <p className="text-xs font-bold text-gray-900">Aktifkan Menu Ini untuk Role Guru / Pengawas</p>
                  <p className="text-[11px] text-gray-500">Guru/Pengawas dapat mengakses menu ini dari bilah kiri</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEnabledForSupervisor((prev) => !prev)}
                  className={`w-11 h-6 rounded-full transition-all relative shrink-0 cursor-pointer ${
                    enabledForSupervisor ? 'bg-orange-500' : 'bg-gray-300'
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all shadow-xs ${
                      enabledForSupervisor ? 'left-5.5' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between p-3 bg-blue-50/60 border border-blue-200/80 rounded-xl">
                <div className="pr-3">
                  <p className="text-xs font-bold text-gray-900">Aktifkan Menu Ini untuk Role Siswa</p>
                  <p className="text-[11px] text-gray-500">Siswa dapat mengakses menu ini dari bilah kiri & navigasi bawah</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEnabledForStudent((prev) => !prev)}
                  className={`w-11 h-6 rounded-full transition-all relative shrink-0 cursor-pointer ${
                    enabledForStudent ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all shadow-xs ${
                      enabledForStudent ? 'left-5.5' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between p-3 bg-amber-50/70 border border-amber-200 rounded-xl">
                <div className="pr-3">
                  <p className="text-xs font-bold text-gray-900">
                    Aktifkan Pop-up Otomatis Saat Aplikasi Dibuka
                  </p>
                  <p className="text-[11px] text-gray-600">
                    Menampilkan pop-up otomatis untuk menu yang ditandai <strong>"POP-UP"</strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEnableStartupPopup((prev) => !prev)}
                  className={`w-11 h-6 rounded-full transition-all relative shrink-0 cursor-pointer ${
                    enableStartupPopup ? 'bg-amber-500' : 'bg-gray-300'
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all shadow-xs ${
                      enableStartupPopup ? 'left-5.5' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>

              {enableStartupPopup && (
                <div className="pt-1">
                  <label className="block text-[11px] font-bold text-gray-600 mb-1">
                    Frekuensi Kemunculan Pop-up pada Pengguna:
                  </label>
                  <select
                    value={popupFrequency}
                    onChange={(e) => setPopupFrequency(e.target.value as any)}
                    className="w-full p-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="every_open">Setiap Kali Aplikasi Dibuka (Selalu Tampil Saat Buka Aplikasi)</option>
                    <option value="once_per_session">Sekali Per Sesi Login (Tidak Muncul Lagi Setelah Ditutup di Sesi Ini)</option>
                    <option value="once_per_update">Hanya Saat Ada Pengumuman / Link Baru dari Admin</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowConfigPanel(false)}
              className="px-4 py-2.5 rounded-xl font-bold text-xs bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSaveMenuSettings}
              disabled={isSaving}
              className="px-5 py-2.5 rounded-xl font-bold text-xs bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-100 flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              <CheckCircle2 size={15} />
              <span>{isSaving ? 'Menyimpan...' : 'Simpan Pengaturan Menu & Pop-up'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal / Form Tambah & Edit Tombol Menu (Khusus Admin) */}
      {isAdmin && showItemForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-7 shadow-2xl border border-gray-100 my-8 space-y-5 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center">
                  {editingItemId ? <Edit size={20} /> : <Plus size={20} />}
                </div>
                <div>
                  <h3 className="font-extrabold text-gray-900 text-lg">
                    {editingItemId ? 'Edit Tombol Menu Nilai / Pengumuman' : 'Tambah Tombol Menu Nilai / Pengumuman Baru'}
                  </h3>
                  <p className="text-xs text-gray-500">
                    Bisa dikustomisasi bebas (Kelas 7, Kelas 8, Kelas 9, Untuk Guru) & diatur siapa saja yang boleh melihatnya.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowItemForm(false)}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {formError && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-2.5 text-red-700 text-xs font-bold">
                <AlertCircle size={16} className="shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveItem} className="space-y-4">
              {/* Pilihan Jenis Tampilan */}
              <div>
                <label className="block text-xs font-extrabold text-gray-700 uppercase mb-2">
                  Jenis Konten Menu Ini
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {[
                    {
                      id: 'spreadsheet',
                      label: 'Spreadsheet Nilai',
                      desc: 'Preview tabel Google Sheet',
                      icon: <FileSpreadsheet size={16} />,
                    },
                    {
                      id: 'announcement',
                      label: 'Pengumuman Saja',
                      desc: 'Papan informasi / pengumuman',
                      icon: <Megaphone size={16} />,
                    },
                    {
                      id: 'both',
                      label: 'Pengumuman + Tabel',
                      desc: 'Teks info di atas + Spreadsheet',
                      icon: <Layers size={16} />,
                    },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setItemCategory(opt.id as any);
                        if (opt.id === 'announcement' && itemBadgeText === 'DAFTAR NILAI') {
                          setItemBadgeText('PENGUMUMAN');
                        } else if (opt.id !== 'announcement' && itemBadgeText === 'PENGUMUMAN') {
                          setItemBadgeText('DAFTAR NILAI');
                        }
                      }}
                      className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
                        itemCategory === opt.id
                          ? 'bg-blue-50 border-blue-600 text-blue-900 ring-2 ring-blue-500/20'
                          : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <div
                        className={`mt-0.5 p-1.5 rounded-lg ${
                          itemCategory === opt.id ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
                        }`}
                      >
                        {opt.icon}
                      </div>
                      <div>
                        <p className="text-xs font-extrabold">{opt.label}</p>
                        <p className="text-[10px] opacity-75">{opt.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-extrabold text-gray-700 uppercase mb-1.5">
                    Nama Tombol Menu / Judul (Bisa Custom) *
                  </label>
                  <input
                    type="text"
                    value={itemTitle}
                    onChange={(e) => setItemTitle(e.target.value)}
                    placeholder="Contoh: HASIL UJIAN KELAS 7 / HASIL UJIAN KELAS 8 / UNTUK GURU"
                    className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl font-bold text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                    required
                  />
                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    <span className="text-[10px] font-bold text-gray-400 mr-1">Contoh Nama:</span>
                    {[
                      'HASIL UJIAN KELAS 7',
                      'HASIL UJIAN KELAS 8',
                      'HASIL UJIAN KELAS 9',
                      'UNTUK GURU / PENGAWAS',
                      'PENGUMUMAN UMUM',
                    ].map((sample) => (
                      <button
                        key={sample}
                        type="button"
                        onClick={() => setItemTitle(sample)}
                        className="px-2 py-0.5 rounded bg-gray-100 hover:bg-blue-50 text-gray-600 hover:text-blue-700 text-[10px] font-bold border border-gray-200 cursor-pointer"
                      >
                        {sample}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-extrabold text-gray-700 uppercase mb-1.5">
                    Label Badge
                  </label>
                  <input
                    type="text"
                    value={itemBadgeText}
                    onChange={(e) => setItemBadgeText(e.target.value)}
                    placeholder="KELAS 7 / INFO"
                    className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl font-bold text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>

              {/* Input Link Spreadsheet */}
              {(itemCategory === 'spreadsheet' || itemCategory === 'both') && (
                <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl space-y-2.5">
                  <label className="block text-xs font-extrabold text-emerald-900 uppercase">
                    Link Google Spreadsheet Daftar Nilai *
                  </label>
                  <input
                    type="url"
                    value={itemSpreadsheetUrl}
                    onChange={(e) => setItemSpreadsheetUrl(e.target.value)}
                    placeholder="Tempel link Google Spreadsheet di sini (https://docs.google.com/spreadsheets/d/...)"
                    className="w-full p-3 bg-white border border-emerald-300 rounded-xl text-sm font-mono text-gray-800 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                  {previewConvertedUrl && (
                    <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white/90 rounded-xl border border-emerald-200 text-[11px]">
                      <div className="truncate text-emerald-800">
                        <span className="font-extrabold">Mode /preview Otomatis: </span>
                        <span className="font-mono">{previewConvertedUrl}</span>
                      </div>
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-extrabold shrink-0">
                        SIAP PREVIEW
                      </span>
                    </div>
                  )}
                  <p className="text-[11px] text-emerald-800">
                    * Pastikan akses berbagi di Google Spreadsheet diatur ke <strong>"Siapa saja yang memiliki link dapat melihat"</strong>.
                  </p>
                </div>
              )}

              {/* Input Teks Pengumuman */}
              {(itemCategory === 'announcement' || itemCategory === 'both' || itemAnnouncementText) && (
                <div>
                  <label className="block text-xs font-extrabold text-gray-700 uppercase mb-1.5">
                    {itemCategory === 'announcement'
                      ? 'Isi Pengumuman *'
                      : 'Catatan / Isi Pengumuman (Ditampilkan di Atas Tabel Nilai)'}
                  </label>
                  <textarea
                    rows={3}
                    value={itemAnnouncementText}
                    onChange={(e) => setItemAnnouncementText(e.target.value)}
                    placeholder="Tulis isi pengumuman atau keterangan nilai di sini..."
                    className="w-full p-3.5 bg-gray-50 border border-gray-300 rounded-xl text-sm text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none leading-relaxed"
                  />
                </div>
              )}

              {/* KONTROL HAK AKSES: SIAPA SAJA YANG BISA MELIHAT MENU INI */}
              <div className="p-4 bg-indigo-50/50 border border-indigo-200 rounded-2xl space-y-3.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h4 className="text-xs font-extrabold text-indigo-950 uppercase tracking-wider flex items-center gap-1.5">
                      <Eye size={15} className="text-indigo-600" />
                      <span>Kontrol Siapa Saja yang Bisa Melihat Tombol Menu Ini</span>
                    </h4>
                    <p className="text-[11px] text-indigo-800/80 mt-0.5">
                      Pilih apakah tombol menu ini dilihat oleh Guru/Pengawas, Semua Siswa, atau hanya Tingkat Kelas tertentu.
                    </p>
                  </div>
                </div>

                {/* Preset Cepat Target Penonton */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold text-indigo-900 mr-1">Setelan Cepat:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setItemVisibleToSupervisor(true);
                      setItemVisibleToStudent(true);
                      setItemStudentScope('all_students');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold border cursor-pointer ${
                      itemVisibleToSupervisor && itemVisibleToStudent && itemStudentScope === 'all_students'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-indigo-50'
                    }`}
                  >
                    Semua (Guru & Semua Siswa)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setItemVisibleToSupervisor(true);
                      setItemVisibleToStudent(true);
                      setItemStudentScope('by_grade');
                      setItemAllowedGrades(['7']);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold border cursor-pointer ${
                      itemVisibleToStudent &&
                      itemStudentScope === 'by_grade' &&
                      itemAllowedGrades.length === 1 &&
                      itemAllowedGrades[0] === '7'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-indigo-50'
                    }`}
                  >
                    Guru & Siswa Kelas 7
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setItemVisibleToSupervisor(true);
                      setItemVisibleToStudent(true);
                      setItemStudentScope('by_grade');
                      setItemAllowedGrades(['8']);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold border cursor-pointer ${
                      itemVisibleToStudent &&
                      itemStudentScope === 'by_grade' &&
                      itemAllowedGrades.length === 1 &&
                      itemAllowedGrades[0] === '8'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-indigo-50'
                    }`}
                  >
                    Guru & Siswa Kelas 8
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setItemVisibleToSupervisor(true);
                      setItemVisibleToStudent(true);
                      setItemStudentScope('by_grade');
                      setItemAllowedGrades(['9']);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold border cursor-pointer ${
                      itemVisibleToStudent &&
                      itemStudentScope === 'by_grade' &&
                      itemAllowedGrades.length === 1 &&
                      itemAllowedGrades[0] === '9'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-indigo-50'
                    }`}
                  >
                    Guru & Siswa Kelas 9
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setItemVisibleToSupervisor(true);
                      setItemVisibleToStudent(false);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold border cursor-pointer ${
                      itemVisibleToSupervisor && !itemVisibleToStudent
                        ? 'bg-orange-600 text-white border-orange-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-orange-50'
                    }`}
                  >
                    Khusus Guru / Pengawas Saja
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {/* Saklar Guru / Pengawas */}
                  <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-indigo-100">
                    <div className="flex items-center gap-2.5">
                      <Users size={16} className="text-orange-600 shrink-0" />
                      <div>
                        <p className="text-xs font-extrabold text-gray-900">Tampilkan untuk Guru / Pengawas</p>
                        <p className="text-[10px] text-gray-500">
                          {itemVisibleToSupervisor ? 'Guru/Pengawas BISA melihat' : 'Disembunyikan dari Guru'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setItemVisibleToSupervisor((prev) => !prev)}
                      className={`w-11 h-6 rounded-full transition-all relative shrink-0 cursor-pointer ${
                        itemVisibleToSupervisor ? 'bg-orange-500' : 'bg-gray-300'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all shadow-xs ${
                          itemVisibleToSupervisor ? 'left-5.5' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Saklar Siswa */}
                  <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-indigo-100">
                    <div className="flex items-center gap-2.5">
                      <School size={16} className="text-blue-600 shrink-0" />
                      <div>
                        <p className="text-xs font-extrabold text-gray-900">Tampilkan untuk Siswa</p>
                        <p className="text-[10px] text-gray-500">
                          {itemVisibleToStudent ? 'Siswa BISA melihat' : 'Disembunyikan dari Siswa'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setItemVisibleToStudent((prev) => !prev)}
                      className={`w-11 h-6 rounded-full transition-all relative shrink-0 cursor-pointer ${
                        itemVisibleToStudent ? 'bg-blue-600' : 'bg-gray-300'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all shadow-xs ${
                          itemVisibleToStudent ? 'left-5.5' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Jika Siswa Diizinkan Melihat, Pilih Tingkat/Kelas */}
                {itemVisibleToStudent && (
                  <div className="p-3.5 bg-white rounded-xl border border-blue-200 space-y-3">
                    <label className="block text-xs font-extrabold text-gray-800 uppercase">
                      Siapa Saja Siswa yang Bisa Melihat Menu Ini?
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { id: 'all_students', label: 'Semua Siswa (Kls 7, 8, 9)' },
                        { id: 'by_grade', label: 'Pilih Tingkat (Kelas 7 / 8 / 9)' },
                        { id: 'by_class', label: 'Pilih Kelas Spesifik (7A-9J)' },
                      ].map((sc) => (
                        <button
                          key={sc.id}
                          type="button"
                          onClick={() => setItemStudentScope(sc.id as any)}
                          className={`p-2.5 rounded-xl border text-xs font-extrabold transition-all cursor-pointer ${
                            itemStudentScope === sc.id
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          {sc.label}
                        </button>
                      ))}
                    </div>

                    {itemStudentScope === 'by_grade' && (
                      <div className="pt-1 space-y-1.5">
                        <p className="text-[11px] font-bold text-gray-600">
                          Centang Tingkat Kelas yang Boleh Melihat:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {['7', '8', '9'].map((g) => {
                            const checked = itemAllowedGrades.includes(g);
                            return (
                              <button
                                key={g}
                                type="button"
                                onClick={() => toggleGradeInForm(g)}
                                className={`px-4 py-2 rounded-xl font-extrabold text-xs flex items-center gap-2 border cursor-pointer transition-all ${
                                  checked
                                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                                    : 'bg-gray-50 text-gray-700 border-gray-300 hover:bg-blue-50'
                                }`}
                              >
                                <div
                                  className={`w-4 h-4 rounded flex items-center justify-center border ${
                                    checked ? 'bg-white text-blue-600 border-white' : 'border-gray-400'
                                  }`}
                                >
                                  {checked && <Check size={12} />}
                                </div>
                                <span>Siswa Kelas {g}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {itemStudentScope === 'by_class' && (
                      <div className="pt-1 space-y-1.5">
                        <p className="text-[11px] font-bold text-gray-600">
                          Klik Kelas yang Boleh Melihat ({itemAllowedClasses.length} dipilih):
                        </p>
                        <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-2 bg-gray-50 rounded-xl border border-gray-200">
                          {classrooms.map((cls) => {
                            const checked = itemAllowedClasses.includes(cls.name);
                            return (
                              <button
                                key={cls.id}
                                type="button"
                                onClick={() => toggleClassInForm(cls.name)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-extrabold border cursor-pointer transition-all ${
                                  checked
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white text-gray-700 border-gray-300 hover:bg-blue-50'
                                }`}
                              >
                                {cls.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Opsi Tampilkan di Menu & Pop-up */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="flex items-center justify-between p-3.5 bg-blue-50/60 border border-blue-200 rounded-2xl">
                  <div className="pr-2">
                    <p className="text-xs font-extrabold text-gray-900">Aktifkan Tombol Menu Ini</p>
                    <p className="text-[10px] text-gray-600">Tampilkan di bar menu atas spreadsheet</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setItemIsActive((prev) => !prev)}
                    className={`w-11 h-6 rounded-full transition-all relative shrink-0 cursor-pointer ${
                      itemIsActive ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all shadow-xs ${
                        itemIsActive ? 'left-5.5' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between p-3.5 bg-amber-50/80 border border-amber-300 rounded-2xl">
                  <div className="pr-2">
                    <p className="text-xs font-extrabold text-amber-950 flex items-center gap-1">
                      <Bell size={13} className="text-amber-600" />
                      <span>Jadikan Pop-up Saat Aplikasi Dibuka</span>
                    </p>
                    <p className="text-[10px] text-amber-800">
                      Muncul otomatis sebagai pop-up bagi penerima menu ini
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setItemShowInPopup((prev) => !prev)}
                    className={`w-11 h-6 rounded-full transition-all relative shrink-0 cursor-pointer ${
                      itemShowInPopup ? 'bg-amber-500' : 'bg-gray-300'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all shadow-xs ${
                        itemShowInPopup ? 'left-5.5' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowItemForm(false)}
                  className="px-5 py-2.5 rounded-xl font-bold text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-6 py-2.5 rounded-xl font-bold text-xs bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-100 flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  <CheckCircle2 size={16} />
                  <span>{isSaving ? 'Menyimpan...' : editingItemId ? 'Simpan Perubahan Menu' : 'Simpan & Buat Tombol Menu'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Konfirmasi Hapus Item */}
      {isAdmin && deleteConfirmId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <Trash2 size={24} />
            </div>
            <h3 className="font-extrabold text-gray-900 text-lg">Hapus Tombol Menu Ini?</h3>
            <p className="text-xs text-gray-500">
              Tombol menu spreadsheet / pengumuman ini akan dihapus dari halaman dan pop-up.
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2.5 rounded-xl font-bold text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => handleDeleteItem(deleteConfirmId)}
                className="px-5 py-2.5 rounded-xl font-bold text-xs bg-red-600 hover:bg-red-700 text-white cursor-pointer"
              >
                Ya, Hapus Sekarang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Jika belum ada item sama sekali */}
      {visibleItems.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-gray-300 p-10 sm:p-14 text-center space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
            <FileSpreadsheet size={32} />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="text-lg font-extrabold text-gray-900">
              Belum Ada Menu Daftar Nilai / Pengumuman yang Ditampilkan
            </h3>
            <p className="text-xs sm:text-sm text-gray-500 leading-relaxed">
              {isAdmin
                ? 'Gunakan tombol "Tambah Cepat" di atas (Hasil Kelas 7, Hasil Kelas 8, Hasil Kelas 9, Untuk Guru) atau klik "+ Tambah Menu Nilai / Pengumuman" untuk membuat beberapa tombol menu sesuai tingkat.'
                : 'Saat ini belum ada daftar nilai ujian atau pengumuman untuk kelas/role Anda.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Konten Item Aktif */}
          {activeItem && (
            <div
              className={`${
                isFullscreenPreview
                  ? 'fixed inset-0 z-50 bg-white flex flex-col p-3 sm:p-5 overflow-y-auto'
                  : 'bg-white rounded-3xl border border-gray-200 shadow-xs overflow-hidden'
              }`}
            >
              {/* Bar Informasi & Kontrol Cepat Admin pada Menu yang Sedang Dipilih */}
              <div className="p-4 sm:p-5 border-b border-gray-100 bg-gray-50/70 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {activeItem.badgeText && (
                        <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold uppercase bg-blue-100 text-blue-800">
                          {activeItem.badgeText}
                        </span>
                      )}
                      <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold bg-indigo-50 text-indigo-800 border border-indigo-200">
                        👁️ Dilihat Oleh: {getVisibilitySummaryText(activeItem)}
                      </span>
                    </div>
                    <h3 className="text-base sm:text-lg font-extrabold text-gray-900">{activeItem.title}</h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {activeItem.embedUrl && (
                      <>
                        <button
                          type="button"
                          onClick={() => setIframeRefreshKey((k) => k + 1)}
                          className="px-3 py-2 rounded-xl font-bold text-xs bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 flex items-center gap-1.5 cursor-pointer"
                          title="Muat ulang tabel nilai"
                        >
                          <RefreshCw size={14} />
                          <span>Segarkan</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsFullscreenPreview((prev) => !prev)}
                          className="px-3 py-2 rounded-xl font-bold text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center gap-1.5 cursor-pointer"
                        >
                          {isFullscreenPreview ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                          <span>{isFullscreenPreview ? 'Keluar Layar Penuh' : 'Layar Penuh'}</span>
                        </button>
                        <a
                          href={activeItem.embedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-2 rounded-xl font-bold text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1.5 cursor-pointer"
                          title="Buka preview di tab baru"
                        >
                          <ExternalLink size={14} />
                          <span className="hidden sm:inline">Buka Tab Baru</span>
                        </a>
                      </>
                    )}

                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleMoveItemOrder(activeItem.id, 'left')}
                          className="p-2 rounded-xl bg-white hover:bg-gray-100 text-gray-600 border border-gray-200 cursor-pointer"
                          title="Geser posisi tombol ke kiri"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveItemOrder(activeItem.id, 'right')}
                          className="p-2 rounded-xl bg-white hover:bg-gray-100 text-gray-600 border border-gray-200 cursor-pointer"
                          title="Geser posisi tombol ke kanan"
                        >
                          <ChevronRight size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEditForm(activeItem)}
                          className="px-3 py-2 rounded-xl font-bold text-xs bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Edit size={14} />
                          <span>Edit Menu / Link</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(activeItem.id)}
                          className="p-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 cursor-pointer"
                          title="Hapus tombol menu ini"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Bar Kontrol Cepat Admin: Atur Siapa Saja yang Bisa Melihat Menu Ini (1-Klik) */}
                {isAdmin && (
                  <div className="pt-2.5 border-t border-gray-200/80 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-extrabold uppercase text-gray-500 mr-1">
                        Kontrol Cepat Tampilkan Untuk:
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleQuickUpdateAudience(
                            activeItem,
                            {
                              visibleToSupervisor: true,
                              visibleToStudent: true,
                              studentScope: 'all_students',
                            },
                            'Semua (Guru & Semua Siswa)'
                          )
                        }
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold border cursor-pointer transition-all ${
                          activeItem.visibleToSupervisor !== false &&
                          activeItem.visibleToStudent !== false &&
                          (activeItem.studentScope === 'all_students' || !activeItem.studentScope)
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        Semua (Guru & Siswa)
                      </button>

                      {['7', '8', '9'].map((g) => {
                        const isThisGradeOnly =
                          activeItem.visibleToStudent !== false &&
                          activeItem.studentScope === 'by_grade' &&
                          (activeItem.allowedGrades || []).length === 1 &&
                          (activeItem.allowedGrades || [])[0] === g;
                        return (
                          <button
                            key={g}
                            type="button"
                            onClick={() =>
                              handleQuickUpdateAudience(
                                activeItem,
                                {
                                  visibleToSupervisor: true,
                                  visibleToStudent: true,
                                  studentScope: 'by_grade',
                                  allowedGrades: [g],
                                  targetClass: `GRADE_${g}`,
                                },
                                `Guru & Siswa Kelas ${g}`
                              )
                            }
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold border cursor-pointer transition-all ${
                              isThisGradeOnly
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-gray-600 border-gray-200 hover:bg-blue-50'
                            }`}
                          >
                            Siswa Kls {g} + Guru
                          </button>
                        );
                      })}

                      <button
                        type="button"
                        onClick={() =>
                          handleQuickUpdateAudience(
                            activeItem,
                            {
                              visibleToSupervisor: true,
                              visibleToStudent: false,
                              targetRole: 'pengawas',
                            },
                            'Khusus Guru / Pengawas Saja'
                          )
                        }
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold border cursor-pointer transition-all ${
                          activeItem.visibleToSupervisor !== false && activeItem.visibleToStudent === false
                            ? 'bg-orange-600 text-white border-orange-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-orange-50'
                        }`}
                      >
                        Khusus Guru Saja
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleToggleItemPopup(activeItem)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase flex items-center gap-1 border cursor-pointer transition-all ${
                          activeItem.showInPopup
                            ? 'bg-amber-100 text-amber-900 border-amber-300'
                            : 'bg-white text-gray-500 border-gray-200 hover:bg-amber-50'
                        }`}
                      >
                        <Bell size={11} />
                        <span>{activeItem.showInPopup ? 'Pop-up: ON' : 'Pop-up: OFF'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleItemActive(activeItem)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase flex items-center gap-1 border cursor-pointer transition-all ${
                          activeItem.isActive
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                            : 'bg-gray-200 text-gray-600 border-gray-300'
                        }`}
                      >
                        {activeItem.isActive ? <Eye size={11} /> : <EyeOff size={11} />}
                        <span>{activeItem.isActive ? 'Menu Aktif' : 'Disembunyikan'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Kotak Pengumuman (Jika ada teks pengumuman) */}
              {activeItem.announcementText && (
                <div className="p-5 sm:p-6 bg-gradient-to-r from-amber-50/80 via-yellow-50/50 to-orange-50/40 border-b border-amber-200/70">
                  <div className="flex items-start gap-3.5">
                    <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                      <Megaphone size={20} />
                    </div>
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <p className="text-xs font-extrabold uppercase tracking-wider text-amber-900">
                        Informasi / Pengumuman Resmi
                      </p>
                      <div className="text-sm text-gray-800 whitespace-pre-line leading-relaxed font-medium">
                        {activeItem.announcementText}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Preview Tabel Spreadsheet (/preview) */}
              {activeItem.embedUrl && (
                <div className={isFullscreenPreview ? 'flex-1 min-h-[75vh]' : 'w-full'}>
                  <iframe
                    key={`${activeItem.id}_${iframeRefreshKey}`}
                    src={activeItem.embedUrl}
                    title={activeItem.title}
                    className={`w-full border-0 bg-white ${
                      isFullscreenPreview ? 'h-[calc(100vh-140px)]' : 'h-[72vh] min-h-[520px]'
                    }`}
                    sandbox="allow-scripts allow-same-origin allow-forms"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface StartupAnnouncementPopupModalProps {
  isOpen: boolean;
  config: CustomPortalConfig;
  items: CustomPortalItem[];
  onClose: () => void;
  onOpenFullMenu: (itemId: string) => void;
}

export const StartupAnnouncementPopupModal: React.FC<StartupAnnouncementPopupModalProps> = ({
  isOpen,
  config,
  items,
  onClose,
  onOpenFullMenu,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(0);
    }
  }, [isOpen]);

  if (!isOpen || items.length === 0) return null;

  const currentItem = items[Math.min(currentIndex, items.length - 1)] || items[0];

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-xs z-[70] flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header Pop-up */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-xs flex items-center justify-center shrink-0">
              {currentItem.category === 'announcement' ? (
                <Megaphone size={22} />
              ) : (
                <FileSpreadsheet size={22} />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-amber-400 text-amber-950">
                  {currentItem.badgeText || 'PENGUMUMAN & NILAI'}
                </span>
                {items.length > 1 && (
                  <span className="text-xs font-bold text-blue-100">
                    ({currentIndex + 1} dari {items.length})
                  </span>
                )}
              </div>
              <h3 className="text-base sm:text-lg font-extrabold truncate mt-0.5">
                {currentItem.title}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors shrink-0 cursor-pointer"
            title="Tutup Pop-up"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Pemilih jika ada beberapa item pop-up */}
        {items.length > 1 && (
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2 overflow-x-auto shrink-0">
            {items.map((it, idx) => (
              <button
                key={it.id}
                type="button"
                onClick={() => setCurrentIndex(idx)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-all cursor-pointer ${
                  idx === currentIndex
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
                }`}
              >
                {it.title}
              </button>
            ))}
          </div>
        )}

        {/* Isi Konten Pop-up */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
          {currentItem.announcementText && (
            <div className="p-5 sm:p-6 bg-amber-50/60">
              <div className="flex items-start gap-3">
                <Megaphone className="text-amber-600 shrink-0 mt-0.5" size={20} />
                <div className="text-sm text-gray-800 whitespace-pre-line leading-relaxed font-medium">
                  {currentItem.announcementText}
                </div>
              </div>
            </div>
          )}

          {currentItem.embedUrl && (
            <div className="w-full bg-white">
              <iframe
                src={currentItem.embedUrl}
                title={currentItem.title}
                className="w-full h-[55vh] min-h-[360px] border-0"
                sandbox="allow-scripts allow-same-origin allow-forms"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
          )}
        </div>

        {/* Footer Pop-up */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <p className="text-xs text-gray-500">
            Anda juga dapat membuka informasi ini kapan saja melalui menu <strong>"{config.menuTitle}"</strong> di bilah kiri.
          </p>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={() => onOpenFullMenu(currentItem.id)}
              className="px-4 py-2.5 rounded-xl font-bold text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 flex items-center gap-1.5 cursor-pointer"
            >
              <Maximize2 size={14} />
              <span>Buka di Menu {config.menuTitle}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl font-bold text-xs bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-100 flex items-center gap-1.5 cursor-pointer"
            >
              <Check size={15} />
              <span>Mengerti / Tutup</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
