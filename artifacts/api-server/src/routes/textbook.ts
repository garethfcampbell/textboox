import { Router, type IRouter, type Request, type Response } from "express";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { db, booksTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_SERVER_ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(API_SERVER_ROOT, "../..");
const PYTHON_SCRIPT = path.join(API_SERVER_ROOT, "src", "python", "runner.py");
const OUTPUT_DIR = path.join(API_SERVER_ROOT, "output");
const PYTHONLIBS = path.join(WORKSPACE_ROOT, ".pythonlibs", "lib", "python3.11", "site-packages");

function runPython(args: string[]): Promise<string> {
  const existingPythonPath = process.env.PYTHONPATH ?? "";
  const pythonPath = [PYTHONLIBS, existingPythonPath].filter(Boolean).join(":");

  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [PYTHON_SCRIPT, ...args], {
      env: { ...process.env, PYTHONPATH: pythonPath },
      cwd: API_SERVER_ROOT,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn python3: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Process exited with code ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// Save a completed job's files to the database (runs once per job)
async function saveJobToDb(jobId: string, statusFile: string, jobDir: string): Promise<void> {
  const status = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
  const title = status.title ?? jobId;
  const topic = status.topic ?? "";

  const files = fs.readdirSync(jobDir);
  const findFile = (ext: string) => files.find((f) => f.endsWith(`.${ext}`));

  const htmlFile = findFile("html");
  const pdfFile  = findFile("pdf");
  const epubFile = findFile("epub");

  const htmlData  = htmlFile  ? fs.readFileSync(path.join(jobDir, htmlFile),  "utf-8")           : null;
  const pdfData   = pdfFile   ? fs.readFileSync(path.join(jobDir, pdfFile)).toString("base64")   : null;
  const epubData  = epubFile  ? fs.readFileSync(path.join(jobDir, epubFile)).toString("base64")  : null;

  const [inserted] = await db
    .insert(booksTable)
    .values({ jobId, title, topic, htmlData, pdfData, epubData })
    .onConflictDoNothing()
    .returning({ id: booksTable.id });

  if (inserted) {
    status.dbId = inserted.id;
    fs.writeFileSync(statusFile, JSON.stringify(status));
  }
}

// ── Debug ─────────────────────────────────────────────────────────────────────

router.get("/textbook/debug", async (_req: Request, res: Response) => {
  const existingPythonPath = process.env.PYTHONPATH ?? "";
  const pythonPath = [PYTHONLIBS, existingPythonPath].filter(Boolean).join(":");

  const checkImports = () =>
    new Promise<string>((resolve, reject) => {
      const proc = spawn(
        "python3",
        ["-c", "import sys, google.genai, ebooklib, xhtml2pdf; print(sys.version)"],
        { env: { ...process.env, PYTHONPATH: pythonPath }, cwd: API_SERVER_ROOT },
      );
      let out = "";
      let err = "";
      proc.stdout.on("data", (d) => (out += d));
      proc.stderr.on("data", (d) => (err += d));
      proc.on("error", (e) => reject(e));
      proc.on("close", (code) =>
        code === 0 ? resolve(out.trim()) : reject(new Error(err.trim())),
      );
    });

  try {
    const pythonVersion = await checkImports();
    res.json({
      pythonVersion,
      pythonScript: PYTHON_SCRIPT,
      pythonScriptExists: fs.existsSync(PYTHON_SCRIPT),
      outputDir: OUTPUT_DIR,
      workspaceRoot: WORKSPACE_ROOT,
      pythonlibs: PYTHONLIBS,
      pythonlibsExists: fs.existsSync(PYTHONLIBS),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      error: message,
      pythonScript: PYTHON_SCRIPT,
      pythonScriptExists: fs.existsSync(PYTHON_SCRIPT),
      workspaceRoot: WORKSPACE_ROOT,
      pythonlibs: PYTHONLIBS,
      pythonlibsExists: fs.existsSync(PYTHONLIBS),
    });
  }
});

function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Generate idea ─────────────────────────────────────────────────────────────

router.post("/textbook/generate-idea", async (req: Request, res: Response) => {
  const { keyword } = req.body;

  if (!keyword) {
    res.status(400).json({ error: "keyword is required" });
    return;
  }

  try {
    const output = await runPython(["generate-idea", keyword]);
    const result = JSON.parse(output);

    if (result.error) {
      res.status(500).json({ error: result.error });
      return;
    }

    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "Failed to generate idea");
    res.status(500).json({ error: message });
  }
});

// ── Generate book ─────────────────────────────────────────────────────────────

router.post("/textbook/generate-book", async (req: Request, res: Response) => {
  const { topic, title, filename } = req.body;

  if (!topic || !title || !filename) {
    res.status(400).json({ error: "topic, title, and filename are required" });
    return;
  }

  const jobId = generateJobId();
  const jobDir = path.join(OUTPUT_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const statusFile = path.join(jobDir, "status.json");
  fs.writeFileSync(
    statusFile,
    JSON.stringify({
      jobId,
      topic,
      status: "pending",
      progress: "Queued...",
      currentChapter: "",
      totalChapters: 0,
      completedChapters: 0,
      availableFormats: [],
      error: "",
    }),
  );

  const safeFilename = filename.endsWith(".html") ? filename : `${filename}.html`;
  const logFile = path.join(jobDir, "python.log");

  const existingPythonPath = process.env.PYTHONPATH ?? "";
  const pythonPath = [PYTHONLIBS, existingPythonPath].filter(Boolean).join(":");

  const proc = spawn(
    "python3",
    [PYTHON_SCRIPT, "generate-book", jobId, topic, title, safeFilename, jobDir],
    {
      env: { ...process.env, PYTHONPATH: pythonPath },
      cwd: API_SERVER_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const logStream = fs.createWriteStream(logFile, { flags: "a" });
  proc.stdout?.pipe(logStream);
  proc.stderr?.pipe(logStream);

  proc.on("error", (err) => {
    const errorStatus = {
      jobId, topic, status: "failed", progress: "", currentChapter: "",
      totalChapters: 0, completedChapters: 0, availableFormats: [],
      error: `Failed to spawn python3: ${err.message}`,
    };
    fs.writeFileSync(statusFile, JSON.stringify(errorStatus));
    fs.appendFileSync(logFile, `\nSPAWN ERROR: ${err.message}\n`);
  });

  proc.on("close", (code) => {
    if (code !== 0) {
      try {
        const current = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
        if (current.status === "running" || current.status === "pending") {
          const errorStatus = {
            jobId, topic, status: "failed", progress: "", currentChapter: "",
            totalChapters: 0, completedChapters: 0, availableFormats: [],
            error: `Python exited with code ${code}. Check python.log for details.`,
          };
          fs.writeFileSync(statusFile, JSON.stringify(errorStatus));
        }
      } catch {
        // ignore
      }
    }
  });

  res.json({ jobId, message: "Book generation started" });
});

// ── Job status & log ───────────────────────────────────────────────────────────

router.get("/textbook/job/:jobId/log", async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const logFile = path.join(OUTPUT_DIR, jobId, "python.log");
  if (!fs.existsSync(logFile)) {
    res.status(404).json({ error: "Log not found" });
    return;
  }
  res.setHeader("Content-Type", "text/plain");
  res.send(fs.readFileSync(logFile, "utf-8"));
});

router.get("/textbook/job/:jobId", async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const jobDir = path.join(OUTPUT_DIR, jobId);
  const statusFile = path.join(jobDir, "status.json");

  if (!fs.existsSync(statusFile)) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(statusFile, "utf-8"));

    // Auto-save to DB the first time we see a completed job (non-blocking)
    if (data.status === "completed" && !data.dbId) {
      saveJobToDb(jobId, statusFile, jobDir).catch((err) => {
        console.error("Failed to save job to DB:", err);
      });
    }

    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to read job status" });
  }
});

// ── Download from disk (active job) ───────────────────────────────────────────

router.get(
  "/textbook/download/:jobId/:format",
  async (req: Request, res: Response) => {
    const { jobId, format } = req.params;

    if (!["epub", "pdf", "html"].includes(format)) {
      res.status(400).json({ error: "Invalid format" });
      return;
    }

    const jobDir = path.join(OUTPUT_DIR, jobId);
    const statusFile = path.join(jobDir, "status.json");

    if (!fs.existsSync(statusFile)) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const status = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
    const files = fs.readdirSync(jobDir);
    const matchingFile = files.find((f) => f.endsWith(`.${format}`));

    if (!matchingFile) {
      res.status(404).json({ error: `No ${format} file found` });
      return;
    }

    const filePath = path.join(jobDir, matchingFile);
    const contentTypes: Record<string, string> = {
      epub: "application/epub+zip",
      pdf: "application/pdf",
      html: "text/html",
    };

    const bookTitle = status.title
      ? status.title
      : path.basename(matchingFile, `.${format}`);
    res.setHeader("Content-Type", contentTypes[format]);
    res.setHeader("Content-Disposition", `attachment; filename="${bookTitle}.${format}"`);
    res.sendFile(filePath);
  },
);

// ── Public library (approved books) ───────────────────────────────────────────

router.get("/textbook/library", async (_req: Request, res: Response) => {
  try {
    const books = await db
      .select({
        id: booksTable.id,
        title: booksTable.title,
        topic: booksTable.topic,
        createdAt: booksTable.createdAt,
      })
      .from(booksTable)
      .where(eq(booksTable.approved, true))
      .orderBy(booksTable.createdAt);

    res.json(books);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch library" });
  }
});

// Download from DB (library books)
router.get("/textbook/library/:id/download/:format", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { format } = req.params;

  if (!["epub", "pdf", "html"].includes(format)) {
    res.status(400).json({ error: "Invalid format" });
    return;
  }

  try {
    const [book] = await db
      .select()
      .from(booksTable)
      .where(eq(booksTable.id, id));

    if (!book || !book.approved) {
      res.status(404).json({ error: "Book not found" });
      return;
    }

    const contentTypes: Record<string, string> = {
      epub: "application/epub+zip",
      pdf: "application/pdf",
      html: "text/html",
    };

    res.setHeader("Content-Type", contentTypes[format]);
    res.setHeader("Content-Disposition", `attachment; filename="${book.title}.${format}"`);

    if (format === "html") {
      res.send(book.htmlData ?? "");
    } else {
      const field = format === "pdf" ? book.pdfData : book.epubData;
      if (!field) {
        res.status(404).json({ error: `${format} not available` });
        return;
      }
      res.send(Buffer.from(field, "base64"));
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to serve file" });
  }
});

// ── Admin endpoints ────────────────────────────────────────────────────────────

// List all books (for admin panel)
router.get("/textbook/admin/books", async (_req: Request, res: Response) => {
  try {
    const books = await db
      .select({
        id: booksTable.id,
        jobId: booksTable.jobId,
        title: booksTable.title,
        topic: booksTable.topic,
        approved: booksTable.approved,
        createdAt: booksTable.createdAt,
      })
      .from(booksTable)
      .orderBy(booksTable.createdAt);

    res.json(books);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch books" });
  }
});

// Toggle approval for a book
router.patch("/textbook/admin/books/:id/approve", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { approved } = req.body as { approved: boolean };

  if (typeof approved !== "boolean") {
    res.status(400).json({ error: "approved (boolean) is required" });
    return;
  }

  try {
    const [updated] = await db
      .update(booksTable)
      .set({ approved })
      .where(eq(booksTable.id, id))
      .returning({ id: booksTable.id, approved: booksTable.approved });

    if (!updated) {
      res.status(404).json({ error: "Book not found" });
      return;
    }

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update approval" });
  }
});

export default router;
