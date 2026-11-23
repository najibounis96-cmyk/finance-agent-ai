import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./App.css";

type Model = { name: string; size: number };
type MessageAttachment = { id: string; name: string; mimeType: string; size: number; kind: "text" | "image"; previewUrl?: string };
type Message = { id: string; role: "user" | "assistant"; content: string; attachments?: MessageAttachment[] };
type PendingAttachment = MessageAttachment & { content: string };
type Agent = "general" | "finance" | "markets" | "portfolio";
type Quote = {
  symbol: string;
  price: number;
  previousClose: number | null;
  currency: string | null;
  exchange: string | null;
  marketState: string | null;
  marketTime: string | null;
  retrievedAt: string;
  source: string;
};
type ResearchSource = { title: string; publisher: string; url: string; publishedAt: string; snippet: string };
type LibraryEntry = {
  id: string;
  title: string;
  publisher: string;
  publishedAt: string;
  url: string;
  snippet: string;
  category: string;
  retrievedAt: string;
};
type LibraryState = {
  entries: LibraryEntry[];
  totalEntries: number;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  syncWarnings: string[];
  autoRefreshHours: number;
};

const AGENTS: Record<Agent, { title: string; subtitle: string; icon: string; prompts: string[] }> = {
  general: {
    title: "Assistant universel",
    subtitle: "Réponses générales, analyse, programmation et sujets financiers",
    icon: "✦",
    prompts: [
      "Explique-moi un sujet complexe avec des exemples concrets.",
      "Analyse une entreprise, ses états financiers et ses principaux risques.",
      "Aide-moi à résoudre un problème de programmation ou à comparer des options.",
    ],
  },
  finance: {
    title: "Analyste financier",
    subtitle: "États financiers, stratégie, trésorerie et décisions d’entreprise",
    icon: "◈",
    prompts: [
      "Analyse les principaux risques à examiner avant d'investir dans une PME.",
      "Explique comment relier EBITDA, BFR et génération de trésorerie.",
      "Quelles questions poser avant de financer une entreprise en croissance ?",
    ],
  },
  markets: {
    title: "Analyste des marchés",
    subtitle: "Valorisation, actions, taux, sources et scénarios",
    icon: "⌁",
    prompts: [
      "Compare les limites d'une valorisation DCF et d'une valorisation par multiples.",
      "Comment analyser la sensibilité d'une obligation à une hausse des taux ?",
      "Propose une grille de diligence pour analyser une action cotée.",
    ],
  },
  portfolio: {
    title: "Analyste portefeuille",
    subtitle: "Diversification, risque, budget et finances personnelles",
    icon: "◉",
    prompts: [
      "Comment mesurer les concentrations et les risques de mon portefeuille ?",
      "Aide-moi à structurer un budget et mon fonds d’urgence.",
      "Quels scénarios de baisse devrais-je tester pour mon portefeuille ?",
    ],
  },
};

const MAX_ATTACHMENTS = 10;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_CHARS = 24_000;
const MAX_PDF_PAGES = 20;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const TEXT_FILE_TYPES: Record<string, string> = {
  txt: "text/plain", log: "text/plain", md: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values",
  json: "application/json", xml: "application/xml", html: "text/html", htm: "text/html", css: "text/css",
  js: "text/javascript", jsx: "text/javascript", ts: "application/typescript", tsx: "application/typescript",
  py: "text/x-python", sql: "text/plain", yaml: "text/plain", yml: "text/plain", toml: "text/plain",
};
const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const formatSize = (bytes: number) => bytes >= 1024 ** 3
  ? `${(bytes / 1024 ** 3).toFixed(1)} Go`
  : `${Math.max(1, Math.round(bytes / 1024 ** 2))} Mo`;
const cleanFileProposal = (value: string) => value
  .trim()
  .replace(/^```[a-zA-Z0-9_-]*\s*\n/, "")
  .replace(/\n```$/, "")
  .trim();

async function extractPdfText(file: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  try {
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PDF_PAGES) throw new Error(`Le PDF dépasse la limite de ${MAX_PDF_PAGES} pages.`);
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const text = await page.getTextContent();
      pages.push(text.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    return pages.join("\n").trim();
  } finally {
    await loadingTask.destroy();
  }
}

function readImageAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Lecture de l’image impossible."));
    reader.onerror = () => reject(new Error("Lecture de l’image impossible."));
    reader.readAsDataURL(file);
  });
}

async function readError(response: Response) {
  try {
    const body = await response.json() as { error?: string };
    return body.error ?? `Erreur HTTP ${response.status}`;
  } catch {
    return `Erreur HTTP ${response.status}`;
  }
}

