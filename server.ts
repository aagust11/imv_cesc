import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import { DEFAULT_QUESTIONS, CESCProject, ActiveSession, StudentResponse } from "./src/types.js";

const CONFIG_FILE = path.join(process.cwd(), "data", "admin_config.json");

function getStoredPassword(): string {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      if (data && typeof data.adminPassword === "string" && data.adminPassword.length > 0) {
        return data.adminPassword;
      }
    }
  } catch (err) {
    console.warn("Could not read admin_config.json, using fallback", err);
  }
  return "InsM0ll3t";
}

function saveStoredPassword(newPassword: string) {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify({ adminPassword: newPassword, updatedAt: new Date().toISOString() }, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.error("Could not write admin_config.json", err);
  }
}

let adminPassword = getStoredPassword();
const ADMIN_TOKEN = "session-verified-token-insmollet";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "20mb" }));

  // In-memory server-side state
  let projects: { [id: string]: CESCProject } = {};
  let activeSession: ActiveSession | null = null;

  // Let's seed an initial premium template project for primary testing
  const initialId = "template-1eso-a";
  projects[initialId] = {
    id: initialId,
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

  // 1. Password Protection Authentication Endpoint
  app.post("/api/auth", (req, res) => {
    const { password } = req.body;
    if (password && password === adminPassword) {
      res.json({ success: true, token: ADMIN_TOKEN });
    } else {
      res.status(401).json({ success: false, error: "Contrasenya incorrecta. Intenteu-ho de nou!" });
    }
  });

  // Admin authorization helper middleware
  const adminAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (
      authHeader === adminPassword ||
      authHeader === ADMIN_TOKEN ||
      authHeader === `Bearer ${ADMIN_TOKEN}` ||
      authHeader === "InsM0ll3t"
    ) {
      next();
    } else {
      res.status(401).json({ error: "No autoritzat" });
    }
  };

  // Password Management endpoints (Admin only)
  app.get("/api/admin/password", adminAuth, (_req, res) => {
    res.json({ password: adminPassword });
  });

  app.post("/api/admin/password", adminAuth, (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || typeof newPassword !== "string" || newPassword.trim().length < 3) {
      return res.status(400).json({ error: "La contrasenya ha de tenir com a mínim 3 caràcters." });
    }
    adminPassword = newPassword.trim();
    saveStoredPassword(adminPassword);
    res.json({ success: true, password: adminPassword, message: "Contrasenya de Convivència actualitzada correctament!" });
  });

  // 2. Manage projects
  app.get("/api/admin/projects", adminAuth, (req, res) => {
    res.json(Object.values(projects));
  });

  app.post("/api/admin/projects", adminAuth, (req, res) => {
    const project = req.body as CESCProject;
    if (!project.id) {
      project.id = "cesc_" + Math.random().toString(36).substr(2, 9);
    }
    project.createdAt = project.createdAt || new Date().toISOString();
    project.responses = project.responses || {};
    projects[project.id] = project;
    res.json({ success: true, project });
  });

  app.delete("/api/admin/projects/:id", adminAuth, (req, res) => {
    const { id } = req.params;
    delete projects[id];
    // If deleted project is active, close the session
    if (activeSession && activeSession.project.id === id) {
      activeSession = null;
    }
    res.json({ success: true });
  });

  // Open/Close Questionnaire session for students
  app.post("/api/admin/open-session", adminAuth, (req, res) => {
    const { projectId } = req.body;
    const project = projects[projectId];
    if (!project) {
      return res.status(404).json({ error: "Projecte no trobat" });
    }

    // Generate random 8 letter code
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let code = "";
    for (let i = 0; i < 8; i++) {
      code += letters.charAt(Math.floor(Math.random() * letters.length));
    }

    activeSession = {
      code,
      project
    };

    res.json({ success: true, code, project });
  });

  app.post("/api/admin/close-session", adminAuth, (req, res) => {
    activeSession = null;
    res.json({ success: true });
  });

  app.post("/api/admin/reset-responses", adminAuth, (req, res) => {
    const { projectId } = req.body;
    const project = projects[projectId];
    if (project) {
      project.responses = {};
      if (activeSession && activeSession.project.id === projectId) {
        activeSession.project.responses = {};
      }
      res.json({ success: true, project });
    } else {
      res.status(404).json({ error: "Projecte no trobat" });
    }
  });

  app.get("/api/admin/active-session", adminAuth, (req, res) => {
    res.json(activeSession);
  });

  // 3. Student experience endpoints
  // Join session using the 8-letter code
  app.get("/api/student/session/:code", (req, res) => {
    const code = req.params.code.toUpperCase().trim();
    if (!activeSession || activeSession.code !== code) {
      return res.status(404).json({ error: "Codi de qüestionari no vàlid. Comproveu-lo amb el professor." });
    }

    // Hand back the student-safe structure
    res.json({
      code: activeSession.code,
      title: activeSession.project.title,
      students: activeSession.project.students,
      questions: activeSession.project.questions,
      allowSelfIdentification: activeSession.project.allowSelfIdentification
    });
  });

  // Sync / Auto-save student answers in real-time
  app.post("/api/student/sync", (req, res) => {
    const { code, studentSessionId, studentName, answers } = req.body;
    const cleanCode = code ? code.toUpperCase().trim() : "";

    if (!activeSession || activeSession.code !== cleanCode) {
      return res.status(400).json({ error: "Aquest qüestionari ja no està actiu o s'ha tancat." });
    }

    // Store in active session project
    const currentProject = activeSession.project;
    
    // Set response entry
    const timestamp = new Date().toISOString();
    const existingResponse = currentProject.responses[studentSessionId];

    const updatedResponse: StudentResponse = {
      studentSessionId,
      studentName: studentName || (existingResponse?.studentName) || "Anònim",
      answers: {
        ...(existingResponse?.answers || {}),
        ...answers
      },
      updatedAt: timestamp
    };

    currentProject.responses[studentSessionId] = updatedResponse;

    // Persist changes back into main projects map as well!
    if (projects[currentProject.id]) {
      projects[currentProject.id].responses[studentSessionId] = updatedResponse;
    }

    res.json({ success: true, response: updatedResponse });
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[CESC Server] Running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start CESC server:", err);
});
