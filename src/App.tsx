import { ensureStudentCodes, configurationIsFrozen, answeredQuestions, studentCodeSheet } from "./questionnaireControls";
import { resetStudent } from "./studentAccess";
import { startHosting, stopHosting, sendToAdmin } from "./liveSession";
import { generateSessionCode, normalizeSessionCode, SESSION_CODE_PATTERN } from "./sessionCode.js";
import React, { useState, useEffect, useRef } from "react";
import {
  Lock,
  Unlock,
  LogOut,
  Users,
  FileSpreadsheet,
  Plus,
  Trash2,
  Edit3,
  Play,
  StopCircle,
  RefreshCw,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Eye,
  EyeOff,
  Save,
  Download,
  Upload,
  Info,
  HelpCircle,
  ArrowLeft,
  GraduationCap,
  ArrowRight,
  ShieldCheck,
  HeartPulse,
  Award,
  Key,
  Copy,
  Check
} from "lucide-react";

import {
  CESCProject,
  CESCQuestion,
  DEFAULT_QUESTIONS,
  StudentResponse,
  ActiveSession
} from "./types.js";

import { SearchableSelect } from "./components/SearchableSelect.js";
import { SociogramView } from "./components/SociogramView.js";

// Pages has no API: use local persistence without repeated failing requests.
const STATIC_MODE = import.meta.env.VITE_STATIC_MODE === "true" || location.hostname.endsWith(".github.io");
const apiFetch: typeof fetch = (input, init) => STATIC_MODE
  ? (() => {
      const path = String(input);
      if (path.startsWith("/api/student/session/")) {
        return sendToAdmin(path.split("/").pop()!, { type: "join" }).then(data => Response.json(data));
      }
      if ((path === "/api/student/sync" || path === "/api/student/claim" || path === "/api/student/heartbeat")) {
        const body = JSON.parse(String(init?.body || "{}"));
        return sendToAdmin(body.code, { ...body, type: path.endsWith("claim") ? "claim" : path.endsWith("heartbeat") ? "heartbeat" : "sync" }).then(data => Response.json(data));
      }
      return Promise.reject(new Error("API locale"));
    })()
  : fetch(input, init);

const DEFAULT_LOCAL_PASSWORD = "InsM0ll3t";

const INITIAL_SAMPLE_PROJECT: CESCProject = {
  id: "template-1eso-a",
  title: "1r ESO - Grup A (Exemple)",
  createdAt: new Date().toISOString(),
  students: [
    "Laia Alarcon", "Marc Baldó", "Jordi Casas", "Mireia Domènech", "Pol Escudé",
    "Sílvia Farré", "Joan Garcia", "Laia Torrent", "Roger Rovira", "Sílvia Marín",
    "Anna Mas", "Adrià Ortiz", "Berta Soler", "Pau Vergés", "Zoe Castells",
    "Nil Vidal", "Marta Puig", "Jan Saura", "Gisela Vila", "Hugo Martí"
  ],
  questions: [...DEFAULT_QUESTIONS],
  allowSelfIdentification: true,
  responses: {}
};

function getLocalProjects(): CESCProject[] {
  try {
    const raw = localStorage.getItem("cesc_projects_local");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn("Could not read local projects", e);
  }
  return [INITIAL_SAMPLE_PROJECT];
}

function saveLocalProjects(projects: CESCProject[]) {
  try {
    localStorage.setItem("cesc_projects_local", JSON.stringify(projects));
  } catch (e) {
    console.warn("Could not save local projects", e);
  }
}

function getLocalAdminPassword(): string {
  try {
    return localStorage.getItem("cesc_admin_password") || DEFAULT_LOCAL_PASSWORD;
  } catch {
    return DEFAULT_LOCAL_PASSWORD;
  }
}

function saveLocalAdminPassword(pw: string) {
  try {
    localStorage.setItem("cesc_admin_password", pw);
  } catch (e) {
    console.warn("Could not save admin password", e);
  }
}