function App() {
  const [view, setView] = useState<"chat" | "build" | "library">("chat");
  const [agent, setAgent] = useState<Agent>("general");
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [connected, setConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Connexion au moteur local…");
  const [chatSessions, setChatSessions] = useState<Record<Agent, Message[]>>({ general: [], finance: [], markets: [], portfolio: [] });
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [successNotice, setSuccessNotice] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([]);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [libraryUpdatedAt, setLibraryUpdatedAt] = useState<string | null>(null);
  const [libraryNextUpdateAt, setLibraryNextUpdateAt] = useState<string | null>(null);
  const [libraryWarnings, setLibraryWarnings] = useState<string[]>([]);
  const [librarySyncing, setLibrarySyncing] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryError, setLibraryError] = useState("");
  const [workspace, setWorkspace] = useState("demo-project");
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [filePath, setFilePath] = useState("src/hello.ts");
  const [instruction, setInstruction] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [draft, setDraft] = useState("");
  const [buildBusy, setBuildBusy] = useState(false);
  const [buildStatus, setBuildStatus] = useState("");
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProject, setNewProject] = useState("");
  const [quoteSymbol, setQuoteSymbol] = useState("AAPL");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [researchQuery, setResearchQuery] = useState("");
  const [researchSources, setResearchSources] = useState<ResearchSource[]>([]);
  const [researchBusy, setResearchBusy] = useState(false);
  const [includeEvidence, setIncludeEvidence] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const imagesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const libraryDebounceRef = useRef<number | null>(null);
  const messages = chatSessions[agent];
  const agentColor = agent === "general" ? "violet" : agent === "finance" ? "violet" : agent === "markets" ? "teal" : "gold";
  const updateMessages = (update: (current: Message[]) => Message[]) => {
    setChatSessions((current) => ({ ...current, [agent]: update(current[agent]) }));
  };

  const refreshStatus = useCallback(async () => {
    try {
      const [healthResponse, workspaceResponse] = await Promise.all([
        fetch("/api/health", { cache: "no-store" }),
        fetch("/api/workspaces", { cache: "no-store" }),
      ]);
      if (!healthResponse.ok) throw new Error(await readError(healthResponse));
      const health = await healthResponse.json() as {
        ollama: boolean;
        models: Model[];
        selectedModel: string | null;
        error?: string;
      };
      setModels(health.models);
      setConnected(health.ollama);
      setModel((previous) => health.models.some((candidate) => candidate.name === previous)
        ? previous
        : health.selectedModel ?? "");
      setStatusMessage(health.ollama
        ? `${health.models.length} modèle${health.models.length > 1 ? "s" : ""} local${health.models.length > 1 ? "s" : ""} disponible${health.models.length > 1 ? "s" : ""}`
        : "Ollama ne répond pas. Démarrez Ollama et installez un modèle.");
      if (workspaceResponse.ok) {
        const payload = await workspaceResponse.json() as { workspaces: string[] };
        setWorkspaces(payload.workspaces);
        if (payload.workspaces.length && !payload.workspaces.includes(workspace)) setWorkspace(payload.workspaces[0]);
      }
    } catch (reason) {
      setConnected(false);
      setStatusMessage(reason instanceof Error ? reason.message : "Serveur local indisponible.");
    }
  }, [workspace]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void refreshStatus();
    });
    return () => { active = false; };
  }, [refreshStatus]);

  const loadLibrary = useCallback(async (query = "") => {
    try {
      const response = await fetch(`/api/library${query.trim() ? `?${new URLSearchParams({ q: query.trim() })}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      const library = await response.json() as LibraryState;
      setLibraryError("");
      setLibraryEntries(library.entries);
      setLibraryTotal(library.totalEntries);
      setLibraryUpdatedAt(library.lastSyncAt);
      setLibraryNextUpdateAt(library.nextSyncAt);
      setLibraryWarnings(library.syncWarnings);
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : "Lecture de la bibliothèque impossible.");
    }
  }, []);

  useEffect(() => {
    if (libraryDebounceRef.current !== null) window.clearTimeout(libraryDebounceRef.current);
    libraryDebounceRef.current = window.setTimeout(() => { void loadLibrary(libraryQuery); }, 250);
    return () => {
      if (libraryDebounceRef.current !== null) window.clearTimeout(libraryDebounceRef.current);
    };
  }, [libraryQuery, loadLibrary]);

  useEffect(() => {
    if (view !== "library") return;
    const timer = window.setInterval(() => { void loadLibrary(libraryQuery); }, 60_000);
    return () => window.clearInterval(timer);
  }, [view, libraryQuery, loadLibrary]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    if (!quote?.symbol) return;
    let active = true;
    const timer = window.setInterval(() => {
      void fetch(`/api/quote?${new URLSearchParams({ symbol: quote.symbol })}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(await readError(response));
          return await response.json() as Quote;
        })
        .then((latest) => { if (active) setQuote(latest); })
        .catch((reason: unknown) => {
          if (active) setError(reason instanceof Error ? `Actualisation du cours : ${reason.message}` : "Actualisation du cours impossible.");
        });
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [quote?.symbol]);

  const consumeStream = async (
    response: Response,
    append: (value: string) => void,
  ) => {
    if (!response.ok || !response.body) throw new Error(await readError(response));
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line) as { message?: { content?: string }; error?: string };
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.message?.content) append(chunk.message.content);
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const chunk = JSON.parse(buffer) as { message?: { content?: string }; error?: string };
      if (chunk.error) throw new Error(chunk.error);
      if (chunk.message?.content) append(chunk.message.content);
    }
  };

  const addAttachments = async (files: FileList | null) => {
    if (!files?.length) return;
    setAttachmentMenuOpen(false);
    setAttachmentBusy(true);
    setError("");
    const added: PendingAttachment[] = [];
    const failures: string[] = [];
    let textChars = pendingAttachments.reduce((total, item) => total + (item.kind === "text" ? item.content.length : 0), 0);
    let imageBytes = pendingAttachments.reduce((total, item) => total + (item.kind === "image" ? item.size : 0), 0);
    let imageCount = pendingAttachments.filter((item) => item.kind === "image").length;
    try {
      for (const file of Array.from(files)) {
        const name = (file.webkitRelativePath || file.name).replace(/[\r\n]/g, " ").slice(0, 240);
        const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
        const currentCount = pendingAttachments.length + added.length;
        if (currentCount >= MAX_ATTACHMENTS) {
          failures.push(`Maximum ${MAX_ATTACHMENTS} pièces jointes par message.`);
          break;
        }
        try {
          if (IMAGE_TYPES[extension] && (file.type === IMAGE_TYPES[extension] || !file.type)) {
            if (file.size === 0 || file.size > MAX_IMAGE_BYTES) throw new Error("Image vide ou supérieure à 4 Mo.");
            if (imageCount >= 5 || imageBytes + file.size > MAX_TOTAL_IMAGE_BYTES) throw new Error("Limite de 5 images et 8 Mo d’images par message.");
            const dataUrl = await readImageAsDataUrl(file);
            const content = dataUrl.split(",")[1];
            if (!content) throw new Error("Encodage de l’image impossible.");
            added.push({ id: newId(), name, mimeType: IMAGE_TYPES[extension], size: file.size, kind: "image", content, previewUrl: dataUrl });
            imageBytes += file.size;
            imageCount += 1;
            continue;
          }
          if (extension === "pdf") {
            if (file.size === 0 || file.size > MAX_PDF_BYTES) throw new Error("PDF vide ou supérieur à 10 Mo.");
            const content = await extractPdfText(file);
            if (!content) throw new Error("Aucun texte extractible (PDF probablement scanné).");
            if (textChars + content.length > MAX_ATTACHMENT_TEXT_CHARS) throw new Error("Le texte joint dépasse la limite de 24 000 caractères.");
            added.push({ id: newId(), name, mimeType: "application/pdf", size: file.size, kind: "text", content });
            textChars += content.length;
            continue;
          }
          const mimeType = TEXT_FILE_TYPES[extension];
          if (!mimeType) throw new Error("Format non pris en charge. Ajoutez un document texte, un PDF ou une image PNG/JPEG/WebP.");
          if (file.size === 0 || file.size > 512 * 1024) throw new Error("Fichier texte vide ou supérieur à 512 Ko.");
          const content = await file.text();
          if (textChars + content.length > MAX_ATTACHMENT_TEXT_CHARS) throw new Error("Le texte joint dépasse la limite de 24 000 caractères.");
          added.push({ id: newId(), name, mimeType, size: file.size, kind: "text", content });
          textChars += content.length;
        } catch (reason) {
          failures.push(`${name} : ${reason instanceof Error ? reason.message : "lecture impossible."}`);
        }
      }
      if (added.length) setPendingAttachments((current) => [...current, ...added]);
      if (failures.length) setError(failures.join("\n"));
    } finally {
      setAttachmentBusy(false);
    }
  };

  const onFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    void addAttachments(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  const removeAttachment = (id: string) => {
    setPendingAttachments((current) => current.filter((item) => item.id !== id));
  };

  const sendMessage = async (event?: FormEvent<HTMLFormElement>, prompt?: string) => {
    event?.preventDefault();
    const content = (prompt ?? input).trim();
    if ((!content && !pendingAttachments.length) || sending || attachmentBusy || !connected || !model) return;
    const submittedAttachments = pendingAttachments;
    const messageAttachments: MessageAttachment[] = submittedAttachments.map(({ id, name, mimeType, size, kind, previewUrl }) => ({
      id, name, mimeType, size, kind, ...(previewUrl ? { previewUrl } : {}),
    }));
    const userMessage: Message = {
      id: newId(),
      role: "user",
      content: content || "Veuillez analyser les pièces jointes.",
      ...(messageAttachments.length ? { attachments: messageAttachments } : {}),
    };
    const assistantId = newId();
    const next = [...messages, userMessage];
    updateMessages(() => [...next, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setSending(true);
    setError("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          agent,
          model,
          messages: next.slice(-12).map(({ role, content: text }) => ({ role, content: text })),
          ...(submittedAttachments.length ? {
            attachments: submittedAttachments.map(({ name, mimeType, size, kind, content: attachmentContent }) => ({
              name, mimeType, size, kind, content: attachmentContent,
            })),
          } : {}),
          ...(includeEvidence && (quote || researchSources.length) ? {
            evidence: { quote, sources: researchSources },
          } : {}),
        }),
      });
      await consumeStream(response, (text) => {
        updateMessages((current) => current.map((item) => item.id === assistantId
          ? { ...item, content: item.content + text }
          : item));
      });
      setPendingAttachments([]);
    } catch (reason) {
      const notice = reason instanceof DOMException && reason.name === "AbortError"
        ? "Génération arrêtée."
        : reason instanceof Error ? reason.message : "La génération a échoué.";
      setError(notice);
      updateMessages((current) => current.filter((item) => item.id !== assistantId || item.content));
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  };

  const loadQuote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const symbol = quoteSymbol.trim();
    if (!symbol || researchBusy) return;
    setResearchBusy(true);
    setQuote(null);
    setError("");
    try {
      const response = await fetch(`/api/quote?${new URLSearchParams({ symbol })}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      setQuote(await response.json() as Quote);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Récupération du cours impossible.");
    } finally {
      setResearchBusy(false);
    }
  };

  const searchFinancialSources = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = researchQuery.trim();
    if (query.length < 2 || researchBusy) return;
    setResearchBusy(true);
    setResearchSources([]);
    setError("");
    try {
      const response = await fetch(`/api/research?${new URLSearchParams({ q: query })}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      const result = await response.json() as { sources: ResearchSource[] };
      setResearchSources(result.sources);
      if (!result.sources.length) setError("Aucune source trouvée pour cette recherche.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Recherche de sources impossible.");
    } finally {
      setResearchBusy(false);
    }
  };

  const syncLibrary = async () => {
    setLibrarySyncing(true);
    setLibraryError("");
    try {
      const response = await fetch("/api/library/sync", { method: "POST" });
      if (!response.ok) throw new Error(await readError(response));
      const result = await response.json() as { syncWarnings?: string[] };
      setLibraryWarnings(result.syncWarnings ?? []);
      await loadLibrary(libraryQuery);
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : "Actualisation de la bibliothèque impossible.");
    } finally {
      setLibrarySyncing(false);
    }
  };

  const saveLibraryItem = async (item: {
    title: string;
    kind: "document" | "source";
    content?: string;
    mimeType?: string;
    url?: string;
    publisher?: string;
    publishedAt?: string;
    snippet?: string;
    category?: string;
  }) => {
    setLibraryError("");
    try {
      const response = await fetch("/api/library/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      if (!response.ok) throw new Error(await readError(response));
      await loadLibrary(libraryQuery);
      setSuccessNotice(`« ${item.title} » ajouté à la bibliothèque universelle locale.`);
      setError("");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Ajout à la bibliothèque impossible.";
      setLibraryError(message);
      setError(message);
    }
  };

  const readFile = async () => {
    const query = new URLSearchParams({ workspace, path: filePath });
    const response = await fetch(`/api/workspace/read?${query}`);
    if (!response.ok) throw new Error(await readError(response));
    const payload = await response.json() as { content: string; exists: boolean };
    setFileContent(payload.content);
    setDraft("");
    setBuildStatus(payload.exists ? "Fichier chargé dans l’espace de travail." : "Nouveau fichier : aucune écriture avant votre validation.");
  };

  const generateBuild = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!instruction.trim() || buildBusy || !connected || !model) return;
    setBuildBusy(true);
    setError("");
    setDraft("");
    setBuildStatus("L’agent prépare une proposition…");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ workspace, path: filePath, model, instruction, currentContent: fileContent }),
      });
      let proposal = "";
      await consumeStream(response, (text) => { proposal += text; setDraft(proposal); });
      setDraft(cleanFileProposal(proposal));
      setBuildStatus("Proposition prête. Elle n’est pas appliquée au projet.");
    } catch (reason) {
      setError(reason instanceof DOMException && reason.name === "AbortError"
        ? "Génération arrêtée."
        : reason instanceof Error ? reason.message : "La génération a échoué.");
      setBuildStatus("");
    } finally {
      abortRef.current = null;
      setBuildBusy(false);
    }
  };

  const applyDraft = async () => {
    if (!draft || buildBusy) return;
    setBuildBusy(true);
    setError("");
    try {
      const response = await fetch("/api/workspace/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace, path: filePath, content: draft }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setFileContent(draft);
      setDraft("");
      setBuildStatus("Fichier enregistré dans le bac à sable local du projet.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d’enregistrer le fichier.");
    } finally {
      setBuildBusy(false);
    }
  };

  const createWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const slug = newProject.trim();
    if (!slug) return;
    setError("");
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: slug }),
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      const payload = await response.json() as { workspaces: string[]; name: string };
      setWorkspaces(payload.workspaces);
      setWorkspace(payload.name);
      setNewProject("");
      setShowNewProject(false);
      setFilePath("src/hello.ts");
      setFileContent("");
      setDraft("");
      setBuildStatus("Projet créé. Les changements restent dans son bac à sable.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de créer le projet.");
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Aster, accueil">
          <span className="brand-mark">A</span>
          <span><strong>aster</strong><small>INTELLIGENCE LAB</small></span>
        </a>
        <div className="sidebar-label">ESPACE DE TRAVAIL</div>
        <button className={`nav-item ${view === "chat" ? "active" : ""}`} onClick={() => setView("chat")}>
          <span className="nav-symbol">◌</span><span>Chat universel</span><span className="nav-count">4</span>
        </button>
        <button className={`nav-item ${view === "build" ? "active" : ""}`} onClick={() => setView("build")}>
          <span className="nav-symbol">⌘</span><span>Agent de build</span><span className="new-badge">BÊTA</span>
        </button>
        <button className={`nav-item ${view === "library" ? "active" : ""}`} onClick={() => { setView("library"); void loadLibrary(); }}>
          <span className="nav-symbol">▤</span><span>Bibliothèque</span><span className="nav-count">{libraryTotal}</span>
        </button>
        <div className="sidebar-label second-label">ASSISTANTS</div>
        <button className={`agent-nav ${view === "chat" && agent === "general" ? "selected" : ""}`} onClick={() => { setView("chat"); setAgent("general"); }}>
          <span className="agent-dot violet">✦</span><span><strong>Universel</strong><small>Toutes demandes</small></span>
        </button>
        <button className={`agent-nav ${view === "chat" && agent === "finance" ? "selected" : ""}`} onClick={() => { setView("chat"); setAgent("finance"); }}>
          <span className="agent-dot violet">◈</span><span><strong>Entreprise</strong><small>Analyse financière</small></span>
        </button>
        <button className={`agent-nav ${view === "chat" && agent === "markets" ? "selected" : ""}`} onClick={() => { setView("chat"); setAgent("markets"); }}>
          <span className="agent-dot teal">⌁</span><span><strong>Marchés</strong><small>Valorisation & risque</small></span>
        </button>
        <button className={`agent-nav ${view === "chat" && agent === "portfolio" ? "selected" : ""}`} onClick={() => { setView("chat"); setAgent("portfolio"); }}>
          <span className="agent-dot gold">◉</span><span><strong>Portefeuille</strong><small>Finances & risques</small></span>
        </button>
        <div className="sidebar-spacer" />
        <div className="local-card">
          <span className={`status-pip ${connected ? "online" : ""}`} />
          <div><strong>{connected ? "IA locale active" : "IA hors ligne"}</strong><small>{connected ? "Chat local · recherches externes" : "Vérifiez Ollama"}</small></div>
          <button className="refresh-button" title="Actualiser l’état" onClick={() => void refreshStatus()}>↻</button>
        </div>
        <div className="sidebar-footer">Aster Intelligence Lab <span>v0.1 · prototype</span></div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Aster</span><span className="crumb-slash">/</span><strong>{view === "chat" ? AGENTS[agent].title : view === "build" ? "Agent de build" : "Bibliothèque universelle"}</strong></div>
          <div className="topbar-right">
            <label className="model-select-label" htmlFor="model-select">MODÈLE</label>
            <select id="model-select" value={model} onChange={(event) => setModel(event.target.value)} disabled={!models.length}>
              {models.length === 0 && <option value="">Aucun modèle détecté</option>}
              {models.map((item) => <option value={item.name} key={item.name}>{item.name} · {formatSize(item.size)}</option>)}
            </select>
            <span className={`connection ${connected ? "ok" : ""}`}><i />{connected ? "LOCAL" : "DÉCONNECTÉ"}</span>
          </div>
        </header>

        {view === "chat" ? (
          <section className="chat-view">
            <div className="market-tools">
              <div className="market-tools-heading"><div><strong>Données & sources</strong><small>Recherchez un dernier cours et des articles financiers à citer dans l’analyse.</small></div><label className="evidence-toggle"><input type="checkbox" checked={includeEvidence} onChange={(event) => setIncludeEvidence(event.target.checked)} /> Inclure dans l’analyse</label></div>
              <div className="market-tools-grid">
                <form className="market-tool-form" onSubmit={(event) => void loadQuote(event)}>
                  <label htmlFor="quote-symbol">COURS DE MARCHÉ</label>
                  <div className="market-tool-input"><input id="quote-symbol" value={quoteSymbol} onChange={(event) => setQuoteSymbol(event.target.value)} placeholder="Symbole, ex. AAPL ou ^GSPC" maxLength={24} /><button className="outline-button" type="submit" disabled={!quoteSymbol.trim() || researchBusy}>{researchBusy ? "…" : "Cours"}</button></div>
                  {quote && <div className="quote-result"><div><strong>{quote.symbol}</strong><span>{quote.exchange ?? "Marché"}</span></div><b>{quote.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} {quote.currency ?? ""}</b><small>Dernier cours fourni{quote.marketTime ? ` · marché ${new Date(quote.marketTime).toLocaleString()}` : ""}<br />Reçu le {new Date(quote.retrievedAt).toLocaleString()} · actualisation auto toutes les 60 s · {quote.source} · délai éventuel</small></div>}
                </form>
                <form className="market-tool-form" onSubmit={(event) => void searchFinancialSources(event)}>
                  <label htmlFor="source-query">RECHERCHE DE SOURCES</label>
                  <div className="market-tool-input"><input id="source-query" value={researchQuery} onChange={(event) => setResearchQuery(event.target.value)} placeholder="Entreprise, sujet, période…" maxLength={180} /><button className="outline-button" type="submit" disabled={researchQuery.trim().length < 2 || researchBusy}>{researchBusy ? "…" : "Rechercher"}</button></div>
                  {researchSources.length > 0 && <div className="source-results">{researchSources.map((source, index) => <article className="source-result" key={`${source.url}-${index}`}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><small>{source.publisher} · {source.publishedAt}</small>{source.snippet && <p>{source.snippet}</p>}<button className="save-source-button" type="button" onClick={() => void saveLibraryItem({ kind: "source", title: source.title, url: source.url, publisher: source.publisher, publishedAt: source.publishedAt, snippet: source.snippet, category: "Recherche personnalisée" })}>＋ Bibliothèque</button></article>)}</div>}
                </form>
              </div>
              <small className="market-disclaimer">Cotations fournies par Yahoo Finance, non contractuelles et susceptibles d’être différées. Recherche via Google Actualités ; vérifiez l’article original, sa date et son éditeur. Ni flux boursier garanti en temps réel ni conseil d’investissement.</small>
            </div>
            {messages.length === 0 ? (
              <div className="welcome">
                <div className="eyebrow"><span className="eyebrow-star">✳</span> ASTER INTELLIGENCE</div>
                <h1>La connaissance, <em>en profondeur.</em></h1>
                <p className="welcome-copy">Un espace de travail pour explorer vos questions, challenger vos hypothèses et construire des analyses argumentées dans tous les domaines.</p>
                <div className="agent-heading"><span className={`agent-dot large ${agentColor}`}>{AGENTS[agent].icon}</span><div><strong>{AGENTS[agent].title}</strong><small>{AGENTS[agent].subtitle}</small></div></div>
                <div className="prompt-grid">
                  {AGENTS[agent].prompts.map((prompt) => <button key={prompt} onClick={() => void sendMessage(undefined, prompt)} className="prompt-card"><span>↗</span>{prompt}</button>)}
                </div>
              </div>
            ) : (
              <div className="conversation">
              <div className="conversation-heading"><div className={`agent-dot large ${agentColor}`}>{AGENTS[agent].icon}</div><div><h1>{AGENTS[agent].title}</h1><p>{AGENTS[agent].subtitle}</p></div><button className="text-button" onClick={() => updateMessages(() => [])}>Nouvelle analyse</button></div>
                {messages.map((item) => <article className={`message ${item.role}`} key={item.id}><div className="message-label">{item.role === "user" ? "VOUS" : "ASTER · " + AGENTS[agent].title.toUpperCase()}</div>{item.attachments && <div className="message-attachments">{item.attachments.map((attachment) => <div className="message-attachment" key={attachment.id}>{attachment.previewUrl ? <img src={attachment.previewUrl} alt={attachment.name} /> : <span className="file-attachment-icon">▤</span>}<span><strong>{attachment.name}</strong><small>{attachment.kind === "image" ? "Image" : attachment.mimeType === "application/pdf" ? "PDF · texte extrait" : "Document · texte inclus"}</small></span></div>)}</div>}<div className="message-content">{item.content || (sending ? <span className="thinking">Analyse en cours<span>…</span></span> : "")}</div></article>)}
                <div ref={bottomRef} />
              </div>
            )}
            {error && <div className="error-banner" role="alert">{error}</div>}
            {successNotice && <div className="success-banner" role="status">{successNotice}</div>}
            {!connected && <div className="setup-notice"><strong>Connecter un modèle local</strong><span>Installez Ollama, puis exécutez <code>ollama pull hf.co/QuantFactory/finance-Llama3-8B-GGUF:Q4_K_M</code> (modèle spécialisé) ou <code>ollama pull qwen2.5:3b</code> (plus léger).</span></div>}
            {connected && <div className="data-notice"><span>◉</span> Vérifiez chaque chiffre, source et hypothèse · Aucune promesse de rendement</div>}
            <form className="composer" onSubmit={(event) => void sendMessage(event)}>
              <div className="composer-input-row">
                <div className="attachment-menu-wrap">
                  <button className="attach-button" type="button" aria-label="Ajouter une pièce jointe" aria-haspopup="menu" aria-expanded={attachmentMenuOpen} disabled={sending || attachmentBusy} onClick={() => setAttachmentMenuOpen((open) => !open)}>＋</button>
                  {attachmentMenuOpen && <div className="attachment-menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => filesInputRef.current?.click()}>▤ <span>Fichiers</span></button>
                    <button type="button" role="menuitem" onClick={() => imagesInputRef.current?.click()}>▧ <span>Images</span></button>
                    <button type="button" role="menuitem" onClick={() => folderInputRef.current?.click()}>▣ <span>Dossier</span></button>
                  </div>}
                  <input ref={filesInputRef} className="visually-hidden" type="file" multiple accept=".pdf,.txt,.log,.md,.csv,.tsv,.json,.xml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.sql,.yaml,.yml,.toml,.jpg,.jpeg,.png,.webp" onChange={onFilesSelected} />
                  <input ref={imagesInputRef} className="visually-hidden" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={onFilesSelected} />
                  <input ref={(element) => { folderInputRef.current = element; if (element) element.setAttribute("webkitdirectory", ""); }} className="visually-hidden" type="file" multiple accept=".pdf,.txt,.log,.md,.csv,.tsv,.json,.xml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.sql,.yaml,.yml,.toml,.jpg,.jpeg,.png,.webp" onChange={onFilesSelected} />
                </div>
                <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder={connected ? "Posez une question financière…" : statusMessage} disabled={!connected || sending} rows={2} maxLength={8000} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
              </div>
              {pendingAttachments.length > 0 && <div className="pending-attachments">{pendingAttachments.map((attachment) => <div className="pending-attachment" key={attachment.id}>{attachment.previewUrl ? <img src={attachment.previewUrl} alt="" /> : <span className="file-attachment-icon">▤</span>}<span><strong>{attachment.name}</strong><small>{attachment.kind === "image" ? "Image" : attachment.mimeType === "application/pdf" ? "PDF · texte extrait" : "Texte inclus"}</small>{attachment.kind === "text" && <button className="save-attachment-button" type="button" onClick={() => void saveLibraryItem({ kind: "document", title: attachment.name, content: attachment.content, mimeType: attachment.mimeType })}>Ajouter à la bibliothèque</button>}</span><button type="button" aria-label={`Retirer ${attachment.name}`} onClick={() => removeAttachment(attachment.id)} disabled={sending}>×</button></div>)}</div>}
              <div className="composer-bottom"><span>{attachmentBusy ? "Lecture des pièces jointes…" : pendingAttachments.length ? `${pendingAttachments.length} pièce${pendingAttachments.length > 1 ? "s" : ""} jointe${pendingAttachments.length > 1 ? "s" : ""} · images : modèle compatible vision requis` : "Entrée pour envoyer · Maj+Entrée pour aller à la ligne"}</span>{sending ? <button className="send-button stop-button" type="button" onClick={() => abortRef.current?.abort()}>■ Arrêter</button> : <button className="send-button" type="submit" disabled={!connected || attachmentBusy || (!input.trim() && !pendingAttachments.length)}>Envoyer <span>↗</span></button>}</div>
            </form>
          </section>
        ) : view === "build" ? (
          <section className="build-view">
            <div className="build-intro"><div className="eyebrow"><span className="eyebrow-star">✳</span> AGENT DE BUILD · BÊTA</div><h1>Construisez avec <em>un agent.</em></h1><p>Décrivez un changement. L’agent prépare une proposition de fichier à examiner ; il ne l’écrit qu’après votre validation.</p></div>
            <div className="safety-strip"><span>◇</span><div><strong>Bac à sable local</strong><small>Pas de terminal, d’accès réseau ou de modification automatique. Les fichiers restent dans le dossier workspaces de l’application.</small></div></div>
            <div className="build-controls">
              <label>PROJET<select value={workspace} onChange={(event) => { setWorkspace(event.target.value); setFileContent(""); setDraft(""); }}>{workspaces.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
              <button className="outline-button" type="button" onClick={() => setShowNewProject((value) => !value)}>＋ Nouveau projet</button>
              <label className="file-field">FICHIER À MODIFIER<input value={filePath} onChange={(event) => setFilePath(event.target.value)} placeholder="src/hello.ts" /></label>
              <button className="outline-button load-button" type="button" onClick={() => void readFile().catch((reason) => setError(reason instanceof Error ? reason.message : "Lecture impossible."))}>Charger</button>
            </div>
            {showNewProject && <form className="new-project-form" onSubmit={(event) => void createWorkspace(event)}><input value={newProject} onChange={(event) => setNewProject(event.target.value)} placeholder="nom-du-projet" maxLength={48} /><button className="send-button" type="submit" disabled={!newProject.trim()}>Créer le bac à sable</button></form>}
            <form className="instruction-form" onSubmit={(event) => void generateBuild(event)}><label htmlFor="build-instruction">VOTRE DEMANDE</label><textarea id="build-instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Ex. Crée un module TypeScript qui calcule le taux de marge et vérifie les divisions par zéro." maxLength={3000} rows={3} /><div className="composer-bottom"><span>Une proposition à la fois · contrôle humain requis</span>{buildBusy ? <button className="send-button stop-button" type="button" onClick={() => abortRef.current?.abort()}>■ Arrêter</button> : <button className="send-button" type="submit" disabled={!connected || !instruction.trim()}>Générer une proposition <span>↗</span></button>}</div></form>
            {error && <div className="error-banner" role="alert">{error}</div>}
            {buildStatus && <div className="build-status">{buildStatus}</div>}
            <div className="editor-grid"><div className="editor-panel"><div className="editor-head"><span>FICHIER ACTUEL</span><code>{workspace}/{filePath}</code></div><textarea className="code-editor" aria-label="Contenu actuel du fichier" value={fileContent} onChange={(event) => setFileContent(event.target.value)} spellCheck={false} placeholder="Chargez un fichier existant, ou demandez la création d’un nouveau fichier." /></div><div className="editor-panel"><div className="editor-head"><span>PROPOSITION DE L’AGENT</span><span className="draft-label">{draft ? "À RELIRE" : "EN ATTENTE"}</span></div><textarea className="code-editor" aria-label="Proposition de l’agent" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} placeholder="La proposition apparaîtra ici. Rien ne sera enregistré avant votre validation." /><button className="apply-button" type="button" onClick={() => void applyDraft()} disabled={!draft || buildBusy}>Appliquer cette proposition au bac à sable <span>→</span></button></div></div>
          </section>
        ) : (
          <section className="library-view">
            <div className="library-heading">
              <div><div className="eyebrow"><span className="eyebrow-star">✳</span> BASE DE CONNAISSANCES LOCALE</div><h1>Bibliothèque <em>universelle.</em></h1><p>Articles d’actualité généraliste mis à jour automatiquement et documents que vous choisissez d’ajouter. Les agents recherchent des extraits pertinents sur tous les sujets.</p></div>
              <button className="outline-button library-sync-button" type="button" onClick={() => void syncLibrary()} disabled={librarySyncing}>{librarySyncing ? "Actualisation…" : "↻ Actualiser maintenant"}</button>
            </div>
            <div className="library-status-strip"><span>▤</span><div><strong>{libraryTotal} source{libraryTotal > 1 ? "s" : ""} enregistrée{libraryTotal > 1 ? "s" : ""}</strong><small>{libraryUpdatedAt ? `Dernière mise à jour automatique : ${new Date(libraryUpdatedAt).toLocaleString()} · prochaine prévue : ${libraryNextUpdateAt ? new Date(libraryNextUpdateAt).toLocaleString() : "—"}` : "La première synchronisation automatique démarre avec le serveur."}</small></div></div>
            <div className="library-privacy-note">La synchronisation périodique interroge Google Actualités sur l’actualité générale, la science, la technologie, la culture, la santé, l’environnement, le travail et l’économie. Les articles et documents restent des sources non vérifiées, pas une base exhaustive ni un nouveau modèle entraîné. Les requêtes de synchronisation nécessitent Internet.</div>
            {libraryWarnings.length > 0 && <div className="error-banner" role="status">Synchronisation partielle : {libraryWarnings.join(" · ")}</div>}
            {libraryError && <div className="error-banner" role="alert">{libraryError}</div>}
            <label className="library-search"><span>RECHERCHER DANS LA BIBLIOTHÈQUE</span><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Sujet, science, culture, technologie, document…" maxLength={180} /></label>
            <div className="library-results">
              {libraryEntries.length === 0 ? <div className="library-empty">{libraryQuery.trim() ? "Aucun élément correspondant." : "Aucune source pour le moment. La première synchronisation se termine en arrière-plan ; vous pouvez aussi lancer une actualisation ou ajouter un document depuis le bouton + du chat."}</div>
                : libraryEntries.map((entry) => <article className="library-entry" key={entry.id}><div className="library-entry-meta"><span>{entry.category}</span><span>{entry.publisher}</span></div><h2>{entry.url ? <a href={entry.url} target="_blank" rel="noreferrer">{entry.title} ↗</a> : entry.title}</h2><p>{entry.snippet || "Document conservé dans la bibliothèque locale."}</p><small>{entry.publishedAt ? `Publié ${entry.publishedAt}` : `Ajouté ${new Date(entry.retrievedAt).toLocaleString()}`}</small></article>)}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