function getLocalActiveSession(): ActiveSession | null {
  try {
    const raw = localStorage.getItem("cesc_active_session_local");
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveLocalActiveSession(session: ActiveSession | null) {
  try {
    if (session) {
      localStorage.setItem("cesc_active_session_local", JSON.stringify(session));
    } else {
      localStorage.removeItem("cesc_active_session_local");
    }
  } catch {}
}

export default function App() {
  // --- STATE ROUTER ---
  // "role-select": Initial landing screen
  // "student-portal": Student questionnaire workflow
  // "admin-login": Password check for management
  // "admin-portal": Full control center for staff
  const [currentView, setCurrentView] = useState<"role-select" | "student-portal" | "admin-login" | "admin-portal">("role-select");

  // --- ADMIN AUTH STATE ---
  const [password, setPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [authError, setAuthError] = useState("");

  // --- PASSWORD CONSULT & MODIFY MODAL STATES ---
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [currentPasswordDisplay, setCurrentPasswordDisplay] = useState("");
  const [isPasswordRevealedInModal, setIsPasswordRevealedInModal] = useState(false);
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [confirmPasswordInput, setConfirmPasswordInput] = useState("");
  const [isNewPasswordRevealed, setIsNewPasswordRevealed] = useState(false);
  const [passwordUpdateMessage, setPasswordUpdateMessage] = useState("");
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [copiedPasswordToast, setCopiedPasswordToast] = useState(false);

  // GitHub Pages / Offline mode indicator & guide modal
  const [isLocalMode, setIsLocalMode] = useState(STATIC_MODE);

  // --- ADMIN LOGIC STATES ---
  const [projects, setProjects] = useState<CESCProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [newProjectAccessMode, setNewProjectAccessMode] = useState<"shared" | "individual">("shared");
  const [newProjectPrefix, setNewProjectPrefix] = useState("CE");
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [editingStudent, setEditingStudent] = useState<{ index: number; name: string } | null>(null);

  // Active Live session properties on the server
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [refreshProgressSeconds, setRefreshProgressSeconds] = useState(0);

  // Question editing sub-states
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null);
  const [editingQuestionText, setEditingQuestionText] = useState("");
  const [editingQuestionDesc, setEditingQuestionDesc] = useState("");

  // Create custom question state
  const [newQuestionText, setNewQuestionText] = useState("");
  const [newQuestionDesc, setNewQuestionDesc] = useState("");

  // --- STUDENT WORKFLOW STATES ---
  const [adminSessionCode, setAdminSessionCode] = useState("");
  const [isOpeningSession, setIsOpeningSession] = useState(false);
  const [liveStatus, setLiveStatus] = useState("Sessió tancada");
  const pendingResponseRef = useRef<any>(null);
  const sendingResponseRef = useRef(false);
  const [sessionCodeError, setSessionCodeError] = useState("");
  const [studentCodeInput, setStudentCodeInput] = useState("");
  const [studentCodeError, setStudentCodeError] = useState("");
  const [studentSessionId, setStudentSessionId] = useState("");
  const [joinedSessionData, setJoinedSessionData] = useState<{
    code: string;
    sessionId?: string;
    title: string;
    students: string[];
    questions: CESCQuestion[];
    allowSelfIdentification: boolean;
    accessMode?: "shared" | "individual";
  } | null>(null);

  const [studentStep, setStudentStep] = useState<"join" | "welcome" | "selfify" | "questions" | "review" | "completed">("join");
  const [selectedSelfName, setSelectedSelfName] = useState("");
  const [studentActiveQuestionIdx, setStudentActiveQuestionIdx] = useState(0);

  // Student answers state: { [questionId]: [name1, name2, name3] }
  const [studentAnswers, setStudentAnswers] = useState<{ [questionId: number]: string[] }>({});
  const studentAccessRef = useRef<{token: string; deviceId: string} | null>(null);
  const [individualCodeInput, setIndividualCodeInput] = useState("");
  const [presenceClock, setPresenceClock] = useState(Date.now());
  const [claimingStudent, setClaimingStudent] = useState(false);
  const [studentAccessError, setStudentAccessError] = useState("");
  const [studentSyncStatus, setStudentSyncStatus] = useState<"synced" | "syncing" | "error">("synced");

  // --- PRIVACY DELEGATE: TIMER STATE ---
  const [isAnswersRevealed, setIsAnswersRevealed] = useState(false);
  const [revealCountdown, setRevealCountdown] = useState(0);

  // Ref for local polling/timers
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize and check persistent states
  useEffect(() => {
    // Check if admin is already saved
    const savedToken = localStorage.getItem("cesc_admin_token");
    if (savedToken === "session-verified-token-insmollet") {
      setIsAdminAuthenticated(true);
    }

    // Generate/retrieve unique student session id for persistent tracking
    let cachedSessionId = sessionStorage.getItem("cesc_student_session_id");
    if (!cachedSessionId) {
      cachedSessionId = "stud_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now().toString(36);
      sessionStorage.setItem("cesc_student_session_id", cachedSessionId);
    }
    setStudentSessionId(cachedSessionId);
    try {
      const pending = JSON.parse(sessionStorage.getItem("cesc_pending_response") || "null");
      if (pending) { pendingResponseRef.current = pending; setStudentSyncStatus("error"); }
    } catch {}
  }, []);

  // Fetch administrator data if authenticated
  useEffect(() => {
    if (isAdminAuthenticated) {
      fetchAdminData();
      // Poll active session responses every 5 seconds to show real-time stats
      pollIntervalRef.current = setInterval(() => {
        fetchActiveSessionStatusSilently();
      }, 5000);
    } else {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    }
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [isAdminAuthenticated]);

  useEffect(() => {
    if (!STATIC_MODE || !isAdminAuthenticated || currentView !== "admin-portal") return;
    const status = (event: Event) => setLiveStatus((event as CustomEvent).detail);
    const refresh = () => {
      setProjects(getLocalProjects());
      setActiveSession(getLocalActiveSession());
    };
    window.addEventListener("cesc-live-status", status);
    window.addEventListener("cesc-live-response", refresh);
    const saved = getLocalActiveSession();
    const recover = () => {
      const session = getLocalActiveSession();
      if (session) startHosting(session.code).catch(error => setLiveStatus(error.message));
    };
    if (saved) recover();
    const recoveryTimer = setInterval(recover, 5000);
    return () => {
      clearInterval(recoveryTimer);
      window.removeEventListener("cesc-live-status", status);
      window.removeEventListener("cesc-live-response", refresh);
      stopHosting();
    };
  }, [isAdminAuthenticated, currentView]);

  useEffect(() => {
    const retry = setInterval(() => { if (pendingResponseRef.current) void flushPendingResponse(); }, 5000);
    return () => clearInterval(retry);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setPresenceClock(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (currentView !== "student-portal" || !joinedSessionData || !studentAccessRef.current || !["questions", "review", "completed"].includes(studentStep)) return;
    let busy = false;
    const heartbeat = async () => {
      if (busy) return; busy = true;
      try { await apiFetch("/api/student/heartbeat", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ code:joinedSessionData.code, sessionId:joinedSessionData.sessionId,
          studentName:selectedSelfName, studentSessionId, ...studentAccessRef.current })
      }); } catch {} finally { busy = false; }
    };
    const timer = setInterval(() => void heartbeat(), 15000);
    return () => clearInterval(timer);
  }, [currentView, studentStep, joinedSessionData, selectedSelfName, studentSessionId]);

  // Privacy 10-second mask countdown effect
  useEffect(() => {
    if (revealCountdown <= 0) {
      setIsAnswersRevealed(false);
      return;
    }
    const timer = setTimeout(() => {
      setRevealCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [revealCountdown]);

  // Active Project helper
  const activeProject = projects.find((p) => p.id === selectedProjectId);

  const getAuthToken = () => {
    return localStorage.getItem("cesc_admin_token") || "session-verified-token-insmollet";
  };

  // --- RECALL API FETCHES (DUAL-MODE: SERVER + GITHUB PAGES / OFFLINE) ---
  const fetchAdminData = async () => {
    let serverOk = false;
    try {
      const pResp = await apiFetch("/api/admin/projects", {
        headers: { "Authorization": getAuthToken() }
      });
      if (pResp.ok) {
        const pData = await pResp.json();
        if (Array.isArray(pData) && pData.length > 0) {
          setProjects(pData);
          saveLocalProjects(pData);
          if (!selectedProjectId) {
            setSelectedProjectId(pData[0].id);
          }
          serverOk = true;
          setIsLocalMode(false);
        }
      }
    } catch (err) {
      // Server is unavailable (e.g. static GitHub Pages)
    }

    try {
      const sResp = await apiFetch("/api/admin/active-session", {
        headers: { "Authorization": getAuthToken() }
      });
      if (sResp.ok) {
        const sData = await sResp.json();
        setActiveSession(sData);
        saveLocalActiveSession(sData);
      }
    } catch (err) {
      // Background poll fail
    }

    // Fallback if running statically on GitHub Pages or server unreachable
    if (!serverOk) {
      setIsLocalMode(true);
      const localProjs = getLocalProjects();
      setProjects(localProjs);
      if (localProjs.length > 0 && !selectedProjectId) {
        setSelectedProjectId(localProjs[0].id);
      }
      const localSess = getLocalActiveSession();
      if (localSess) {
        setActiveSession(localSess);
      }
    }
  };

  const fetchActiveSessionStatusSilently = async () => {
    try {
      const sResp = await apiFetch("/api/admin/active-session", {
        headers: { "Authorization": getAuthToken() }
      });
      if (sResp.ok) {
        const sData = await sResp.json();
        setActiveSession(sData);
        saveLocalActiveSession(sData);

        if (sData && sData.project) {
          setProjects((prev) =>
            prev.map((proj) => (proj.id === sData.project.id ? sData.project : proj))
          );
        }
        return;
      }
    } catch (err) {
      // Fail silently
    }

    // In local / GitHub Pages mode, poll from localStorage
    const localSess = getLocalActiveSession();
    setActiveSession(localSess);
    if (localSess) {
      if (localSess.project) {
        setProjects((prev) =>
          prev.map((proj) => (proj.id === localSess.project.id ? localSess.project : proj))
        );
      }
    }
  };

  const fetchAdminPassword = async () => {
    try {
      const resp = await apiFetch("/api/admin/password", {
        headers: { "Authorization": getAuthToken() }
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.password) {
          setCurrentPasswordDisplay(data.password);
          saveLocalAdminPassword(data.password);
          return;
        }
      }
    } catch (err) {
      // GitHub Pages / static
    }
    setCurrentPasswordDisplay(getLocalAdminPassword());
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordUpdateMessage("");
    const trimmed = newPasswordInput.trim();
    if (!trimmed) {
      setPasswordUpdateMessage("La nova contrasenya no pot estar buida.");
      return;
    }
    if (trimmed.length < 3) {
      setPasswordUpdateMessage("La nova contrasenya ha de tenir com a mínim 3 caràcters.");
      return;
    }
    if (newPasswordInput !== confirmPasswordInput) {
      setPasswordUpdateMessage("Les dues contrasenyes no coincideixen.");
      return;
    }

    setIsUpdatingPassword(true);
    // Always persist to localStorage for instant GitHub Pages functionality
    saveLocalAdminPassword(trimmed);
    setCurrentPasswordDisplay(trimmed);

    try {
      const resp = await apiFetch("/api/admin/password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": getAuthToken()
        },
        body: JSON.stringify({ newPassword: trimmed })
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.password) {
          setCurrentPasswordDisplay(data.password);
        }
      }
    } catch (err) {
      // Static fallback already preserved!
    } finally {
      setIsUpdatingPassword(false);
      setPasswordUpdateMessage("✓ Contrasenya actualitzada correctament!");
      setNewPasswordInput("");
      setConfirmPasswordInput("");
    }
  };

  const handleCopyPassword = () => {
    if (currentPasswordDisplay) {
      navigator.clipboard.writeText(currentPasswordDisplay);
      setCopiedPasswordToast(true);
      setTimeout(() => setCopiedPasswordToast(false), 2000);
    }
  };

  // --- ADMIN ACTIONS ---
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    const entered = password.trim();

    try {
      const resp = await apiFetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: entered })
      });

      if (resp.ok) {
        const data = await resp.json();
        localStorage.setItem("cesc_admin_token", data.token);
        setIsAdminAuthenticated(true);
        setCurrentView("admin-portal");
        setPassword("");
        setIsLocalMode(false);
        return;
      } else if (resp.status === 401) {
        const errData = await resp.json().catch(() => ({}));
        setAuthError(errData.error || "Contrasenya d'administrador incorrecta.");
        return;
      }
    } catch (err) {
      // Server unreachable (GitHub Pages) -> check local password
    }

    // Static GitHub Pages fallback check:
    const validLocalPassword = getLocalAdminPassword();
    if (entered === validLocalPassword) {
      localStorage.setItem("cesc_admin_token", "session-verified-token-insmollet");
      setIsAdminAuthenticated(true);
      setIsLocalMode(true);
      setCurrentView("admin-portal");
      setPassword("");
    } else {
      setAuthError("Contrasenya d'administrador incorrecta.");
    }
  };

  const handleAdminLogout = () => {
    localStorage.removeItem("cesc_admin_token");
    setIsAdminAuthenticated(false);
    setCurrentView("role-select");
  };

  const handleCreateNewProject = async () => {
    if (!newProjectTitle.trim()) return;
    if (newProjectAccessMode === "individual" && !/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{2}$/.test(newProjectPrefix.toUpperCase())) {alert("Prefix no vàlid: 2 caràcters, sense 0, O, 1, I ni L.");return;}

    const newId = "proj-" + Math.random().toString(36).substr(2, 9);
    const newProj: CESCProject = {
      id: newId,
      title: newProjectTitle.trim(),
      accessMode: newProjectAccessMode,
      codePrefix: newProjectPrefix.trim().toUpperCase(),
      createdAt: new Date().toISOString(),
      students: ["Exemple Alumne 1", "Exemple Alumne 2"],
      questions: [...DEFAULT_QUESTIONS],
      allowSelfIdentification: true,
      responses: {}
    };

    // Update state & local storage immediately
    const existing = getLocalProjects();
    const updatedList = [...existing, newProj];
    saveLocalProjects(updatedList);
    setProjects(updatedList);
    setSelectedProjectId(newProj.id);
    setNewProjectTitle("");

    try {
      await apiFetch("/api/admin/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": getAuthToken()
        },
        body: JSON.stringify(newProj)
      });
    } catch (err) {
      // Local copy saved
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (getLocalActiveSession()?.project.id === id) { alert("Tanca la sessió abans d’eliminar aquest qüestionari."); return; }
    if (!confirm("Esteu segur que voleu eliminar aquest qüestionari i totes les seves respostes?")) return;

    // Filter locally
    const existing = getLocalProjects();
    const filtered = existing.filter((p) => p.id !== id);
    saveLocalProjects(filtered);
    setProjects(filtered);
    const session = getLocalActiveSession();
    if (session?.project.id === id) {
      stopHosting();
      saveLocalActiveSession(null);
      setActiveSession(null);
    }
    if (selectedProjectId === id) {
      setSelectedProjectId(filtered[0]?.id || "");
    }

    try {
      await apiFetch(`/api/admin/projects/${id}`, {
        method: "DELETE",
        headers: { "Authorization": getAuthToken() }
      });
    } catch (err) {
      // Filtered locally
    }
  };

  const handleSaveProjectDetails = async (updated: CESCProject) => {
    const frozen = getLocalActiveSession();
    if (frozen?.project.id === updated.id && configurationIsFrozen(frozen.project, updated)) {
      alert("El qüestionari està obert. Tanca la sessió abans de modificar alumnes, preguntes o codis."); return;
    }
    // 1. Save directly to local storage
    const existing = getLocalProjects();
    const updatedList = existing.map((p) => (p.id === updated.id ? updated : p));
    if (!existing.some((p) => p.id === updated.id)) {
      updatedList.push(updated);
    }
    saveLocalProjects(updatedList);
    setProjects(updatedList);

    // If active session references this project, keep in sync
    const localSess = getLocalActiveSession();
    if (localSess && localSess.project.id === updated.id) {
      localSess.project = updated;
      saveLocalActiveSession(localSess);
      setActiveSession({ ...localSess });
    }

    try {
      await apiFetch("/api/admin/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": getAuthToken()
        },
        body: JSON.stringify(updated)
      });
    } catch (err) {
      // Local copy saved
    }
  };

  // --- BULK ACTION FOR SHEET TO EXCEL COLUMN LOADING ---
  const handleBulkLoadAlumnes = () => {
    if (!activeProject || !bulkInput.trim()) return;

    // Split by newlines, trim, and filter blank entries
    const parsedNames = bulkInput
      .split("\n")
      .map((n) => n.trim())
      .filter((n) => n.length > 0);

    if (parsedNames.length === 0) return;

    const updated = {
      ...activeProject,
      students: [...activeProject.students, ...parsedNames]
    };

    handleSaveProjectDetails(updated);
    setBulkInput("");
  };

  const handleAddSingleStudent = (name: string) => {
    if (!activeProject || !name.trim()) return;
    const updated = {
      ...activeProject,
      students: [...activeProject.students, name.trim()]
    };
    handleSaveProjectDetails(updated);
  };

  const handleRemoveStudent = (studentName: string) => {
    if (!activeProject) return;
    const updated = {
      ...activeProject,
      students: activeProject.students.filter((s) => s !== studentName)
    };
    handleSaveProjectDetails(updated);
  };

  const handleUpdateStudentName = () => {
    if (!activeProject || !editingStudent) return;
    const updatedStudents = [...activeProject.students];
    updatedStudents[editingStudent.index] = editingStudent.name.trim();

    const updated = {
      ...activeProject,
      students: updatedStudents
    };
    handleSaveProjectDetails(updated);
    setEditingStudent(null);
  };

  // --- QUESTION PARAMETERS CONTROL ---
  const handleUpdateQuestion = () => {
    if (!activeProject || editingQuestionId === null) return;

    const updatedQs = activeProject.questions.map((q) => {
      if (q.id === editingQuestionId) {
        return { ...q, text: editingQuestionText, description: editingQuestionDesc };
      }
      return q;
    });

    const updated = {
      ...activeProject,
      questions: updatedQs
    };

    handleSaveProjectDetails(updated);
    setEditingQuestionId(null);
  };

  const handleAddQuestion = () => {
    if (!activeProject || !newQuestionText.trim()) return;

    // Calculate dynamic next ID
    const nextId = activeProject.questions.length > 0 
      ? Math.max(...activeProject.questions.map((q) => q.id)) + 1 
      : 1;

    const newQ: CESCQuestion = {
      id: nextId,
      text: newQuestionText.trim(),
      description: newQuestionDesc.trim() || `Instruccions detallades per a la pregunta ${nextId}.`
    };

    const updated = {
      ...activeProject,
      questions: [...activeProject.questions, newQ]
    };

    handleSaveProjectDetails(updated);
    setNewQuestionText("");
    setNewQuestionDesc("");
  };

  const handleDeleteQuestion = (qId: number) => {
    if (!activeProject) return;
    if (!confirm("Segur que voleu eliminar aquesta pregunta?")) return;

    const updated = {
      ...activeProject,
      questions: activeProject.questions.filter((q) => q.id !== qId)
    };
    handleSaveProjectDetails(updated);
  };

  const handleToggleSelfIdentificationSetting = () => {
    if (!activeProject) return;
    const updated = {
      ...activeProject,
      allowSelfIdentification: !activeProject.allowSelfIdentification
    };
    handleSaveProjectDetails(updated);
  };

  // --- RESPONSES SESSION SPREADER (DUAL-MODE) ---
  const handleOpenSessionToAnswers = async (projectId: string) => {
    const original = projects.find((p) => p.id === projectId) || getLocalProjects().find((p) => p.id === projectId);
    if (!original) return;
    let proj: CESCProject;
    try { proj = ensureStudentCodes(original); } catch (error) { setSessionCodeError((error as Error).message); return; }
    await handleSaveProjectDetails(proj);

    // Generate session code
    const baseCode = normalizeSessionCode(adminSessionCode) || generateSessionCode();
    if (!SESSION_CODE_PATTERN.test(baseCode)) {
      setSessionCodeError("El codi ha de tenir exactament 6 lletres o números.");
      return;
    }
    setSessionCodeError("");
    setAdminSessionCode(baseCode);
    const newSession: ActiveSession = {
      code: baseCode,
      project: proj
    };

    if (isOpeningSession) return;
    setIsOpeningSession(true);
    try {
      if (STATIC_MODE) await startHosting(baseCode);
      newSession.sessionId = crypto.randomUUID();
      saveLocalActiveSession(newSession);
      setActiveSession(newSession);
    } catch (error) {
      stopHosting();
      setSessionCodeError(error instanceof Error ? error.message : "No s’ha pogut obrir la sessió.");
      setIsOpeningSession(false);
      return;
    }
    setIsOpeningSession(false);

    try {
      const resp = await apiFetch("/api/admin/open-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": getAuthToken()
        },
        body: JSON.stringify({ projectId, code: baseCode })
      });

      if (resp.ok) {
        const data = await resp.json();
        setActiveSession(data);
        saveLocalActiveSession(data);
      }
    } catch (err) {
      // Local session opened
    }
  };

  const handleCloseSessionOfAnswers = async () => {
    stopHosting();
    saveLocalActiveSession(null);
    setActiveSession(null);

    try {
      await apiFetch("/api/admin/close-session", {
        method: "POST",
        headers: {
          "Authorization": getAuthToken()
        }
      });
    } catch (err) {
      // Closed locally
    }
  };

  const handleResetSessionResponses = async (projectId: string) => {
    if (!confirm("ATENCIÓ: Es desintegraran i s'esborraran totes les respostes rebudes fins ara. Voleu continuar?")) return;

    // Reset locally
    const existing = getLocalProjects();
    const updatedList = existing.map((p) => (p.id === projectId ? { ...p, responses: {}, participation: {} } : p));
    saveLocalProjects(updatedList);
    setProjects(updatedList);

    const localSess = getLocalActiveSession();
    if (localSess && localSess.project.id === projectId) {
      localSess.project.responses = {};
      localSess.project.participation = {};
      saveLocalActiveSession(localSess);
      setActiveSession({ ...localSess });
    }

    try {
      await apiFetch("/api/admin/reset-responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": getAuthToken()
        },
        body: JSON.stringify({ projectId })
      });
    } catch (err) {
      // Handled locally
    }
  };

  const downloadStudentCodes = async (project: CESCProject) => {
    try {
      const prepared = ensureStudentCodes(project);
      if (getLocalActiveSession()?.project.id === project.id && configurationIsFrozen(project, prepared)) {
        alert("Tanca la sessió abans de generar codis nous."); return;
      }
      if (configurationIsFrozen(project, prepared)) await handleSaveProjectDetails(prepared);
      const url = URL.createObjectURL(new Blob([studentCodeSheet(prepared, activeSession?.project.id === project.id ? activeSession.code : undefined)], {type:"text/html;charset=utf-8"}));
      const a = document.createElement("a"); a.href=url; a.download="codis-individuals-cesc.html"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch(error) { alert((error as Error).message); }
  };

  // --- EXPORT/IMPORT MECHANISM ---
  const handleExportJSON = (project: CESCProject) => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(project, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `CESC_${project.title.replace(/\s+/g, "_")}_export.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleExportExcel = (project: CESCProject) => {
    const formatCell = (val: string) => {
      if (!val) return "";
      let clean = val.replace(/"/g, '""');
      if (clean.includes(";") || clean.includes(",") || clean.includes("\n") || clean.includes("\r") || clean.includes('"')) {
        clean = `"${clean}"`;
      }
      return clean;
    };

    const getStudentOrderNumber = (name: string): string => {
      if (!name) return "";
      const trimmed = name.trim().toLowerCase();
      const idx = project.students.findIndex(s => s.trim().toLowerCase() === trimmed);
      if (idx !== -1) {
        return String(idx + 1);
      }
      return "Error";
    };

    let csvContent = "\uFEFF";

    const headers = ["Nº", "Alumne/a"];
    project.questions.forEach((q) => {
      headers.push(`${q.id}. ${q.text}`);
    });
    csvContent += headers.map(formatCell).join(";") + "\r\n";

    const responseList = Object.values(project.responses || {});
    const exportedResponseIds = new Set<string>();
    const exportRows: { name: string; answers: { [qId: number]: string[] }; hasResponded: boolean }[] = [];

    project.students.forEach((s) => {
      const resp = responseList.find(r => r.studentName.trim().toLowerCase() === s.trim().toLowerCase());
      if (resp) {
        exportRows.push({
          name: s,
          answers: resp.answers || {},
          hasResponded: true
        });
        exportedResponseIds.add(resp.studentSessionId);
      } else {
        exportRows.push({
          name: s,
          answers: {},
          hasResponded: false
        });
      }
    });

    let anonCounter = 1;
    responseList.forEach((r) => {
      if (!exportedResponseIds.has(r.studentSessionId)) {
        const displayName = r.studentName && r.studentName !== "Anònim" 
          ? r.studentName 
          : `Alumne Anònim ${anonCounter++}`;
        exportRows.push({
          name: displayName,
          answers: r.answers || {},
          hasResponded: true
        });
      }
    });

    exportRows.forEach((row, itemIdx) => {
      const r1: string[] = [String(itemIdx + 1), row.name];
      project.questions.forEach((q) => {
        const choices = row.answers[q.id] || [];
        r1.push(getStudentOrderNumber(choices[0]));
      });
      csvContent += r1.map(formatCell).join(";") + "\r\n";

      const r2: string[] = ["", ""];
      project.questions.forEach((q) => {
        const choices = row.answers[q.id] || [];
        r2.push(getStudentOrderNumber(choices[1]));
      });
      csvContent += r2.map(formatCell).join(";") + "\r\n";

      const r3: string[] = ["", ""];
      project.questions.forEach((q) => {
        const choices = row.answers[q.id] || [];
        r3.push(getStudentOrderNumber(choices[2]));
      });
      csvContent += r3.map(formatCell).join(";") + "\r\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", url);
    downloadAnchor.setAttribute("download", `CESC_${project.title.replace(/\s+/g, "_")}_resultats.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    const file = e.target.files?.[0];
    if (!file) return;

    fileReader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string) as CESCProject;
        if (!parsed.title || !Array.isArray(parsed.students) || !Array.isArray(parsed.questions)) {
          alert("L'arxiu JSON no sembla tenir l'estructura vàlida d'un qüestionari CESC.");
          return;
        }

        if (!parsed.id) {
          parsed.id = "proj-" + Math.random().toString(36).substr(2, 9);
        }

        if (getLocalActiveSession()?.project.id === parsed.id) {
          alert("No es pot importar damunt d’un qüestionari obert. Tanca primer la sessió."); return;
        }
        // Save directly to localStorage
        const existing = getLocalProjects();
        const existingIdx = existing.findIndex((p) => p.id === parsed.id);
        let updatedList = [...existing];
        if (existingIdx !== -1) {
          updatedList[existingIdx] = parsed;
        } else {
          updatedList.push(parsed);
        }
        saveLocalProjects(updatedList);
        setProjects(updatedList);
        setSelectedProjectId(parsed.id);

        // Attempt server save if available
        try {
          await apiFetch("/api/admin/projects", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": getAuthToken()
            },
            body: JSON.stringify(parsed)
          });
        } catch {}

        alert(`S'ha importat correctament: ${parsed.title}`);
      } catch (err) {
        alert("Error en processar l'arxiu JSON. Assegureu-vos d'escollir un fitxer .json vàlid.");
      }
    };
    fileReader.readAsText(file);
  };

  // --- STUDENT EXPERIENCES ACTIONS (DUAL-MODE) ---
  const handleStudentJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setStudentCodeError("");

    const enteredCode = studentCodeInput.trim().toUpperCase();
    if (!SESSION_CODE_PATTERN.test(enteredCode)) {
      setStudentCodeError("Introdueix un codi de 6 lletres o números.");
      return;
    }

    // 1. Try server first
    try {
      const resp = await apiFetch(`/api/student/session/${enteredCode}`);
      if (resp.ok) {
        const data = await resp.json();
        setJoinedSessionData(data);
        const pending = pendingResponseRef.current;
        const canRestore = pending?.code === data.code && pending?.sessionId === data.sessionId;
        setStudentAnswers(canRestore ? pending.answers : {});
        setSelectedSelfName(canRestore ? pending.studentName : "");
        setStudentActiveQuestionIdx(0);
        setStudentStep("welcome");
        return;
      }
    } catch (err) {
      // Server unreachable (GitHub Pages / offline)
    }

    setStudentCodeError("No s’ha pogut connectar. Comprova el codi, Internet i que administració tingui la sessió oberta.");
  };

  // A single ordered sender; newest snapshot survives failures and is retried.
  async function flushPendingResponse(): Promise<boolean> {
    if (sendingResponseRef.current) return false;
    sendingResponseRef.current = true;
    try {
      while (pendingResponseRef.current) {
        const payload = pendingResponseRef.current;
        setStudentSyncStatus("syncing");
        const resp = await apiFetch("/api/student/sync", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!resp.ok || !(await resp.json()).success) throw new Error("No s’ha confirmat la recepció.");
        if (pendingResponseRef.current === payload) {
          pendingResponseRef.current = null;
          sessionStorage.removeItem("cesc_pending_response");
        }
      }
      setStudentSyncStatus("synced");
      return true;
    } catch {
      setStudentSyncStatus("error");
      return false;
    } finally { sendingResponseRef.current = false; }
  }

  const syncAnswersWithServer = async (answers: typeof studentAnswers, name: string, completed = false) => {
    if (!joinedSessionData || !studentAccessRef.current) return false;
    const payload = {
      code: joinedSessionData.code, sessionId: joinedSessionData.sessionId,
      studentSessionId, studentName: name, answers, completed, ...studentAccessRef.current
    };
    pendingResponseRef.current = payload;
    sessionStorage.setItem("cesc_pending_response", JSON.stringify(payload));
    setStudentSyncStatus("syncing");
    return flushPendingResponse();
  };

  const handleStudentSelfIdentify = (name: string) => {
    setSelectedSelfName(name);
    setStudentAccessError("");
  };

  const handleStudentNextStepWelcome = () => {
    if (joinedSessionData?.allowSelfIdentification) {
      setStudentStep("selfify");
    } else {
      setSelectedSelfName("Anònim");
      setStudentStep("questions");
    }
  };

  const handleStudentNextStepSelfify = async () => {
    if (!joinedSessionData || claimingStudent) return;
    if (joinedSessionData.accessMode === "individual" ? !/^[A-Z0-9]{6}([A-Z0-9]{2})?$/.test(individualCodeInput) : !selectedSelfName) return;
    setClaimingStudent(true); setStudentAccessError("");
    try {
      let deviceId = localStorage.getItem("cesc_device_id");
      if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem("cesc_device_id", deviceId); }
      const response = await apiFetch("/api/student/claim", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ code: joinedSessionData.code, sessionId: joinedSessionData.sessionId, individualCode: individualCodeInput, studentName:selectedSelfName, deviceId })
      });
      const access = await response.json();
      if (!response.ok) throw new Error(access.error || "No s’ha autoritzat l’accés.");
      setSelectedSelfName(access.studentName);
      studentAccessRef.current = { token: access.token, deviceId };
      setStudentSessionId(access.studentSessionId);
      sessionStorage.setItem("cesc_student_session_id", access.studentSessionId);
      pendingResponseRef.current = null; sessionStorage.removeItem("cesc_pending_response");
      setStudentAnswers(access.answers || {}); setStudentSyncStatus("synced");
      setStudentStep(access.completed ? "completed" : "questions");
    } catch (error) {
      setStudentAccessError(error instanceof Error ? error.message : "No s’ha pogut connectar amb administració.");
    } finally { setClaimingStudent(false); }
  };

  // Choices nomination change for student active question
  const handleChoiceChange = (choiceIndex: number, value: string) => {
    if (value && selectedSelfName && value.trim().toLowerCase() === selectedSelfName.trim().toLowerCase()) {
      alert("No et pots seleccionar a tu mateix/a per a les preguntes!");
      return;
    }
    const qId = joinedSessionData!.questions[studentActiveQuestionIdx].id;
    const currentQuestionChoices = [...(studentAnswers[qId] || ["", "", ""])];
    currentQuestionChoices[choiceIndex] = value;

    const nextAnswers = {
      ...studentAnswers,
      [qId]: currentQuestionChoices
    };

    setStudentAnswers(nextAnswers);
    // MANDATORY REAL-TIME AUTO-SAVE BACK TO THE SERVER!
    syncAnswersWithServer(nextAnswers, selectedSelfName);
  };

  const handleQuestionPrevious = () => {
    if (studentActiveQuestionIdx > 0) {
      setStudentActiveQuestionIdx(studentActiveQuestionIdx - 1);
      // Reset reveal timer when shifting context
      setIsAnswersRevealed(false);
      setRevealCountdown(0);
    }
  };

  const handleQuestionNext = async () => {
    const currentQ = joinedSessionData!.questions[studentActiveQuestionIdx];
    const currentChoices = studentAnswers[currentQ.id] || [];
    
    if (studentActiveQuestionIdx < joinedSessionData!.questions.length - 1) {
      setStudentActiveQuestionIdx(studentActiveQuestionIdx + 1);
      // Reset privacy reveal timer
      setIsAnswersRevealed(false);
      setRevealCountdown(0);
    } else {
      setStudentStep("review");
    }
  };

  // Launch the privacy unmasker
  const triggerRevealAnswersTimer = () => {
    setIsAnswersRevealed(true);
    setRevealCountdown(10);
  };

  const handleResetStudentWorkflow = () => {
    if (pendingResponseRef.current) return;
    const freshId = "stud_" + crypto.randomUUID();
    sessionStorage.setItem("cesc_student_session_id", freshId);
    setStudentSessionId(freshId);
    studentAccessRef.current = null;
    setIndividualCodeInput("");
    setStudentCodeInput("");
    setJoinedSessionData(null);
    setStudentStep("join");
    setStudentAnswers({});
    setSelectedSelfName("");
    setStudentActiveQuestionIdx(0);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 antialiased font-sans">
      
      {/* GLOBAL APPLICATION BAR */}
      <header className="bg-white border-b-4 border-slate-900 sticky top-0 z-40 h-16 flex items-center shrink-0">
        <div className="max-w-7xl w-full mx-auto px-4 flex items-center justify-between">
          <button
            onClick={handleResetStudentWorkflow}
            className="flex items-center gap-2.5 text-left focus:outline-none cursor-pointer group"
          >
            <div className="w-10 h-10 bg-indigo-600 border-2 border-slate-900 flex items-center justify-center text-white font-black text-lg shadow-[2px_2px_0px_rgba(0,0,0,1)] group-hover:translate-x-0.5 group-hover:translate-y-0.5 group-hover:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all">
              C
            </div>
            <div>
              <span className="font-black text-slate-900 block text-sm tracking-tight sm:text-base uppercase">CESC INS Mollet</span>
              <span className="text-[9px] text-indigo-600 block -mt-1 font-black uppercase tracking-wider">Gestió Clima Social</span>
            </div>
          </button>

          <div className="flex items-center gap-2 sm:gap-3">


            {currentView === "admin-portal" ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    fetchAdminPassword();
                    setShowSecurityModal(true);
                  }}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-none text-xs md:text-sm font-black text-amber-900 bg-amber-200 hover:bg-amber-300 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 cursor-pointer"
                  title="Consultar o modificar la contrasenya de convivència"
                >
                  <Key className="w-3.5 h-3.5 text-amber-900" />
                  <span className="hidden sm:inline">Contrasenya</span>
                </button>
                <button
                  onClick={handleAdminLogout}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-none text-xs md:text-sm font-black text-white bg-rose-500 hover:bg-rose-600 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Surt Panell</span>
                </button>
              </div>
            ) : currentView !== "role-select" ? (
              <button
                onClick={() => {
                  handleResetStudentWorkflow();
                  setCurrentView("role-select");
                }}
                className="flex items-center gap-1.5 h-9 px-3 rounded-none text-xs md:text-sm font-black text-slate-900 bg-white hover:bg-slate-50 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Inici</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  if (isAdminAuthenticated) {
                    setCurrentView("admin-portal");
                  } else {
                    setCurrentView("admin-login");
                  }
                }}
                className="flex items-center gap-1.5 h-9 px-3 rounded-none text-xs md:text-sm font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5"
                id="btn-nav-admin"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Gestió Professorat</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* MAIN VIEW CONTROLLER GRID */}
      {isLocalMode && (
        <div role="status" className="bg-amber-100 border-b-2 border-slate-900 p-3 text-sm text-center">
          Connexió directa entre dispositius. Mantén la consola d’administració oberta per rebre respostes.
          Les dades es desen al navegador d’administració: exporta còpies JSON.
        </div>
      )}
      <main className="flex-1 flex flex-col max-w-7xl w-full mx-auto p-4 sm:p-6 justify-center">
        
        {/* VIEW 1: ROLE SELECT (LANDING) */}
        {currentView === "role-select" && (
          <div className="max-w-4xl w-full mx-auto space-y-8 py-4 sm:py-8 animate-fade-in">
            <div className="text-center space-y-3">
              <span className="px-3 py-1 bg-indigo-100 border-2 border-slate-900 text-indigo-700 text-xs font-black uppercase tracking-wider inline-block shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                Orientació i Convivència Escolar
              </span>
              <h1 className="text-3xl sm:text-5xl font-black text-slate-900 tracking-tight leading-none uppercase">
                Qüestionari Sociomètric <span className="text-indigo-600 underline decoration-indigo-200">CESC</span>
              </h1>
              <p className="text-slate-700 max-w-xl mx-auto text-sm sm:text-base font-semibold">
                Plataforma per a l'avaluació de la conducta i les experiències socials a l'aula. Segur, confidencial i instantani.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
              {/* Card 1: Students Portal */}
              <div 
                className="bg-white border-4 border-slate-900 p-6 sm:p-8 flex flex-col justify-between shadow-[6px_6px_0px_rgba(0,0,0,1)] hover:shadow-[8px_8px_0px_rgba(0,0,0,1)] hover:-translate-x-1 hover:-translate-y-1 transition-all duration-200 relative group overflow-hidden"
                id="panel-alumnat"
              >
                <div className="absolute top-0 right-0 p-8 text-indigo-100/40 group-hover:text-indigo-200/35 transition-colors pointer-events-none">
                  <GraduationCap className="w-32 h-32" />
                </div>
                
                <div className="space-y-4">
                  <div className="w-12 h-12 border-2 border-slate-900 bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                    <GraduationCap className="w-6 h-6" />
                  </div>
                  <div className="space-y-1.5">
                    <h2 className="text-xl sm:text-2xl font-black uppercase italic text-slate-900">Portal de l'Alumnat</h2>
                    <p className="text-sm text-slate-600 leading-relaxed font-semibold">
                      Accedeix ràpidament per contestar el qüestionari del teu grup fent servir el codi facilitat pel professor.
                    </p>
                  </div>
                </div>

                <div className="pt-6 z-10">
                  <button
                    onClick={() => setCurrentView("student-portal")}
                    className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-black border-2 border-slate-900 shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 transition-all flex items-center justify-center gap-2 uppercase cursor-pointer"
                  >
                    <span>Contestar Qüestionari</span>
                    <ArrowRight className="w-4.5 h-4.5" />
                  </button>
                </div>
              </div>

              {/* Card 2: Admin/Management portal */}
              <div 
                className="bg-white border-4 border-slate-900 p-6 sm:p-8 flex flex-col justify-between shadow-[6px_6px_0px_rgba(0,0,0,1)] hover:shadow-[8px_8px_0px_rgba(0,0,0,1)] hover:-translate-x-1 hover:-translate-y-1 transition-all duration-200 relative group overflow-hidden"
                id="panel-professorat"
              >
                <div className="absolute top-0 right-0 p-8 text-emerald-100/40 group-hover:text-emerald-250/35 transition-colors pointer-events-none">
                  <Users className="w-32 h-32" />
                </div>

                <div className="space-y-4">
                  <div className="w-12 h-12 border-2 border-slate-900 bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                    <Users className="w-6 h-6" />
                  </div>
                  <div className="space-y-1.5">
                    <h2 className="text-xl sm:text-2xl font-black uppercase italic text-slate-900">Gestió del Professorat</h2>
                    <p className="text-sm text-slate-600 leading-relaxed font-semibold">
                      Administra les llistes d'alumnes, configura preguntes, obre sessions de respostes i analitza els resultats sociomètrics en temps real.
                    </p>
                  </div>
                </div>

                <div className="pt-6 z-10">
                  <button
                    onClick={() => {
                      if (isAdminAuthenticated) {
                        setCurrentView("admin-portal");
                      } else {
                        setCurrentView("admin-login");
                      }
                    }}
                    className="w-full h-12 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black border-2 border-slate-900 shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 transition-all flex items-center justify-center gap-2 uppercase cursor-pointer"
                  >
                    <span>Accés Administració</span>
                    <Lock className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Privacy details and values */}
            <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10 pt-4 text-xs font-black uppercase tracking-wider text-slate-500 text-center">
              <span className="flex items-center gap-1.5 bg-indigo-50 border-2 border-slate-900 px-3 py-1.5 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                <ShieldCheck className="w-4.5 h-4.5 text-indigo-600" />
                Respostes enviades directament a administració
              </span>
              <span className="flex items-center gap-1.5 bg-rose-50 border-2 border-slate-900 px-3 py-1.5 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                <HeartPulse className="w-4.5 h-4.5 text-rose-500" />
                Detecció activa d'exclusió social
              </span>
              <span className="flex items-center gap-1.5 bg-emerald-50 border-2 border-slate-900 px-3 py-1.5 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600" />
                Exportació JSON immediata
              </span>
            </div>
          </div>
        )}

        {/* VIEW 2: PASSWORD CHECK LOCK (ADMIN-LOGIN) */}
        {currentView === "admin-login" && (
          <div className="max-w-md w-full mx-auto bg-white border-4 border-slate-900 shadow-[6px_6px_0px_rgba(0,0,0,1)] p-6 sm:p-8 animate-fade-in my-8">
            <div className="text-center space-y-2 mb-6">
              <div className="w-12 h-12 border-2 border-slate-900 bg-indigo-100 text-indigo-650 flex items-center justify-center mx-auto shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                <Lock className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-black uppercase italic text-slate-900 border-b-2 border-slate-900 pb-2">Accés Reservat</h2>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-tight mt-2">
                S'ha d'introduir la contrasenya autoritzada de l'Institut Mollet per administrar els qüestionaris CESC de l'escola.
              </p>
            </div>

            <form onSubmit={handleAdminLogin} className="space-y-4" id="form-admin-login">
              <div>
                <label className="block text-xs font-black text-slate-800 mb-1.5 uppercase tracking-wider">Contrasenya de Convivència</label>
                <div className="relative">
                  <input
                    type={showLoginPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Introdueix la contrasenya..."
                    className="w-full h-11 px-3 pr-10 border-2 border-slate-900 text-sm bg-white focus:outline-none focus:bg-indigo-50 font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    className="absolute right-2.5 top-2.5 p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
                    title={showLoginPassword ? "Oculta la contrasenya" : "Mostra la contrasenya"}
                  >
                    {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {authError && (
                <div className="p-3 bg-rose-105 text-rose-800 text-xs font-bold border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                  {authError}
                </div>
              )}

              <button
                type="submit"
                className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-black border-2 border-slate-900 shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:shadow-[1px_1px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 transition-all text-sm uppercase flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Desbloqueja Panell</span>
                <Unlock className="w-4 h-4" />
              </button>
            </form>

            <div className="mt-6 pt-5 border-t-2 border-slate-900 text-center">
              <button
                onClick={() => setCurrentView("role-select")}
                className="text-xs font-black text-slate-600 hover:text-indigo-605 uppercase tracking-widest inline-flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Tornar enrere
              </button>
            </div>
          </div>
        )}

        {/* VIEW 3: STUDENT WORKFLOW PORTAL */}
        {currentView === "student-portal" && (
          <div className="max-w-2xl w-full mx-auto py-2 sm:py-6 animate-fade-in">
            
            {/* STUDY PORTAL STEP A: CODE INSERT */}
            {studentStep === "join" && (
              <div className="bg-white border-4 border-slate-900 shadow-[6px_6px_0px_rgba(0,0,0,1)] p-6 sm:p-8 space-y-5 my-4">
                <div className="text-center space-y-2">
                  <span className="px-2.5 py-1 bg-indigo-100 border-2 border-slate-900 text-[10px] uppercase font-bold text-indigo-650 inline-block shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                    Conexió del Grup
                  </span>
                  <h2 className="text-2xl sm:text-3xl font-black uppercase italic text-slate-900">Introdueix el Codi d'Accés</h2>
                  <p className="text-xs sm:text-sm text-slate-600 font-semibold max-w-sm mx-auto">
                    El teu tutor o orientador t'ha de facilitar el codi generat de 6 lletres o números per connectar-te amb el qüestionari del teu grup classe.
                  </p>
                </div>

                <form onSubmit={handleStudentJoin} className="space-y-4" id="form-student-join">
                  <div>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      minLength={6}
                      pattern="[A-Za-z0-9]{6}"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      autoFocus
                      placeholder="EXEMPLE: A1B2C3"
                      value={studentCodeInput}
                      onChange={(e) => setStudentCodeInput(e.target.value.toUpperCase().replace(/[^a-zA-Z0-9]/g, ""))}
                      className="w-full h-14 text-center text-xl font-bold tracking-widest uppercase border-2 border-slate-900 rounded-none focus:bg-indigo-50 outline-none transition-all placeholder:text-slate-350 bg-white"
                    />
                  </div>

                  {studentCodeError && (
                    <div className="p-3 bg-rose-100 border-2 border-slate-900 text-rose-800 text-xs font-bold text-center">
                      {studentCodeError}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white text-base font-black border-2 border-slate-900 shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 transition-all flex items-center justify-center gap-2 uppercase cursor-pointer"
                  >
                    <span>Entra a l'aula</span>
                    <ArrowRight className="w-4.5 h-4.5" />
                  </button>
                </form>

                <div className="pt-2 text-center border-t border-slate-205">
                  <p className="text-[11px] font-bold text-slate-450 uppercase">
                    Cal connexió a Internet i que el professorat mantingui la consola oberta.
                  </p>
                </div>
              </div>
            )}

            {/* STUDY PORTAL STEP B: WELCOME MESSAGE */}
            {studentStep === "welcome" && joinedSessionData && (
              <div className="bg-white border-4 border-slate-900 p-6 sm:p-8 space-y-6 my-4 shadow-[6px_6px_0px_rgba(0,0,0,1)]">
                <div className="space-y-1">
                  <span className="text-xs font-black text-indigo-700 bg-indigo-100 py-1 px-2.5 border-2 border-slate-900 inline-block shadow-[2px_2px_0px_rgba(0,0,0,1)] uppercase">
                    Codi: {joinedSessionData.code}
                  </span>
                  <h2 className="text-2xl font-black uppercase text-slate-900 mt-2">{joinedSessionData.title}</h2>
                  <p className="text-xs font-bold uppercase tracking-wide text-indigo-650">Escola: Convivència INS Mollet</p>
                </div>

                <div className="p-4 bg-slate-50 border-2 border-slate-900 rounded-none space-y-3.5 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                  <h3 className="text-sm font-black text-slate-905 uppercase tracking-wide flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-indigo-600" />
                    Advertència de Seguretat i Privacitat
                  </h3>
                  <div className="text-xs text-slate-750 space-y-2 leading-relaxed font-sans font-medium">
                    <p>
                      <strong>Les teves respostes són estrictament confidencials.</strong> Estan pensades exclusivament per ajudar l'equip d'orientació del centre a comprendre millor com es relaciona el qüestionari del grup classe i millorar-ne el clima de convivència.
                    </p>
                    <p>
                      Cap dels teus companys i companyes podrà veure el que tries. Durant el qüestionari, les teves tries quedaran amagades automatically sota asteriscs (••••), per protegir la teva privacitat si algú et mira la pantalla.
                    </p>
                    <p>
                      Si us plau, respon de forma sincera, pensant en cada pregunta d'una forma tranquil·la i madura. No hi ha respostes ni bones ni dolentes.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4 pt-2">
                  <button
                    disabled={studentSyncStatus !== "synced"}
                    onClick={handleResetStudentWorkflow}
                    className="flex-1 h-12 bg-white hover:bg-slate-50 text-slate-700 font-bold border-2 border-slate-900 shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:shadow-[1px_1px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 text-sm uppercase transition-all cursor-pointer"
                  >
                    Cancel·la
                  </button>
                  <button
                    onClick={handleStudentNextStepWelcome}
                    className="flex-1 h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-black border-2 border-slate-900 shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:shadow-[1px_1px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 text-sm uppercase transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>Comença el test</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STUDY PORTAL STEP C: SELF IDENTIFY (CHOOSE NAME) */}
            {studentStep === "selfify" && joinedSessionData && (
              <div className="bg-white border-4 border-slate-900 p-6 sm:p-8 space-y-6 my-4 shadow-[6px_6px_0px_rgba(0,0,0,1)]">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-700 animate-pulse"></span>
                    <span className="text-xs font-black text-indigo-650 uppercase tracking-wider">Identificació de l'Alumne</span>
                  </div>
                  <h2 className="text-2xl font-black uppercase text-slate-900">{joinedSessionData.accessMode === "individual" ? "Introdueix el teu codi individual" : "Selecciona el teu nom"}</h2>
                </div>
                {joinedSessionData.accessMode === "individual" ? <>
                  <p>Introdueix el codi privat de la teva targeta (6 o 8 caràcters). No el comparteixis.</p>
                  <label htmlFor="individual-student-code" className="block font-bold">Codi individual</label>
                  <input id="individual-student-code" value={individualCodeInput} disabled={claimingStudent}
                    maxLength={8} autoCapitalize="characters" autoComplete="off"
                    onChange={e => { setIndividualCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")); setStudentAccessError(""); }}
                    className="w-full border-2 border-slate-900 p-3 font-mono text-xl tracking-widest text-center" />
                </> : <SearchableSelect options={joinedSessionData.students} value={selectedSelfName}
                  onChange={handleStudentSelfIdentify} disabled={claimingStudent}
                  placeholder="Selecciona el teu nom..." id="student-self-identify-dropdown" />}
                {studentAccessError && <p role="alert" className="p-3 bg-rose-100 text-rose-900 border-2 border-rose-900 font-bold">{studentAccessError}</p>}
                <div className="flex gap-4 pt-4">
                  <button
                    onClick={() => setStudentStep("welcome")}
                    className="h-11 px-4 bg-slate-50 hover:bg-slate-100 text-slate-650 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] text-xs font-bold uppercase transition-transform active:translate-y-0.5 cursor-pointer"
                  >
                    Enrere
                  </button>
                  <button
                    disabled={(joinedSessionData.accessMode === "individual" ? ![6,8].includes(individualCodeInput.length) : !selectedSelfName) || claimingStudent}
                    onClick={handleStudentNextStepSelfify}
                    className={`flex-1 h-11 text-white font-black border-2 border-slate-900 text-sm uppercase transition-all flex items-center justify-center gap-1.5 cursor-pointer
                      ${(joinedSessionData.accessMode === "individual" ? [6,8].includes(individualCodeInput.length) : !!selectedSelfName) ? "bg-indigo-600 hover:bg-indigo-700 shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:shadow-[1px_1px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5" : "bg-slate-200 text-slate-400 cursor-not-allowed"}
                    `}
                  >
                    <span>{claimingStudent ? "Comprovant accés…" : "Continua cap al test"}</span>
                    <ArrowRight className="w-4.5 h-4.5" />
                  </button>
                </div>
              </div>
            )}

            {/* STUDY PORTAL STEP D: QUESTIONNAIRE STEPPER (12 QUESTIONS) */}
            {studentStep === "questions" && joinedSessionData && (
              <div className="space-y-4 my-2 sm:my-4">
                
                {/* Visual stepper indicator */}
                <div className="bg-white px-4 py-3 border-4 border-slate-900 shadow-[4px_4px_0px_rgba(0,0,0,1)] flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex-1">
                    <div className="flex justify-between items-center text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                      <span>Progrés del Qüestionari</span>
                      <span>Pregunta {studentActiveQuestionIdx + 1} de {joinedSessionData.questions.length}</span>
                    </div>
                    {/* Progress Bar */}
                    <div className="w-full h-3.5 bg-slate-100 border-2 border-slate-900 rounded-none overflow-hidden animate-pulse">
                      <div
                        className="h-full bg-indigo-600 border-r border-slate-900 transition-all duration-300"
                        style={{
                          width: `${((studentActiveQuestionIdx + 1) / joinedSessionData.questions.length) * 100}%`
                        }}
                      />
                    </div>
                  </div>

                  {/* Real-time sync visual state badge */}
                  <div className="shrink-0">
                    {studentSyncStatus === "synced" && (
                      <span className="inline-flex items-center gap-1 text-[9px] bg-emerald-100 text-emerald-800 border-2 border-slate-900 font-extrabold px-2.5 py-1 shadow-[1px_1px_0px_rgba(0,0,0,1)] uppercase leading-none">
                        ● Rebut per administració
                      </span>
                    )}
                    {studentSyncStatus === "syncing" && (
                      <span className="inline-flex items-center gap-1 text-[9px] bg-indigo-100 text-indigo-805 border-2 border-slate-900 font-extrabold px-2.5 py-1 shadow-[1px_1px_0px_rgba(0,0,0,1)] uppercase leading-none">
                        <RefreshCw className="w-2.5 h-2.5 animate-spin mr-1" />
                        Enviant a administració...
                      </span>
                    )}
                    {studentSyncStatus === "error" && (
                      <span className="inline-flex items-center gap-1 text-[9px] bg-rose-100 text-rose-800 border-2 border-slate-900 font-extrabold px-2.5 py-1 shadow-[1px_1px_0px_rgba(0,0,0,1)] uppercase leading-none">
                        ⚠️ Pendent de recepció · reintentant
                      </span>
                    )}
                  </div>
                </div>

                {/* Primary active question card */}
                {(() => {
                  const currentQ = joinedSessionData.questions[studentActiveQuestionIdx];
                  const nominations = studentAnswers[currentQ.id] || ["", "", ""];

                  return (
                    <div className="bg-white border-4 border-slate-900 shadow-[6px_6px_0px_rgba(0,0,0,1)] p-6 sm:p-8 space-y-6">
                      
                      {/* Explanations section */}
                      <div className="space-y-4">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 border-2 border-slate-900 bg-indigo-100 text-indigo-700 font-black text-lg shrink-0 flex items-center justify-center shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                            {currentQ.id}
                          </div>
                          <div>
                            <h3 className="text-xl font-black uppercase tracking-tight text-slate-900">{currentQ.text}</h3>
                            <p className="text-[10px] font-black text-indigo-600 mt-1 uppercase tracking-wider">Instruccions de la resposta</p>
                          </div>
                        </div>

                        <div className="p-4 bg-slate-50 border-2 border-slate-900">
                          <p className="text-xs font-bold text-slate-750 leading-relaxed font-sans">{currentQ.description}</p>
                        </div>
                      </div>

                      {/* Dropdowns fields section */}
                      <div className="space-y-4">
                        <span className="block text-xs font-black text-slate-400 uppercase tracking-widest text-[10px]">
                          Escull fins a un màxim de 3 companys d'aula:
                        </span>

                        {[0, 1, 2].map((idx) => (
                          <div key={idx} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
                            <label className="text-xs font-black text-slate-800 uppercase sm:col-span-1 border-b sm:border-b-0 pb-1">
                              Opció {idx + 1}
                            </label>
                            
                            <div className="sm:col-span-3">
                              <SearchableSelect
                                options={joinedSessionData.students}
                                value={nominations[idx] || ""}
                                onChange={(val) => handleChoiceChange(idx, val)}
                                placeholder="Escriu per cercar un company..."
                                masked={!isAnswersRevealed && !!nominations[idx]} // Masked if selected and not revealed
                                // Avoid choosing the same student multiple times on the same question, or choosing self!
                                excludeOptions={[
                                  selectedSelfName,
                                  ...nominations.filter((n, i) => i !== idx && n !== "")
                                ]}
                                id={`nominacio-select-q${currentQ.id}-${idx}`}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* PRIVACY PROTECTOR TOGGLE BAR (MUST BE EXTREMELY VISIBLE) */}
                      <div className="p-3 bg-slate-50 border-2 border-slate-900 flex items-center justify-between gap-3 shadow-[2px_2px_0px_rgba(0,0,0,1)] animate-fade-in">
                        <div className="flex items-center gap-2">
                          {isAnswersRevealed ? (
                            <Eye className="w-5 h-5 text-indigo-600 animate-pulse" />
                          ) : (
                            <EyeOff className="w-5 h-5 text-slate-500" />
                          )}
                          <div>
                            <span className="block text-xs font-black text-slate-900 uppercase">Privacitat Activa</span>
                            <span className="block text-[9px] text-slate-500 font-bold leading-none mt-1">Noms triats ocultats amb asteriscs per seguretat d'aula.</span>
                          </div>
                        </div>

                        {isAnswersRevealed ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-black text-indigo-705 bg-indigo-50 border border-slate-350 px-2 py-0.5">
                              S'amaga en {revealCountdown}s
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setIsAnswersRevealed(false);
                                setRevealCountdown(0);
                              }}
                              className="text-[10px] font-black uppercase text-rose-600 hover:text-rose-850 underline decoration-2 shrink-0 cursor-pointer"
                            >
                              Amaga
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={triggerRevealAnswersTimer}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase py-1.5 px-3.5 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] select-none cursor-pointer"
                          >
                            Mostra'm (10s)
                          </button>
                        )}
                      </div>

                      {/* Directional Footer control */}
                      <div className="flex justify-between items-center gap-4 pt-4 border-t-2 border-slate-900">
                        <button
                          type="button"
                          onClick={handleQuestionPrevious}
                          disabled={studentActiveQuestionIdx === 0}
                          className={`h-11 px-4 border-2 flex items-center gap-1.5 text-xs font-black uppercase transition-all cursor-pointer
                            ${studentActiveQuestionIdx === 0 ? "border-slate-200 text-slate-350 bg-slate-50 cursor-not-allowed shadow-none" : "border-slate-900 text-slate-905 bg-white hover:bg-slate-50 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-y-0.5"}
                          `}
                        >
                          <ChevronLeft className="w-4.5 h-4.5" />
                          <span>Anterior</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleQuestionNext}
                          className="h-11 px-6 bg-indigo-600 hover:bg-indigo-700 text-white border-2 border-slate-900 flex items-center gap-1.5 text-xs font-black uppercase shadow-[3px_3px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 transition-all cursor-pointer"
                        >
                          <span>
                            {studentActiveQuestionIdx === joinedSessionData.questions.length - 1 ? "Revisa abans d’enviar" : "Següent pregunta"}
                          </span>
                          <ChevronRight className="w-4.5 h-4.5" />
                        </button>
                      </div>

                    </div>
                  );
                })()}

              </div>
            )}

            {studentStep === "review" && joinedSessionData && (
              <section className="bg-white border-4 border-slate-900 p-6 space-y-4 my-4">
                <h2 className="text-2xl font-black">Revisa el qüestionari abans d’enviar-lo</h2>
                <p>{answeredQuestions({questions: joinedSessionData.questions} as CESCProject, studentAnswers)} de {joinedSessionData.questions.length} preguntes amb resposta.</p>
                <p className="bg-amber-100 p-3 font-bold">Les preguntes marcades «En blanc» no tenen cap company seleccionat. Pots revisar-les o lliurar-les en blanc. Després d’enviar, les respostes quedaran bloquejades.</p>
                <ol className="space-y-2">{joinedSessionData.questions.map((q,index) => {
                  const count = (studentAnswers[q.id] || []).filter(Boolean).length;
                  return <li key={q.id} className="border-b border-slate-300 py-2 flex justify-between gap-3 items-center">
                    <span>{index+1}. {q.text} · <strong>{count ? `${count} seleccions` : "En blanc"}</strong></span>
                    <button className="bg-indigo-600 text-white px-3 py-2 font-bold" onClick={() => {setStudentActiveQuestionIdx(index);setIsAnswersRevealed(false);setStudentStep("questions");}}>Revisa pregunta {index+1}</button>
                  </li>;
                })}</ol>
                <button className="bg-indigo-700 text-white px-4 py-3 font-bold" onClick={() => {
                  void syncAnswersWithServer(studentAnswers, selectedSelfName, true); setStudentStep("completed");
                }}>Confirma i envia definitivament</button>
              </section>
            )}

            {/* STUDY PORTAL STEP E: COMPLETED SUCCESS MESSAGE */}
            {studentStep === "completed" && (
              <div className="bg-white border-4 border-slate-900 shadow-[6px_6px_0px_rgba(0,0,0,1)] p-8 space-y-6 text-center my-4 animate-scale-up">
                <div className="w-16 h-16 bg-emerald-100 text-emerald-700 border-2 border-slate-900 flex items-center justify-center mx-auto shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                  <CheckCircle2 className="w-10 h-10" />
                </div>

                <div className="space-y-2">
                  <h2 className="text-2xl sm:text-3xl font-black text-slate-900 uppercase italic">{studentSyncStatus === "synced" ? "Qüestionari enregistrat!" : "Pendent de confirmació"}</h2>
                  <p className="text-sm font-bold text-slate-700">
                    {studentSyncStatus === "synced" ? "Administració ha rebut i desat les teves respostes. Gràcies!" : "Les respostes encara no s’han confirmat. Mantén aquesta pàgina oberta: es reintentarà automàticament."}
                  </p>
                  <p className="text-xs text-slate-500 font-semibold max-w-md mx-auto leading-relaxed mt-2 uppercase">
                    Les teves respostes serviran per millorar la cohesió del grup-classe, evitar situacions d'exclusió i enfortir el clima general de convivència. {studentSyncStatus === "synced" ? "Pots tancar aquesta pàgina." : "No tanquis aquesta pàgina encara."}
                  </p>
                </div>

                <div className="pt-4 max-w-xs mx-auto">
                  <button
                    disabled={studentSyncStatus !== "synced"}
                    onClick={handleResetStudentWorkflow}
                    className="w-full h-11 bg-slate-100 hover:bg-slate-205 text-slate-800 text-xs font-black border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] uppercase cursor-pointer"
                  >
                    Tanca la sessió
                  </button>
                </div>
              </div>
            )}

          </div>
        )}

        {/* VIEW 4: ADMIN / STAFF CONTROL CENTER PANEL */}
        {currentView === "admin-portal" && (
          <div className="space-y-6 animate-fade-in py-2">
            
            {/* Header / Select / Controls */}
            <div className="bg-white p-5 border-4 border-slate-900 shadow-[4px_4px_0px_rgba(0,0,0,1)] flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-indigo-600 border border-slate-900"></div>
                  <h2 className="text-xl font-black uppercase text-slate-900 tracking-tight">Panell d'Orientació CESC</h2>
                </div>
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Grup actiu:</label>
                  <select
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    className="h-9 pl-2 pr-6 border-2 border-slate-900 rounded-none text-xs text-slate-800 bg-white font-black uppercase focus:outline-none cursor-pointer"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} ({p.students.length} alumnes)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Instant Backup export button */}
              {activeProject && (
                <div className="flex items-center gap-2 flex-wrap self-start md:self-auto">
                  <button
                    onClick={() => {
                      fetchAdminPassword();
                      setShowSecurityModal(true);
                    }}
                    className="h-9 px-3 bg-amber-100 hover:bg-amber-200 text-amber-900 font-extrabold text-xs border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition-all flex items-center gap-1.5 uppercase cursor-pointer"
                    title="Consultar o modificar la contrasenya de convivència"
                  >
                    <Key className="w-4 h-4 text-amber-800" />
                    <span>Contrasenya</span>
                  </button>

                  <button
                    onClick={() => handleExportJSON(activeProject)}
                    className="h-9 px-3 bg-indigo-50 hover:bg-slate-100 text-indigo-700 font-extrabold text-xs border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition-all flex items-center gap-1.5 uppercase cursor-pointer"
                    title="Exporta les dades a l'ordinador com a fitxer JSON"
                  >
                    <Download className="w-4 h-4" />
                    <span>Guardar a l'ordinador (JSON)</span>
                  </button>

                  <button
                    onClick={() => handleExportExcel(activeProject)}
                    className="h-9 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-extrabold text-xs border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition-all flex items-center gap-1.5 uppercase cursor-pointer"
                    title="Exporta els resultats del grup-classe en format de graella Excel de 3 files per alumne/a"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Exportar a Excel (CSV)</span>
                  </button>

                  <button
                    onClick={() => handleDeleteProject(activeProject.id)}
                    className="h-9 w-9 bg-rose-50 hover:bg-rose-100 text-rose-600 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition-all flex items-center justify-center cursor-pointer"
                    title="Eliminar aquest qüestionari definitivament"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* LIVE SYSTEM BANNER (PROJECTOR READY) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Session Control Screen */}
              <div className="lg:col-span-4 bg-slate-900 text-white p-6 border-4 border-slate-900 flex flex-col justify-between shadow-[6px_6px_0px_rgba(0,0,0,1)] space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black tracking-widest text-indigo-400 uppercase">Estat del qüestionari</span>
                    {activeSession ? (
                      <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[9px] font-black uppercase tracking-wider">
                        ● Obert de bat a bat
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 bg-slate-800 text-slate-400 border border-slate-700 text-[9px] font-black uppercase tracking-wider">
                        Tancat / Pausat
                      </span>
                    )}
                  </div>
                  
                  <h3 className="text-xl font-black uppercase italic tracking-wide">Control de l'Aula</h3>
                  <p className="text-xs text-slate-400 leading-relaxed font-sans font-semibold">
                    Obre el qüestionari amb un codi de 6 lletres o números i mantén aquesta consola oberta per rebre les respostes dels altres dispositius.
                  </p>
                </div>

                <p role="status" className="text-xs text-amber-200">{liveStatus}</p>
                {activeSession ? (
                  <div className="space-y-4 py-3 border-y-2 border-slate-800">
                    <div className="text-center bg-slate-800 p-4 border-2 border-slate-700">
                      <span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Codi per a l'aula (Projector-Ready)</span>
                      <span className="block text-3xl font-black tracking-widest text-indigo-400 uppercase font-mono select-all">
                        {activeSession.code}
                      </span>
                    </div>

                    <div className="text-xs text-slate-300 flex justify-between uppercase font-bold">
                      <span>Respostes rebudes:</span>
                      <span className="font-bold text-white font-mono bg-slate-800 px-2 py-0.5 border border-slate-700">
                        {Object.values(activeSession.project.responses || {}).length} de {activeSession.project.students.length}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="py-6 text-center border-y-2 border-slate-800">
                    <p className="text-xs text-slate-500 italic font-semibold uppercase">Codi de sessió no generat. Obre el qüestionari a respostes per començar.</p>
                  </div>
                )}

                <div className="space-y-2 pt-2">
                  {!activeSession && (
                    <div className="space-y-2">
                      <label htmlFor="admin-session-code" className="block text-xs font-bold">Codi d’accés (6 lletres o números)</label>
                      <input id="admin-session-code" type="text" maxLength={6}
                        value={adminSessionCode} autoCapitalize="characters" autoCorrect="off"
                        placeholder="Buit: codi automàtic"
                        onChange={(e) => { setAdminSessionCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")); setSessionCodeError(""); }}
                        className="w-full p-2 bg-slate-800 text-white border-2 border-slate-600 font-mono uppercase" />
                      <p className="text-xs text-slate-400">Tria el codi abans d’obrir la sessió o deixa’l buit per generar-lo.</p>
                      {sessionCodeError && <p role="alert" className="text-xs text-rose-300">{sessionCodeError}</p>}
                    </div>
                  )}
                  {activeSession ? (
                    <button
                      onClick={handleCloseSessionOfAnswers}
                      className="w-full h-11 bg-rose-500 hover:bg-rose-600 text-white text-xs font-black border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition-all text-center flex items-center justify-center gap-1.5 uppercase cursor-pointer"
                    >
                      <StopCircle className="w-4 h-4" />
                      Tancar sessió de respostes
                    </button>
                  ) : activeProject ? (
                    <button
                      disabled={isOpeningSession}
                      onClick={() => handleOpenSessionToAnswers(activeProject.id)}
                      className="w-full h-11 bg-indigo-600 hover:bg-indigo-600 text-white text-xs font-black border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition-all text-center flex items-center justify-center gap-1.5 uppercase cursor-pointer"
                    >
                      <Play className="w-4 h-4" />
                      {isOpeningSession ? "Connectant…" : "Obre a respostes d’alumnes"}
                    </button>
                  ) : null}

                  {activeProject && (
                    <button
                      onClick={() => handleResetSessionResponses(activeProject.id)}
                      className="w-full h-10 bg-slate-850 hover:bg-slate-800 text-slate-300 text-xs font-black border-2 border-slate-700 transition-colors flex items-center justify-center gap-1.5 uppercase cursor-pointer"
                      title="Neteja totes les tries actuals per començar una nova sessió"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Reinicia respostes
                    </button>
                  )}
                </div>
              </div>

              {/* CREATION AND BACKUP MANAGEMENT PANEL */}
              <div className="lg:col-span-8 bg-white p-5 border-4 border-slate-900 shadow-[6px_6px_0px_rgba(0,0,0,1)] space-y-4 justify-between flex flex-col">
                <div className="space-y-3.5">
                  <h3 className="text-base font-black text-slate-900 flex items-center gap-1.5 uppercase italic border-b-2 border-slate-900 pb-2">
                    <FileSpreadsheet className="text-indigo-600 w-5 h-5" />
                    Carga d'un nou format de CESC o importació
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Sub-form 1: Create local session */}
                    <div className="space-y-2 p-4 bg-slate-50 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                      <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Crear un nou CESC / Grup</h4>
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={newProjectTitle}
                          onChange={(e) => setNewProjectTitle(e.target.value)}
                          placeholder="Exemple: 1r ESO B"
                          className="w-full h-9 px-3 border-2 border-slate-900 text-xs bg-white focus:outline-none font-bold placeholder:text-slate-400"
                        />
                        <label className="block text-xs font-bold" htmlFor="new-access-mode">Mode d’accés</label>
                        <select id="new-access-mode" value={newProjectAccessMode} onChange={e=>setNewProjectAccessMode(e.target.value as "shared" | "individual")} className="w-full border-2 border-slate-900 p-2 text-sm">
                          <option value="shared">Codi compartit + selecció del nom</option><option value="individual">Codis individuals per alumne</option>
                        </select>
                        {newProjectAccessMode === "individual" && <label className="block text-xs font-bold">Prefix comú (2 caràcters)
                          <input value={newProjectPrefix} maxLength={2} onChange={e=>setNewProjectPrefix(e.target.value.toUpperCase())} className="w-full border-2 border-slate-900 p-2" />
                        </label>}
                        <button
                          onClick={handleCreateNewProject}
                          className="w-full h-9 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition-all flex items-center justify-center gap-1 uppercase cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Genera nou grup
                        </button>
                      </div>
                    </div>

                    {/* Sub-form 2: File Import JSON */}
                    <div className="space-y-2 p-4 bg-slate-50 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] flex flex-col justify-between">
                      <div>
                        <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Importar dades CESC de l'ordinador</h4>
                        <p className="text-[10px] text-slate-5 ruling leading-normal mt-1 font-bold">
                          Afegeix o continua la sessió d'un projecte que vas exportar anteriorment com a fitxer estructurat de tipus `.json`.
                        </p>
                      </div>
                      
                      <div className="relative pt-2">
                        <input
                          type="file"
                          accept=".json"
                          onChange={handleImportJSON}
                          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                        />
                        <div className="w-full h-9 border border-dashed border-indigo-700 bg-indigo-50 hover:bg-indigo-100 flex items-center justify-center text-indigo-700 text-xs font-black transition-all gap-1.5 cursor-pointer shadow-[1px_1px_0px_rgba(0,0,0,1)] uppercase">
                          <Upload className="w-4 h-4" />
                          <span>Selecciona fitxer .json</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t-2 border-slate-900 text-[11px] text-slate-500 font-bold uppercase leading-relaxed max-w-xl flex items-start gap-2">
                  <Info className="w-4.5 h-4.5 text-indigo-500 shrink-0 mt-0.5" />
                  <span>
                    <strong>Gestió de fitxers portables:</strong> l'ordinador central no manté bústies persistents de dades a la xarxa un cop tancat el servidor. Recordeu sempre prémer "Guardar a l'ordinador (JSON)" quan els vostres alumnes hagin acabat per descarregar el resultat consolidat correctament.
                  </span>
                </div>
              </div>

            </div>

            {/* TAB-STABLE SETTINGS SYSTEM */}
            {activeProject ? (
              <div className="bg-white border-4 border-slate-900 overflow-hidden shadow-[6px_6px_0px_rgba(0,0,0,1)]">
                
                {/* Visual tabs selectors */}
                <div className="bg-slate-100 border-b-2 border-slate-900 px-4 flex overflow-x-auto gap-4">
                  <div className="py-3 flex gap-1 sm:gap-4 shrink-0">
                    <span className="text-xs font-black text-slate-900 flex items-center uppercase italic tracking-wider">
                      ★ Grup seleccionat: {activeProject.title}
                    </span>
                  </div>
                </div>

                <div className="p-4 sm:p-6 space-y-8">
                  
                  {activeSession?.project.id === activeProject.id && <p className="bg-amber-100 p-3 font-bold">Qüestionari obert: alumnes, preguntes i codis bloquejats fins que es tanqui la sessió.</p>}
                  <fieldset disabled={activeSession?.project.id === activeProject.id} className="space-y-6 disabled:opacity-60">
                  <section className="space-y-2 border-b-2 border-slate-900 pb-4">
                    <h3 className="font-black">Mode d’accés i codis</h3>
                    <select aria-label="Mode d’accés del qüestionari" value={activeProject.accessMode || "shared"} onChange={e => {
                      if (Object.keys(activeProject.participation || {}).length) {alert("Reinicia totes les respostes abans de canviar el mode d’accés.");return;}
                      void handleSaveProjectDetails({...activeProject,accessMode:e.target.value as "shared"|"individual"});
                    }} className="border-2 border-slate-900 p-2 w-full">
                      <option value="shared">Codi compartit + selecció del nom</option><option value="individual">Codis individuals per alumne</option>
                    </select>
                    {activeProject.accessMode === "individual" && <>
                      <label className="block font-bold">Prefix comú de 2 caràcters
                        <input aria-label="Prefix dels codis individuals" maxLength={2} value={activeProject.codePrefix || "CE"} className="border-2 border-slate-900 p-2 ml-2 w-24"
                          onChange={e => void handleSaveProjectDetails({...activeProject,codePrefix:e.target.value.toUpperCase(),studentCodes:{}})} />
                      </label>
                      <p className="text-xs">Codis de 6 caràcters; s’amplien a 8 quan s’arriba al 70% de les combinacions del prefix. Sense 0, O, 1, I ni L. Canviar el prefix invalida les targetes anteriors.</p>
                    </>}
                  </section>
                  {/* CONFIG SECTION 1: EXCEL CARREGA MASSIVA I ALUMNES */}
                  <div className="space-y-4">
                    <div className="border-b-2 border-slate-900 pb-2">
                      <h3 className="text-lg font-black uppercase italic text-slate-900 flex items-center gap-1.5">
                        <Users className="text-indigo-600 w-5 h-5" />
                        Noms dels Alumnes de la Llista
                      </h3>
                      <p className="text-xs font-semibold text-slate-550 uppercase mt-0.5">
                        Inserta individualment o copia columnes massives des d'un Excel o PDF per tal d'alimentar la identificació dels llistats.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      
                      {/* Left: Excel Loader */}
                      <div className="space-y-3 bg-slate-50 p-4 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] flex flex-col justify-between">
                        <div className="space-y-1.5">
                          <label className="block text-xs font-black text-slate-800 uppercase tracking-wider">Càrrega massiva en columna d'Excel</label>
                          <p className="text-[10px] text-slate-505 font-bold leading-normal">
                            Obre el teu Excel del grup-classe, copia una columna completa de noms i cognoms, i enganxa'ls a la bústia de sota (un alumne per línia).
                          </p>
                        </div>
                        
                        <textarea
                          rows={4}
                          value={bulkInput}
                          onChange={(e) => setBulkInput(e.target.value)}
                          placeholder="Anna Mas&#10;Pol Escudé&#10;Marta Puig..."
                          className="w-full p-2.5 border-2 border-slate-900 text-xs bg-white font-mono font-black focus:outline-none focus:bg-indigo-50"
                        />

                        <button
                          onClick={handleBulkLoadAlumnes}
                          disabled={!bulkInput.trim()}
                          className={`w-full h-9 text-xs font-black border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition-all flex items-center justify-center gap-1.5 uppercase cursor-pointer
                            ${bulkInput.trim() ? "bg-indigo-600 hover:bg-indigo-700 text-white" : "bg-slate-200 text-slate-400 cursor-not-allowed uppercase shadow-none hover:bg-slate-200 active:translate-y-0"}
                          `}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Importa llista massiva</span>
                        </button>
                      </div>

                      {/* Right: Quick addition and controls of existing students */}
                      <div className="space-y-4">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Nom de l'alumne..."
                            id="input-single-student"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                handleAddSingleStudent((e.target as HTMLInputElement).value);
                                (e.target as HTMLInputElement).value = "";
                              }
                            }}
                            className="flex-1 h-9 px-3 border-2 border-slate-900 text-xs bg-white focus:outline-none font-bold placeholder:text-slate-400"
                          />
                          <button
                            onClick={() => {
                              const el = document.getElementById("input-single-student") as HTMLInputElement;
                              if (el) {
                                handleAddSingleStudent(el.value);
                                el.value = "";
                              }
                            }}
                            className="bg-slate-950 hover:bg-slate-800 text-white text-xs font-black border-2 border-slate-900 px-4 h-9 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition-all uppercase cursor-pointer"
                          >
                            Afegir
                          </button>
                        </div>

                        {/* List grid of students */}
                        <div className="border-2 border-slate-900 max-h-48 overflow-y-auto divide-y-2 divide-slate-900 p-1 space-y-0.5 bg-slate-50">
                          {activeProject.students.length > 0 ? (
                            activeProject.students.map((s, index) => (
                              <div key={index} className="flex items-center justify-between py-1.5 px-2.5 hover:bg-indigo-50 transition-colors">
                                {editingStudent && editingStudent.index === index ? (
                                  <div className="flex items-center gap-1.5 w-full">
                                    <input
                                      type="text"
                                      value={editingStudent.name}
                                      onChange={(e) => setEditingStudent({ ...editingStudent, name: e.target.value })}
                                      className="flex-1 h-7 px-2 border-2 border-slate-900 bg-white text-xs font-bold"
                                    />
                                    <button
                                      onClick={handleUpdateStudentName}
                                      className="h-7 px-2.5 bg-indigo-600 text-white border border-slate-900 rounded-none text-10px font-extrabold cursor-pointer uppercase"
                                    >
                                      Desa
                                    </button>
                                    <button
                                      onClick={() => setEditingStudent(null)}
                                      className="h-7 px-2 bg-slate-200 text-slate-800 border border-slate-900 rounded-none text-10px font-bold cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <span className="text-xs font-black text-slate-800">
                                      <span className="text-slate-450 font-mono mr-1">{index + 1}.</span>
                                      {s}
                                    </span>
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={() => setEditingStudent({ index, name: s })}
                                        className="p-1 border border-slate-900 text-slate-800 hover:bg-slate-205 transition-colors cursor-pointer"
                                      >
                                        <Edit3 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={() => handleRemoveStudent(s)}
                                        className="p-1 border border-rose-900 text-rose-600 hover:bg-rose-100 transition-colors cursor-pointer"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            ))
                          ) : (
                            <div className="text-center py-8 text-xs text-slate-400 italic">No hi ha alumnes llistats</div>
                          )}
                        </div>

                      </div>

                    </div>
                  </div>

                  {/* CONFIG SECTION 2: QUESTIONNAIRE PARAMETERS */}
                  <div className="space-y-4">
                    <div className="border-b-2 border-slate-900 pb-2 flex justify-between items-center flex-wrap gap-2">
                      <div>
                        <h3 className="text-lg font-black uppercase italic text-slate-900 flex items-center gap-1.5">
                          <Edit3 className="text-indigo-650 w-5 h-5" />
                          Preguntes del CESC i Paràmetres
                        </h3>
                        <p className="text-xs font-semibold text-slate-500 uppercase mt-0.5">
                          Dissenya, amplia o modifica les preguntes bàsiques que respondrà l'alumnat.
                        </p>
                      </div>

                      {/* Deactivator switch for Q1 */}
                      <div className="flex items-center gap-2 bg-slate-100 py-1.5 px-3 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                        <input
                          type="checkbox"
                          id="checkbox-self-id"
                          checked={true}
                          disabled
                          title="Identificació obligatòria per limitar cada alumne a un dispositiu"
                          className="w-4 h-4 text-indigo-600 border-2 border-slate-900 focus:ring-1 focus:ring-indigo-150 cursor-pointer"
                        />
                        <label htmlFor="checkbox-self-id" className="text-xs font-black text-slate-800 cursor-pointer select-none uppercase tracking-wider">
                          Identificació obligatòria · un navegador per alumne
                        </label>
                      </div>
                    </div>

                    {/* Adding customized questions */}
                    <div className="bg-slate-50 p-4 border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] space-y-3.5">
                      <span className="block text-xs font-black text-slate-700 uppercase tracking-widest text-[10px]">Afegir nova pregunta personalitzada</span>
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                        <div className="md:col-span-4 max-w-full">
                          <label className="block text-[9px] uppercase font-black text-slate-500 mb-1">Títol de la pregunta</label>
                          <input
                            type="text"
                            value={newQuestionText}
                            onChange={(e) => setNewQuestionText(e.target.value)}
                            placeholder="Exemple: Amb qui fas treballs?"
                            className="w-full h-9 px-3 border-2 border-slate-900 text-xs bg-white focus:outline-none font-bold placeholder:text-slate-400"
                          />
                        </div>

                        <div className="md:col-span-6 max-w-full">
                          <label className="block text-[9px] uppercase font-black text-slate-500 mb-1">Explicació addicional descriptiva</label>
                          <input
                            type="text"
                            value={newQuestionDesc}
                            onChange={(e) => setNewQuestionDesc(e.target.value)}
                            placeholder="Troba els tres companys d'aula amb els quals prefereixes fer equips..."
                            className="w-full h-9 px-3 border-2 border-slate-900 text-xs bg-white focus:outline-none font-bold placeholder:text-slate-400"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <button
                            type="button"
                            onClick={handleAddQuestion}
                            className="w-full h-9 bg-slate-950 hover:bg-slate-800 text-white text-xs font-black border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition-transform uppercase cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5 mr-0.5" />
                            Afegir
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* General questions list with inline modifications */}
                    <div className="border-2 border-slate-900 divide-y-2 divide-slate-200 overflow-hidden max-h-110 overflow-y-auto bg-slate-50">
                      {activeProject.questions.map((q) => (
                        <div key={q.id} className="p-4 bg-white hover:bg-indigo-50/20 transition-colors">
                          {editingQuestionId === q.id ? (
                            <div className="space-y-3">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-[10px] font-black text-slate-400 mb-1">Pregunta # {q.id}</label>
                                  <input
                                    type="text"
                                    value={editingQuestionText}
                                    onChange={(e) => setEditingQuestionText(e.target.value)}
                                    className="w-full h-9 px-3 border-2 border-slate-900 text-xs bg-white font-bold"
                                  />
                                </div>
                                <div className="md:col-span-1">
                                  <label className="block text-[10px] font-black text-slate-400 mb-1">Explicació</label>
                                  <input
                                    type="text"
                                    value={editingQuestionDesc}
                                    onChange={(e) => setEditingQuestionDesc(e.target.value)}
                                    className="w-full h-9 px-3 border-2 border-slate-900 text-xs bg-white font-bold"
                                  />
                                </div>
                              </div>
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={handleUpdateQuestion}
                                  className="h-8 px-3.5 bg-indigo-600 hover:bg-indigo-700 text-white border-2 border-slate-900 shadow-[1px_1px_0px_rgba(0,0,0,1)] text-xs font-black uppercase cursor-pointer"
                                >
                                  Guarda Modificació
                                </button>
                                <button
                                  onClick={() => setEditingQuestionId(null)}
                                  className="h-8 px-3.5 bg-slate-100 text-slate-800 border-2 border-slate-900 text-xs font-bold uppercase cursor-pointer"
                                >
                                  Cancel·la
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-4">
                              <div className="space-y-1">
                                <span className="inline-flex items-center justify-center w-5 h-5 rounded-none border border-slate-900 bg-slate-150 text-slate-905 font-extrabold text-xs mr-2 shadow-[1px_1px_0px_rgba(0,0,0,1)] font-mono">
                                  {q.id}
                                </span>
                                <span className="font-extrabold text-slate-900 text-sm tracking-tight uppercase italic">{q.text}</span>
                                <p className="text-xs text-slate-600 font-bold leading-relaxed pl-7">{q.description}</p>
                              </div>

                              <div className="flex gap-1.5 shrink-0 pl-2">
                                <button
                                  onClick={() => {
                                    setEditingQuestionId(q.id);
                                    setEditingQuestionText(q.text);
                                    setEditingQuestionDesc(q.description);
                                  }}
                                  className="p-1.5 border border-slate-900 text-slate-850 hover:bg-slate-100 transition-colors cursor-pointer"
                                  title="Edita pregunta"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteQuestion(q.id)}
                                  className="p-1.5 border border-rose-900 text-rose-550 hover:bg-rose-50 transition-colors cursor-pointer animate-fade-in"
                                  title="Elimina pregunta"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  </fieldset>
                  <section className="space-y-3 border-t-2 border-slate-900 pt-4">
                    <h3 className="text-xl font-black uppercase">Seguiment de l’alumnat</h3>
                    {activeProject.accessMode === "individual" && <button onClick={() => void downloadStudentCodes(activeProject)} className="bg-indigo-700 text-white font-bold p-3">Descarrega targetes NOM + CODI per imprimir</button>}
                    {activeProject.accessMode === "individual" && <p className="text-xs">Obre el fitxer descarregat per imprimir-lo o desar-lo en PDF.</p>}
                    <p className="text-sm">Cada alumne queda vinculat al primer navegador amb què comença. Pot reprendre’l des del mateix navegador. Per canviar de dispositiu o repetir el test, reinicia’n les dades.</p>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead><tr className="bg-indigo-100"><th className="p-2 text-left">Alumne</th><th className="p-2 text-left">Estat</th><th className="p-2 text-left">Preguntes</th><th className="p-2 text-left">Última resposta rebuda</th><th className="p-2 text-left">Comunicació</th><th className="p-2 text-left">Accions</th></tr></thead>
                        <tbody>{activeProject.students.map(name => {
                          const responses = (Object.values(activeProject.responses || {}) as StudentResponse[]).filter(r => r.studentName === name);
                          const started = responses.length > 0 || Object.hasOwn(activeProject.participation || {}, name);
                          const response = responses[0];
                          const finished = responses.some(r => !!r.completedAt);
                          const access = activeProject.participation?.[name];
                          const lastSeen = access?.lastSeenAt ? Date.parse(access.lastSeenAt) : 0;
                          const recent = lastSeen && presenceClock-lastSeen < 45000;
                          const runningHere = activeSession?.project.id === activeProject.id;
                          return <tr key={name} className="border-b border-slate-300">
                            <td className="p-2 font-bold">{name}</td>
                            <td className="p-2">{finished ? "Acabat" : started ? "En curs" : "No iniciat"}</td>
                            <td className="p-2">{answeredQuestions(activeProject,response?.answers)} / {activeProject.questions.length}</td>
                            <td className="p-2">{response?.lastAnswerAt ? new Date(response.lastAnswerAt).toLocaleTimeString("ca-ES") : "—"}</td>
                            <td className="p-2">{!started || finished ? "—" : !runningHere ? "Sessió tancada" : recent ? "Comunicació recent" : "Sense comunicació recent (>45 s)"}
                              {started && !finished && lastSeen > 0 && <span className="block text-xs">Últim senyal: {new Date(lastSeen).toLocaleTimeString("ca-ES")}</span>}
                            </td>
                            <td className="p-2"><button disabled={!started}
                              onClick={() => {
                                const typed = prompt(`Per esborrar les respostes i permetre tornar a contestar, escriu el nom exacte de l’alumne:\n${name}`);
                                if (typed === null) return;
                                if (typed.trim() !== name) { alert("El nom no coincideix. No s’ha esborrat cap dada."); return; }
                                void handleSaveProjectDetails(resetStudent(activeProject, name));
                              }}
                              className="bg-rose-700 text-white font-bold px-3 py-2 disabled:bg-slate-200 disabled:text-slate-500">Esborra i permet tornar a contestar</button></td>
                          </tr>;
                        })}</tbody>
                      </table>
                    </div>
                  </section>

                  {/* CONFIG SECTION 3: REAL-TIME SOCIOMÈTRIC ANALYSIS (SOCIOGRAMVIEW) */}
                  <div className="space-y-4 pt-4 border-t-2 border-slate-950">
                    <div className="border-b-2 border-slate-900 pb-2">
                      <h3 className="text-xl font-black uppercase italic text-slate-950 flex items-center gap-1.5">
                        <Award className="text-emerald-600 w-5.5 h-5.5" />
                        Anàlisi Sociomètric i Sociograma en Directe
                      </h3>
                      <p className="text-xs font-semibold text-slate-500 uppercase mt-0.5">
                        Visualitza els resultats sociomètrics consolidats en temps real a mesura que l'alumnat del grup classe respon les nominacions.
                      </p>
                    </div>

                    <SociogramView project={activeProject} />
                  </div>

                </div>
              </div>
            ) : (
              <div className="p-10 text-center bg-white border-4 border-dashed border-slate-900 shadow-[6px_6px_0px_rgba(0,0,0,1)]">
                <p className="text-slate-600 font-black uppercase italic">Si us plau, genera un qüestionari actiu o importa'l des de dalt per veure la configuració.</p>
              </div>
            )}

          </div>
        )}

        {/* MODAL: GESTIÓ I CONSULTA DE LA CONTRASENYA DE CONVIVÈNCIA */}
        {showSecurityModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
            <div className="bg-white border-4 border-slate-900 shadow-[8px_8px_0px_rgba(0,0,0,1)] max-w-lg w-full p-6 space-y-6 relative">
              
              {/* Header */}
              <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 border-2 border-slate-900 bg-amber-300 flex items-center justify-center shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                    <Key className="w-5 h-5 text-slate-900" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black uppercase text-slate-900 tracking-tight">Contrasenya de Convivència</h3>
                    <p className="text-xs text-slate-500 font-bold uppercase">Consulta i modificació de la clau d'accés</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowSecurityModal(false);
                    setPasswordUpdateMessage("");
                  }}
                  className="w-8 h-8 border-2 border-slate-900 bg-slate-100 hover:bg-rose-100 text-slate-800 hover:text-rose-700 font-black flex items-center justify-center shadow-[2px_2px_0px_rgba(0,0,0,1)] cursor-pointer"
                  title="Tancar"
                >
                  ✕
                </button>
              </div>

              {/* Section 1: Consult Current Password */}
              <div className="space-y-2 p-4 bg-amber-50/60 border-2 border-slate-900 shadow-[3px_3px_0px_rgba(0,0,0,1)]">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-800">
                    Contrasenya Actual Activa
                  </label>
                  <span className="text-[10px] uppercase font-bold text-slate-500">INS Mollet Convivència</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-11 px-3 border-2 border-slate-900 bg-white font-mono font-black text-sm flex items-center justify-between">
                    <span className="tracking-wider">
                      {isPasswordRevealedInModal ? (currentPasswordDisplay || "Carregant...") : "••••••••••••"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsPasswordRevealedInModal(!isPasswordRevealedInModal)}
                      className="text-slate-500 hover:text-slate-900 p-1 cursor-pointer"
                      title={isPasswordRevealedInModal ? "Ocultar" : "Mostrar clau"}
                    >
                      {isPasswordRevealedInModal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyPassword}
                    className="h-11 px-3.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border-2 border-slate-900 font-black text-xs uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-y-0.5 flex items-center gap-1.5 cursor-pointer"
                    title="Copiar al porta-retalls"
                  >
                    {copiedPasswordToast ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-600" />
                        <span className="text-emerald-700">Copiat!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copiar</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-slate-600 font-semibold leading-relaxed">
                  Aquesta és la clau requerida a la pantalla d'accés reservat de convivència.
                </p>
              </div>

              {/* Section 2: Change Password Form */}
              <form onSubmit={handleUpdatePassword} className="space-y-4 pt-2 border-t-2 border-dashed border-slate-300">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                  <Edit3 className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Modificar la contrasenya</span>
                </h4>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-black uppercase text-slate-700 mb-1">
                      Nova contrasenya
                    </label>
                    <input
                      type={isNewPasswordRevealed ? "text" : "password"}
                      required
                      value={newPasswordInput}
                      onChange={(e) => setNewPasswordInput(e.target.value)}
                      placeholder="Escriu la nova contrasenya..."
                      className="w-full h-10 px-3 border-2 border-slate-900 text-sm bg-white focus:outline-none focus:bg-indigo-50 font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-black uppercase text-slate-700 mb-1">
                      Repeteix la nova contrasenya
                    </label>
                    <input
                      type={isNewPasswordRevealed ? "text" : "password"}
                      required
                      value={confirmPasswordInput}
                      onChange={(e) => setConfirmPasswordInput(e.target.value)}
                      placeholder="Torna a escriure-la per confirmar..."
                      className="w-full h-10 px-3 border-2 border-slate-900 text-sm bg-white focus:outline-none focus:bg-indigo-50 font-bold"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="show-new-pass"
                      checked={isNewPasswordRevealed}
                      onChange={(e) => setIsNewPasswordRevealed(e.target.checked)}
                      className="w-4 h-4 rounded-none border-2 border-slate-900 text-indigo-600 focus:ring-0 cursor-pointer"
                    />
                    <label htmlFor="show-new-pass" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                      Mostra el text mentre escric
                    </label>
                  </div>
                </div>

                {passwordUpdateMessage && (
                  <div className={`p-3 text-xs font-bold border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] ${
                    passwordUpdateMessage.startsWith("✓") 
                      ? "bg-emerald-100 text-emerald-900" 
                      : "bg-rose-100 text-rose-900"
                  }`}>
                    {passwordUpdateMessage}
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSecurityModal(false);
                      setPasswordUpdateMessage("");
                    }}
                    className="h-10 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-black uppercase border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] cursor-pointer"
                  >
                    Tancar
                  </button>

                  <button
                    type="submit"
                    disabled={isUpdatingPassword}
                    className="h-10 px-5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase border-2 border-slate-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-y-0.5 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Key className="w-3.5 h-3.5" />
                    <span>{isUpdatingPassword ? "Guardant..." : "Desar Nova Contrasenya"}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}


      </main>

      {/* FOOTER BAR */}
      <footer className="bg-white border-t-4 border-slate-900 py-6 shrink-0 mt-8">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-black text-slate-700 uppercase">
          <span>
            © 2026 Convivència INS Mollet — Departament d'Orientació Educativa
          </span>
          <div className="flex items-center gap-4">
            <span>Guia de Conducta i Experiències Socials a Classe</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
