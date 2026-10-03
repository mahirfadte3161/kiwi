"use client";

import React, { useEffect, useRef, useState } from "react";

const API = "http://localhost:8000";

type FileType = "pdf" | "pptx";

type Document = {
  document_id: string;
  filename: string;
  file_type?: FileType;
  relative_path?: string;
  unit?: string;
  page_count?: number | null;
  slide_count?: number | null;
  pages?: number[];
  slides?: number[];
  locations?: string;
  first_page?: number;
  view_url?: string;
  download_url?: string;
  relevance?: number;
  match_count?: number;
  snippets?: string[];
  preview?: string;
};

type Source = Document & {
  location?: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: "ask" | "find";
  timestamp: string;
  sources?: Source[];
  documents?: Document[];
};

type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  messages: Message[];
};

// Simple Markdown Renderer
function MarkdownRenderer({ content }: { content: string }) {
  if (!content) return null;

  // Split into lines to parse basic markdown structures
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let currentList: { type: "ul" | "ol"; items: string[] } | null = null;
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];

  const flushList = () => {
    if (!currentList) return;
    if (currentList.type === "ul") {
      elements.push(
        <ul key={`ul-${elements.length}`} style={{ paddingLeft: "1.25rem", margin: "0.5rem 0" }}>
          {currentList.items.map((item, i) => (
            <li key={i} style={{ marginBottom: "0.25rem" }}>
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
    } else {
      elements.push(
        <ol key={`ol-${elements.length}`} style={{ paddingLeft: "1.25rem", margin: "0.5rem 0" }}>
          {currentList.items.map((item, i) => (
            <li key={i} style={{ marginBottom: "0.25rem" }}>
              {renderInline(item)}
            </li>
          ))}
        </ol>
      );
    }
    currentList = null;
  };

  const flushCodeBlock = () => {
    if (!inCodeBlock) return;
    elements.push(
      <pre
        key={`code-${elements.length}`}
        style={{
          background: "#181818",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          padding: "0.85rem",
          overflowX: "auto",
          margin: "0.75rem 0",
          fontSize: "0.88rem",
          color: "#4ade80",
        }}
      >
        <code>{codeBlockLines.join("\n")}</code>
      </pre>
    );
    codeBlockLines = [];
    inCodeBlock = false;
  };

  function renderInline(text: string): React.ReactNode {
    // Process bold, italic, code
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      const raw = match[0];
      if (raw.startsWith("**") && raw.endsWith("**")) {
        parts.push(<strong key={match.index} style={{ color: "#fff", fontWeight: 600 }}>{raw.slice(2, -2)}</strong>);
      } else if (raw.startsWith("*") && raw.endsWith("*")) {
        parts.push(<em key={match.index} style={{ color: "#d1d5db" }}>{raw.slice(1, -1)}</em>);
      } else if (raw.startsWith("`") && raw.endsWith("`")) {
        parts.push(
          <code
            key={match.index}
            style={{
              background: "rgba(255,255,255,0.1)",
              padding: "0.15rem 0.35rem",
              borderRadius: 4,
              fontSize: "0.86em",
              color: "#34d399",
            }}
          >
            {raw.slice(1, -1)}
          </code>
        );
      }
      lastIndex = match.index + raw.length;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks ```
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        flushCodeBlock();
      } else {
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Dividers
    if (line.trim() === "---" || line.trim() === "***") {
      flushList();
      elements.push(<hr key={i} style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.1)", margin: "1rem 0" }} />);
      continue;
    }

    // Headings
    if (line.startsWith("#### ")) {
      flushList();
      elements.push(<h4 key={i} style={{ fontSize: "1.02rem", color: "#60a5fa", margin: "1rem 0 0.4rem 0", fontWeight: 600 }}>{renderInline(line.slice(5))}</h4>);
      continue;
    }
    if (line.startsWith("### ")) {
      flushList();
      elements.push(<h3 key={i} style={{ fontSize: "1.12rem", color: "#93c5fd", margin: "1.1rem 0 0.45rem 0", fontWeight: 600 }}>{renderInline(line.slice(4))}</h3>);
      continue;
    }
    if (line.startsWith("## ")) {
      flushList();
      elements.push(<h2 key={i} style={{ fontSize: "1.25rem", color: "#ffffff", margin: "1.2rem 0 0.5rem 0", fontWeight: 600 }}>{renderInline(line.slice(3))}</h2>);
      continue;
    }
    if (line.startsWith("# ")) {
      flushList();
      elements.push(<h1 key={i} style={{ fontSize: "1.4rem", color: "#ffffff", margin: "1.25rem 0 0.5rem 0", fontWeight: 700 }}>{renderInline(line.slice(2))}</h1>);
      continue;
    }

    // Unordered lists
    if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
      const itemText = line.trim().substring(2);
      if (!currentList || currentList.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [itemText] };
      } else {
        currentList.items.push(itemText);
      }
      continue;
    }

    // Ordered lists
    const orderedMatch = line.trim().match(/^(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      const itemText = orderedMatch[2];
      if (!currentList || currentList.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [itemText] };
      } else {
        currentList.items.push(itemText);
      }
      continue;
    }

    // Regular line / paragraph
    flushList();
    if (line.trim()) {
      elements.push(
        <p key={i} style={{ marginBottom: "0.75rem", lineHeight: 1.65 }}>
          {renderInline(line)}
        </p>
      );
    }
  }

  flushList();
  flushCodeBlock();

  return <div className="markdown-body">{elements}</div>;
}

export default function Home() {
  // Session State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [mode, setMode] = useState<"ask" | "find">("ask");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Document Library Modal State
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [library, setLibrary] = useState<Document[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("All");
  const [downloading, setDownloading] = useState("");
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load chat sessions from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("sam7_chat_sessions");
      if (stored) {
        const parsed: ChatSession[] = JSON.parse(stored);
        if (parsed.length > 0) {
          setSessions(parsed);
          setActiveSessionId(parsed[0].id);
          return;
        }
      }
    } catch {
      // ignore
    }

    // Initialize with a default session
    const defaultSession: ChatSession = {
      id: "session_" + Date.now(),
      title: "New Conversation",
      createdAt: Date.now(),
      messages: [],
    };
    setSessions([defaultSession]);
    setActiveSessionId(defaultSession.id);
  }, []);

  // Save chat sessions to localStorage
  useEffect(() => {
    if (sessions.length > 0) {
      try {
        localStorage.setItem("sam7_chat_sessions", JSON.stringify(sessions));
      } catch {
        // ignore
      }
    }
  }, [sessions]);

  // Load document library on mount
  useEffect(() => {
    fetchLibrary();
  }, []);

  // Scroll to bottom on new message or loading change
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sessions, activeSessionId, loading]);

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  const createNewChat = () => {
    const newSession: ChatSession = {
      id: "session_" + Date.now(),
      title: "New Conversation",
      createdAt: Date.now(),
      messages: [],
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const filtered = sessions.filter((s) => s.id !== id);
    if (filtered.length === 0) {
      const fresh: ChatSession = {
        id: "session_" + Date.now(),
        title: "New Conversation",
        createdAt: Date.now(),
        messages: [],
      };
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
    } else {
      setSessions(filtered);
      if (activeSessionId === id) {
        setActiveSessionId(filtered[0].id);
      }
    }
  };

  const fetchLibrary = async (query = "") => {
    setLibraryLoading(true);
    try {
      const endpoint = query ? `${API}/documents/search?q=${encodeURIComponent(query)}` : `${API}/documents`;
      const res = await fetch(endpoint);
      const data = await res.json();
      setLibrary(data.documents || []);
    } catch {
      // keep previous
    } finally {
      setLibraryLoading(false);
    }
  };

  const downloadFile = async (doc: Document) => {
    if (downloading) return;
    setDownloading(doc.document_id);
    try {
      const url = doc.download_url ? `${API}${doc.download_url}` : `${API}/documents/${encodeURIComponent(doc.document_id)}/file`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = objUrl;
      a.download = doc.filename;
      a.click();
      URL.revokeObjectURL(objUrl);
    } catch {
      alert("Failed to download file. Please check backend connection.");
    } finally {
      setDownloading("");
    }
  };

  const viewFile = (doc: Document, location?: string | number) => {
    const isPdf = doc.file_type === "pdf" || doc.filename.toLowerCase().endsWith(".pdf");
    let pageNum: string | undefined = undefined;
    if (typeof location === "number") {
      pageNum = String(location);
    } else if (typeof location === "string") {
      const match = location.match(/\d+/);
      if (match) pageNum = match[0];
    } else if (doc.first_page) {
      pageNum = String(doc.first_page);
    }

    const base = doc.download_url || `/documents/${encodeURIComponent(doc.document_id)}/file`;
    const fullUrl = `${API}${base}${isPdf && pageNum ? `#page=${pageNum}` : ""}`;
    window.open(fullUrl, "_blank", "noopener,noreferrer");
  };

  const toggleSourceDrawer = (msgId: string) => {
    setExpandedSources((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  // Submit query
  const handleSubmit = async (overrideQuery?: string, overrideMode?: "ask" | "find") => {
    const queryToSend = (overrideQuery || input).trim();
    if (!queryToSend || loading) return;

    const currentMode = overrideMode || mode;

    const userMessage: Message = {
      id: "msg_" + Date.now(),
      role: "user",
      content: queryToSend,
      mode: currentMode,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    // Update session title if first message
    const updatedMessages = [...(activeSession?.messages || []), userMessage];
    const isFirstMessage = (activeSession?.messages || []).length === 0;
    const newTitle = isFirstMessage ? queryToSend.slice(0, 30) + (queryToSend.length > 30 ? "..." : "") : activeSession.title;

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
          ? { ...s, title: newTitle, messages: updatedMessages }
          : s
      )
    );

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setLoading(true);

    try {
      if (currentMode === "ask") {
        // Prepare conversation history
        const history = updatedMessages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role, content: m.content }));

        const res = await fetch(`${API}/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: queryToSend, history }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `Server returned ${res.status}`);
        }

        const data = await res.json();
        const assistantMessage: Message = {
          id: "msg_" + (Date.now() + 1),
          role: "assistant",
          content: data.answer || "No response received.",
          mode: "ask",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          sources: data.sources || [],
        };

        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id
              ? { ...s, messages: [...updatedMessages, assistantMessage] }
              : s
          )
        );
      } else {
        // "find" mode: content-based subtopic document discovery
        const res = await fetch(`${API}/find`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: queryToSend, top_k: 15 }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `Server returned ${res.status}`);
        }

        const data = await res.json();
        const docs: Document[] = data.documents || [];

        let summaryText = "";
        if (docs.length === 0) {
          summaryText = `I searched all semester documents for the subtopic **"${queryToSend}"**, but couldn't find any direct matches inside the document texts or slides. Try a related keyword or explore the Document Library.`;
        } else {
          summaryText = `Found **${docs.length} document${docs.length > 1 ? "s" : ""}** discussing or referencing **"${queryToSend}"** inside their contents:`;
        }

        const assistantMessage: Message = {
          id: "msg_" + (Date.now() + 1),
          role: "assistant",
          content: summaryText,
          mode: "find",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          documents: docs,
        };

        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id
              ? { ...s, messages: [...updatedMessages, assistantMessage] }
              : s
          )
        );
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "An unexpected error occurred.";
      const errorMsg: Message = {
        id: "msg_" + (Date.now() + 1),
        role: "assistant",
        content: `⚠️ **Error**: ${errMsg}\n\nPlease verify that the backend server is running on \`http://localhost:8000\`.`,
        mode: currentMode,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? { ...s, messages: [...updatedMessages, errorMsg] }
            : s
        )
      );
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Filtered documents in Library modal
  const filteredLibrary = library.filter((doc) => {
    if (selectedSubject === "All") return true;
    const str = `${doc.filename} ${doc.unit || ""} ${doc.relative_path || ""}`.toLowerCase();
    if (selectedSubject === "NNDL") return str.includes("nndl");
    if (selectedSubject === "CD") return str.includes("cd") || str.includes("compiler");
    if (selectedSubject === "DA") return str.includes("da") || str.includes("decision");
    if (selectedSubject === "Lab") return str.includes("lab") || str.includes("expt");
    return true;
  });

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden", background: "#212121", color: "#ececec" }}>
      {/* LEFT SIDEBAR (ChatGPT Style) */}
      <aside
        style={{
          width: sidebarOpen ? "260px" : "0px",
          minWidth: sidebarOpen ? "260px" : "0px",
          height: "100%",
          background: "#171717",
          borderRight: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          flexDirection: "column",
          transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          overflow: "hidden",
          zIndex: 30,
        }}
      >
        {/* Sidebar Header */}
        <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600, fontSize: "0.95rem" }}>
            <span style={{ fontSize: "1.25rem" }}>🥝</span>
            <span>SAM7 AI</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            title="Close sidebar"
            style={{ color: "#8e8e8e", padding: "4px", borderRadius: "6px" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
        </div>

        {/* New Chat Button */}
        <div style={{ padding: "0 12px 10px 12px" }}>
          <button
            onClick={createNewChat}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              background: "#212121",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "8px",
              color: "#ececec",
              fontSize: "0.9rem",
              fontWeight: 500,
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = "#2a2a2a")}
            onMouseOut={(e) => (e.currentTarget.style.background = "#212121")}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>New chat</span>
            </div>
            <span style={{ fontSize: "0.75rem", color: "#8e8e8e" }}>Ctrl+K</span>
          </button>
        </div>

        {/* Chat History List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#8e8e8e", padding: "8px 8px 4px 8px" }}>
            Conversations
          </div>
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                onClick={() => setActiveSessionId(session.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "9px 12px",
                  borderRadius: "8px",
                  marginBottom: "4px",
                  cursor: "pointer",
                  fontSize: "0.88rem",
                  background: isActive ? "rgba(255,255,255,0.1)" : "transparent",
                  color: isActive ? "#ffffff" : "#b4b4b4",
                  position: "relative",
                  transition: "background 0.15s ease",
                }}
                onMouseOver={(e) => {
                  if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                }}
                onMouseOut={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", overflow: "hidden" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "160px" }}>
                    {session.title || "New Conversation"}
                  </span>
                </div>
                <button
                  onClick={(e) => deleteSession(session.id, e)}
                  title="Delete chat"
                  style={{
                    color: "#8e8e8e",
                    opacity: isActive ? 1 : 0.4,
                    padding: "2px 4px",
                    borderRadius: "4px",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.color = "#ef4444")}
                  onMouseOut={(e) => (e.currentTarget.style.color = "#8e8e8e")}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>

        {/* Sidebar Footer: Library & Status */}
        <div style={{ padding: "12px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: "8px" }}>
          <button
            onClick={() => setLibraryOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 12px",
              background: "rgba(255,255,255,0.04)",
              borderRadius: "8px",
              fontSize: "0.85rem",
              color: "#ececec",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            onMouseOut={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span>📚</span>
              <span>Document Library</span>
            </div>
            <span
              style={{
                background: "#10a37f",
                color: "#fff",
                fontSize: "0.72rem",
                padding: "2px 7px",
                borderRadius: "999px",
                fontWeight: 600,
              }}
            >
              {library.length} docs
            </span>
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", fontSize: "0.82rem", color: "#8e8e8e" }}>
            <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "#2f2f2f", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, color: "#fff", fontSize: "0.78rem" }}>
              MF
            </div>
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
              <span style={{ color: "#ececec", fontWeight: 500 }}>Mahir Fadte</span>
              <span style={{ fontSize: "0.7rem", color: "#10a37f" }}>● ChromaDB Active</span>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CHAT CANVAS */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", position: "relative", overflow: "hidden" }}>
        {/* Top Navbar */}
        <header
          style={{
            height: "56px",
            minHeight: "56px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 18px",
            background: "rgba(33, 33, 33, 0.85)",
            backdropFilter: "blur(12px)",
            zIndex: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                title="Open sidebar"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "6px",
                  borderRadius: "6px",
                  color: "#ececec",
                  background: "rgba(255,255,255,0.06)",
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                </svg>
              </button>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontWeight: 600, fontSize: "0.98rem" }}>
                {activeSession?.title || "New Chat"}
              </span>
              <span
                style={{
                  background: "rgba(255,255,255,0.06)",
                  color: "#9ca3af",
                  fontSize: "0.72rem",
                  padding: "2px 8px",
                  borderRadius: "999px",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                SEM 7 Assistant
              </span>
            </div>
          </div>

          {/* Quick Header Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* Mode Indicator & Switcher */}
            <div
              style={{
                display: "flex",
                background: "#181818",
                padding: "3px",
                borderRadius: "999px",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <button
                onClick={() => setMode("ask")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "5px 12px",
                  borderRadius: "999px",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  background: mode === "ask" ? "#10a37f" : "transparent",
                  color: mode === "ask" ? "#ffffff" : "#9ca3af",
                }}
              >
                <span>💬</span>
                <span>Ask Question</span>
              </button>
              <button
                onClick={() => setMode("find")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "5px 12px",
                  borderRadius: "999px",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  background: mode === "find" ? "#3b82f6" : "transparent",
                  color: mode === "find" ? "#ffffff" : "#9ca3af",
                }}
              >
                <span>🔍</span>
                <span>Find Documents</span>
              </button>
            </div>

            <button
              onClick={() => setLibraryOpen(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                borderRadius: "8px",
                fontSize: "0.82rem",
                color: "#ececec",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <span>📄</span>
              <span>Library ({library.length})</span>
            </button>
          </div>
        </header>

        {/* Chat Message Scroll Area */}
        <main style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", position: "relative" }}>
          {(!activeSession || activeSession.messages.length === 0) ? (
            /* ChatGPT Landing State */
            <div
              style={{
                maxWidth: "760px",
                width: "100%",
                margin: "auto",
                padding: "40px 24px 120px 24px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
              }}
            >
              {/* Logo Hero */}
              <div
                style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #10a37f, #3b82f6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "2rem",
                  boxShadow: "0 8px 24px rgba(16, 163, 127, 0.25)",
                  marginBottom: "16px",
                }}
              >
                🥝
              </div>
              <h1 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "8px", color: "#ffffff" }}>
                What would you like to explore today?
              </h1>
              <p style={{ color: "#9ca3af", fontSize: "0.95rem", maxWidth: "540px", marginBottom: "28px", lineHeight: 1.5 }}>
                Ask detailed questions or search inside Semester 7 documents for any subtopic across NNDL, Compiler Design, Decision Analysis, and Lab files.
              </p>

              {/* Mode Selection Cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "14px",
                  width: "100%",
                  marginBottom: "28px",
                }}
              >
                <div
                  onClick={() => setMode("ask")}
                  style={{
                    padding: "16px",
                    background: mode === "ask" ? "rgba(16, 163, 127, 0.12)" : "#2a2a2a",
                    border: mode === "ask" ? "2px solid #10a37f" : "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "12px",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                    <span style={{ fontSize: "1.2rem" }}>💬</span>
                    {mode === "ask" && (
                      <span style={{ fontSize: "0.72rem", background: "#10a37f", color: "#fff", padding: "2px 8px", borderRadius: "999px" }}>
                        Selected
                      </span>
                    )}
                  </div>
                  <h3 style={{ fontSize: "0.98rem", fontWeight: 600, color: "#ffffff", marginBottom: "4px" }}>
                    Ask Question Mode
                  </h3>
                  <p style={{ fontSize: "0.82rem", color: "#9ca3af", lineHeight: 1.4 }}>
                    Synthesizes detailed answers from course slides & notes with exact source citations and page numbers.
                  </p>
                </div>

                <div
                  onClick={() => setMode("find")}
                  style={{
                    padding: "16px",
                    background: mode === "find" ? "rgba(59, 130, 246, 0.12)" : "#2a2a2a",
                    border: mode === "find" ? "2px solid #3b82f6" : "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "12px",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                    <span style={{ fontSize: "1.2rem" }}>🔍</span>
                    {mode === "find" && (
                      <span style={{ fontSize: "0.72rem", background: "#3b82f6", color: "#fff", padding: "2px 8px", borderRadius: "999px" }}>
                        Selected
                      </span>
                    )}
                  </div>
                  <h3 style={{ fontSize: "0.98rem", fontWeight: 600, color: "#ffffff", marginBottom: "4px" }}>
                    Find Documents Mode
                  </h3>
                  <p style={{ fontSize: "0.82rem", color: "#9ca3af", lineHeight: 1.4 }}>
                    Searches directly inside document text for any subtopic or concept, surfacing exact page numbers and excerpts.
                  </p>
                </div>
              </div>

              {/* Starter Suggestions */}
              <div style={{ width: "100%", textAlign: "left" }}>
                <div style={{ fontSize: "0.8rem", color: "#8e8e8e", marginBottom: "10px", fontWeight: 600 }}>
                  Suggested queries
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <button
                    onClick={() => handleSubmit("Explain Backpropagation algorithm with step-by-step formulas", "ask")}
                    style={{
                      padding: "12px 14px",
                      background: "#282828",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "10px",
                      textAlign: "left",
                      color: "#ececec",
                      fontSize: "0.85rem",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.background = "#333333")}
                    onMouseOut={(e) => (e.currentTarget.style.background = "#282828")}
                  >
                    <div style={{ fontWeight: 500, color: "#fff", marginBottom: "2px" }}>🧠 Backpropagation</div>
                    <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Explain algorithm with step-by-step formulas</div>
                  </button>

                  <button
                    onClick={() => handleSubmit("Activation Functions", "find")}
                    style={{
                      padding: "12px 14px",
                      background: "#282828",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "10px",
                      textAlign: "left",
                      color: "#ececec",
                      fontSize: "0.85rem",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.background = "#333333")}
                    onMouseOut={(e) => (e.currentTarget.style.background = "#282828")}
                  >
                    <div style={{ fontWeight: 500, color: "#fff", marginBottom: "2px" }}>🔍 Find: Activation Functions</div>
                    <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Search inside slides for activation function topics</div>
                  </button>

                  <button
                    onClick={() => handleSubmit("Syntax Directed Translation", "find")}
                    style={{
                      padding: "12px 14px",
                      background: "#282828",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "10px",
                      textAlign: "left",
                      color: "#ececec",
                      fontSize: "0.85rem",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.background = "#333333")}
                    onMouseOut={(e) => (e.currentTarget.style.background = "#282828")}
                  >
                    <div style={{ fontWeight: 500, color: "#fff", marginBottom: "2px" }}>🔍 Find: Syntax Directed Translation</div>
                    <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Locate notes & slides on SDT in Compiler Design</div>
                  </button>

                  <button
                    onClick={() => handleSubmit("What questions are asked in DEC 2024 DA question paper?", "ask")}
                    style={{
                      padding: "12px 14px",
                      background: "#282828",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "10px",
                      textAlign: "left",
                      color: "#ececec",
                      fontSize: "0.85rem",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.background = "#333333")}
                    onMouseOut={(e) => (e.currentTarget.style.background = "#282828")}
                  >
                    <div style={{ fontWeight: 500, color: "#fff", marginBottom: "2px" }}>📝 Past Exam Papers</div>
                    <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Questions from DEC 2024 Decision Analysis paper</div>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Active Message Flow */
            <div style={{ maxWidth: "800px", width: "100%", margin: "0 auto", padding: "24px 20px 140px 20px" }}>
              {activeSession.messages.map((message) => {
                const isUser = message.role === "user";
                return (
                  <div
                    key={message.id}
                    className="animate-fade-in"
                    style={{
                      display: "flex",
                      gap: "14px",
                      marginBottom: "24px",
                      alignItems: "flex-start",
                      justifyContent: isUser ? "flex-end" : "flex-start",
                    }}
                  >
                    {!isUser && (
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          minWidth: "32px",
                          borderRadius: "50%",
                          background: message.mode === "find" ? "#3b82f6" : "#10a37f",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "1rem",
                          color: "#fff",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                        }}
                      >
                        {message.mode === "find" ? "🔍" : "🥝"}
                      </div>
                    )}

                    <div
                      style={{
                        maxWidth: isUser ? "85%" : "100%",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: isUser ? "flex-end" : "flex-start",
                      }}
                    >
                      {/* Message Content */}
                      <div
                        style={{
                          background: isUser ? "#2f2f2f" : "transparent",
                          padding: isUser ? "12px 18px" : "0",
                          borderRadius: isUser ? "18px 18px 4px 18px" : "0",
                          color: "#ececec",
                          fontSize: "0.95rem",
                          border: isUser ? "1px solid rgba(255,255,255,0.06)" : "none",
                        }}
                      >
                        {isUser && (
                          <div style={{ fontSize: "0.72rem", color: "#9ca3af", marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                            <span>{message.mode === "find" ? "🔍 Subtopic Search" : "💬 Question"}</span>
                            <span>•</span>
                            <span>{message.timestamp}</span>
                          </div>
                        )}

                        <MarkdownRenderer content={message.content} />

                        {/* Ask Mode: Expandable Source Citations */}
                        {!isUser && message.sources && message.sources.length > 0 && (
                          <div style={{ marginTop: "16px", width: "100%" }}>
                            <button
                              onClick={() => toggleSourceDrawer(message.id)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                padding: "6px 12px",
                                background: "rgba(255,255,255,0.06)",
                                border: "1px solid rgba(255,255,255,0.1)",
                                borderRadius: "8px",
                                fontSize: "0.82rem",
                                color: "#b4b4b4",
                                fontWeight: 500,
                              }}
                              onMouseOver={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
                              onMouseOut={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                            >
                              <span>📚</span>
                              <span>
                                {message.sources.length} Referenced Source{message.sources.length > 1 ? "s" : ""}
                              </span>
                              <span style={{ fontSize: "0.7rem", color: "#8e8e8e" }}>
                                {expandedSources[message.id] ? "▲" : "▼"}
                              </span>
                            </button>

                            {expandedSources[message.id] && (
                              <div
                                className="animate-fade-in"
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr",
                                  gap: "10px",
                                  marginTop: "10px",
                                }}
                              >
                                {message.sources.map((src, idx) => {
                                  const isPdf = src.file_type === "pdf" || src.filename.toLowerCase().endsWith(".pdf");
                                  return (
                                    <div
                                      key={idx}
                                      style={{
                                        background: "#1c1c1c",
                                        border: "1px solid rgba(255,255,255,0.08)",
                                        borderRadius: "8px",
                                        padding: "12px",
                                      }}
                                    >
                                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
                                          <span>{isPdf ? "📄" : "📊"}</span>
                                          <strong style={{ fontSize: "0.88rem", color: "#ffffff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            {src.filename}
                                          </strong>
                                          {src.unit && (
                                            <span style={{ background: "rgba(59, 130, 246, 0.2)", color: "#93c5fd", fontSize: "0.72rem", padding: "1px 6px", borderRadius: "4px" }}>
                                              {src.unit}
                                            </span>
                                          )}
                                        </div>
                                        <span style={{ fontSize: "0.75rem", color: "#34d399", fontWeight: 500 }}>
                                          {src.location || src.locations}
                                        </span>
                                      </div>

                                      {src.preview && (
                                        <p style={{ fontSize: "0.8rem", color: "#9ca3af", margin: "6px 0", fontStyle: "italic", background: "rgba(0,0,0,0.2)", padding: "6px 8px", borderRadius: "4px" }}>
                                          "{src.preview}..."
                                        </p>
                                      )}

                                      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                                        <button
                                          onClick={() => viewFile(src, src.location || src.locations)}
                                          style={{
                                            fontSize: "0.78rem",
                                            padding: "4px 10px",
                                            background: "#10a37f",
                                            color: "#fff",
                                            borderRadius: "6px",
                                            fontWeight: 500,
                                          }}
                                        >
                                          View {isPdf ? "PDF Page" : "Slide"}
                                        </button>
                                        <button
                                          onClick={() => downloadFile(src)}
                                          disabled={downloading === src.document_id}
                                          style={{
                                            fontSize: "0.78rem",
                                            padding: "4px 10px",
                                            background: "rgba(255,255,255,0.08)",
                                            color: "#ececec",
                                            borderRadius: "6px",
                                          }}
                                        >
                                          {downloading === src.document_id ? "Downloading..." : "Download"}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Find Documents Mode: Content Search Result Cards */}
                        {!isUser && message.documents && message.documents.length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "14px", width: "100%" }}>
                            {message.documents.map((doc, idx) => {
                              const isPdf = doc.file_type === "pdf" || doc.filename.toLowerCase().endsWith(".pdf");
                              const pageInfo = doc.locations || (doc.pages ? `pages ${doc.pages.join(", ")}` : doc.slides ? `slides ${doc.slides.join(", ")}` : "");
                              return (
                                <div
                                  key={idx}
                                  style={{
                                    background: "#1c1c1c",
                                    border: "1px solid rgba(255,255,255,0.1)",
                                    borderRadius: "10px",
                                    padding: "14px 16px",
                                    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px", marginBottom: "8px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                      <span style={{ fontSize: "1.1rem" }}>{isPdf ? "📄" : "📊"}</span>
                                      <div>
                                        <div style={{ fontWeight: 600, fontSize: "0.92rem", color: "#ffffff" }}>
                                          {doc.filename}
                                        </div>
                                        <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "2px" }}>
                                          {doc.relative_path}
                                        </div>
                                      </div>
                                    </div>

                                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                      {doc.unit && (
                                        <span style={{ background: "rgba(59, 130, 246, 0.2)", color: "#93c5fd", fontSize: "0.72rem", padding: "2px 8px", borderRadius: "999px" }}>
                                          {doc.unit}
                                        </span>
                                      )}
                                      {doc.match_count && (
                                        <span style={{ background: "rgba(16, 163, 127, 0.2)", color: "#6ee7b7", fontSize: "0.72rem", padding: "2px 8px", borderRadius: "999px", fontWeight: 500 }}>
                                          {doc.match_count} match{doc.match_count > 1 ? "es" : ""}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Exact location in document */}
                                  {pageInfo && (
                                    <div style={{ fontSize: "0.8rem", color: "#34d399", marginBottom: "8px", fontWeight: 500, display: "flex", alignItems: "center", gap: "4px" }}>
                                      <span>📍 Content located at:</span>
                                      <span style={{ textDecoration: "underline" }}>{pageInfo}</span>
                                    </div>
                                  )}

                                  {/* Subtopic Excerpts / Snippets */}
                                  {doc.snippets && doc.snippets.length > 0 && (
                                    <div style={{ marginBottom: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
                                      {doc.snippets.map((snip, sIdx) => (
                                        <div
                                          key={sIdx}
                                          style={{
                                            background: "rgba(0,0,0,0.3)",
                                            borderLeft: "3px solid #3b82f6",
                                            padding: "6px 10px",
                                            borderRadius: "0 6px 6px 0",
                                            fontSize: "0.82rem",
                                            color: "#d1d5db",
                                            lineHeight: 1.45,
                                          }}
                                        >
                                          {snip}
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Action Buttons */}
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                    <button
                                      onClick={() => viewFile(doc, doc.first_page || (doc.pages ? doc.pages[0] : 1))}
                                      style={{
                                        padding: "6px 12px",
                                        background: "#3b82f6",
                                        color: "#ffffff",
                                        borderRadius: "6px",
                                        fontSize: "0.8rem",
                                        fontWeight: 500,
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "4px",
                                      }}
                                    >
                                      <span>📖</span>
                                      <span>View {isPdf ? `PDF (Page ${doc.first_page || (doc.pages ? doc.pages[0] : 1)})` : "Document"}</span>
                                    </button>

                                    <button
                                      onClick={() => downloadFile(doc)}
                                      disabled={downloading === doc.document_id}
                                      style={{
                                        padding: "6px 12px",
                                        background: "rgba(255,255,255,0.08)",
                                        color: "#ececec",
                                        borderRadius: "6px",
                                        fontSize: "0.8rem",
                                      }}
                                    >
                                      {downloading === doc.document_id ? "Downloading..." : "⬇ Download"}
                                    </button>

                                    <button
                                      onClick={() => {
                                        setMode("ask");
                                        handleSubmit(`Explain the content and key topics in ${doc.filename}`, "ask");
                                      }}
                                      style={{
                                        padding: "6px 12px",
                                        background: "transparent",
                                        border: "1px solid rgba(255,255,255,0.12)",
                                        color: "#9ca3af",
                                        borderRadius: "6px",
                                        fontSize: "0.8rem",
                                      }}
                                      onMouseOver={(e) => {
                                        e.currentTarget.style.color = "#fff";
                                        e.currentTarget.style.borderColor = "#10a37f";
                                      }}
                                      onMouseOut={(e) => {
                                        e.currentTarget.style.color = "#9ca3af";
                                        e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
                                      }}
                                    >
                                      💬 Ask AI about this file
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Loading Indicator */}
              {loading && (
                <div style={{ display: "flex", gap: "14px", alignItems: "center", marginBottom: "20px" }}>
                  <div
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      background: mode === "find" ? "#3b82f6" : "#10a37f",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1rem",
                      color: "#fff",
                    }}
                  >
                    {mode === "find" ? "🔍" : "🥝"}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#9ca3af", fontSize: "0.88rem" }}>
                    <span>{mode === "find" ? "Searching document contents for subtopics..." : "Analyzing semester notes and synthesizing answer..."}</span>
                    <div className="loading-dots">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>
          )}
        </main>

        {/* FLOATING CHATGPT INPUT DOCK */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            background: "linear-gradient(180deg, transparent 0%, #212121 40%)",
            padding: "20px 20px 16px 20px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            zIndex: 20,
          }}
        >
          <div style={{ maxWidth: "760px", width: "100%", display: "flex", flexDirection: "column", gap: "8px" }}>
            {/* Mode Switcher Segmented Control */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 6px" }}>
              <div
                style={{
                  display: "inline-flex",
                  background: "#181818",
                  padding: "3px",
                  borderRadius: "999px",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                <button
                  type="button"
                  onClick={() => setMode("ask")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "4px 14px",
                    borderRadius: "999px",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    background: mode === "ask" ? "#10a37f" : "transparent",
                    color: mode === "ask" ? "#ffffff" : "#9ca3af",
                  }}
                >
                  <span>💬</span>
                  <span>Ask Question</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("find")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "4px 14px",
                    borderRadius: "999px",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    background: mode === "find" ? "#3b82f6" : "transparent",
                    color: mode === "find" ? "#ffffff" : "#9ca3af",
                  }}
                >
                  <span>🔍</span>
                  <span>Find Documents (Subtopic Search)</span>
                </button>
              </div>

              <span style={{ fontSize: "0.72rem", color: "#8e8e8e" }}>
                {mode === "ask" ? "Q&A mode with source citations" : "Content & subtopic discovery mode"}
              </span>
            </div>

            {/* Input Container */}
            <div
              style={{
                position: "relative",
                background: "#2f2f2f",
                borderRadius: "24px",
                border: "1px solid rgba(255,255,255,0.15)",
                boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                display: "flex",
                alignItems: "flex-end",
                padding: "10px 14px 10px 18px",
              }}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                placeholder={
                  mode === "ask"
                    ? "Ask anything about semester 7 notes, algorithms, questions (Enter to send)..."
                    : "Search subtopic or concept inside documents (e.g. Backpropagation, LR parser)..."
                }
                rows={1}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  resize: "none",
                  maxHeight: "180px",
                  fontSize: "0.95rem",
                  lineHeight: "1.5",
                  color: "#ececec",
                }}
              />

              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={!input.trim() || loading}
                title="Send message"
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  background: input.trim() && !loading ? (mode === "find" ? "#3b82f6" : "#10a37f") : "rgba(255,255,255,0.1)",
                  color: input.trim() && !loading ? "#ffffff" : "#666666",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginLeft: "10px",
                  cursor: input.trim() && !loading ? "pointer" : "default",
                  transition: "all 0.15s ease",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>

            <div style={{ textAlign: "center", fontSize: "0.72rem", color: "#777777" }}>
              SAM7 AI Document Assistant • Grounded in Semester 7 academic notes and question papers.
            </div>
          </div>
        </div>
      </div>

      {/* DOCUMENT LIBRARY MODAL */}
      {libraryOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(6px)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
          onClick={() => setLibraryOpen(false)}
        >
          <div
            className="animate-fade-in"
            style={{
              width: "100%",
              maxWidth: "840px",
              height: "82vh",
              background: "#1c1c1c",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "16px",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ padding: "18px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h2 style={{ fontSize: "1.2rem", fontWeight: 700, color: "#fff" }}>📚 Semester 7 Document Library</h2>
                <p style={{ fontSize: "0.82rem", color: "#9ca3af", marginTop: "2px" }}>
                  Search by filename or content across all indexed PDFs and PPT presentations
                </p>
              </div>
              <button
                onClick={() => setLibraryOpen(false)}
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.08)",
                  color: "#ececec",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1rem",
                }}
              >
                ✕
              </button>
            </div>

            {/* Search Bar & Subject Filters */}
            <div style={{ padding: "14px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "#171717" }}>
              <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
                <div style={{ flex: 1, position: "relative" }}>
                  <input
                    type="text"
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") fetchLibrary(librarySearch);
                    }}
                    placeholder="Search inside documents or by filename (e.g. Backpropagation, Unit 1)..."
                    style={{
                      width: "100%",
                      padding: "10px 14px 10px 38px",
                      background: "#262626",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: "8px",
                      fontSize: "0.88rem",
                      color: "#ececec",
                    }}
                  />
                  <span style={{ position: "absolute", left: "12px", top: "10px", color: "#8e8e8e" }}>🔍</span>
                </div>
                <button
                  onClick={() => fetchLibrary(librarySearch)}
                  style={{
                    padding: "0 18px",
                    background: "#10a37f",
                    color: "#fff",
                    borderRadius: "8px",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                  }}
                >
                  Search
                </button>
                {librarySearch && (
                  <button
                    onClick={() => {
                      setLibrarySearch("");
                      fetchLibrary("");
                    }}
                    style={{
                      padding: "0 12px",
                      background: "rgba(255,255,255,0.08)",
                      color: "#b4b4b4",
                      borderRadius: "8px",
                      fontSize: "0.82rem",
                    }}
                  >
                    Reset
                  </button>
                )}
              </div>

              {/* Subject Filter Chips */}
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: "0.75rem", color: "#8e8e8e", marginRight: "4px" }}>Filter:</span>
                {["All", "NNDL", "CD", "DA", "Lab"].map((subj) => (
                  <button
                    key={subj}
                    onClick={() => setSelectedSubject(subj)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: "999px",
                      fontSize: "0.78rem",
                      fontWeight: 500,
                      background: selectedSubject === subj ? "#3b82f6" : "rgba(255,255,255,0.06)",
                      color: selectedSubject === subj ? "#ffffff" : "#b4b4b4",
                    }}
                  >
                    {subj === "All" ? "All Subjects" : subj}
                  </button>
                ))}
              </div>
            </div>

            {/* Document Cards List */}
            <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px" }}>
              {libraryLoading ? (
                <div style={{ textAlign: "center", padding: "40px", color: "#9ca3af" }}>
                  Searching documents...
                </div>
              ) : filteredLibrary.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px", color: "#9ca3af" }}>
                  No documents found matching "{librarySearch || selectedSubject}".
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
                  {filteredLibrary.map((doc) => {
                    const isPdf = doc.file_type === "pdf" || doc.filename.toLowerCase().endsWith(".pdf");
                    return (
                      <div
                        key={doc.document_id}
                        style={{
                          background: "#242424",
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: "10px",
                          padding: "14px 16px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "14px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "12px", overflow: "hidden" }}>
                          <span style={{ fontSize: "1.4rem" }}>{isPdf ? "📄" : "📊"}</span>
                          <div style={{ overflow: "hidden" }}>
                            <div style={{ fontWeight: 600, fontSize: "0.92rem", color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {doc.filename}
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "3px", display: "flex", alignItems: "center", gap: "8px" }}>
                              <span>{doc.relative_path}</span>
                              {doc.page_count && <span>• {doc.page_count} pages</span>}
                              {doc.slide_count && <span>• {doc.slide_count} slides</span>}
                              {doc.unit && (
                                <span style={{ background: "rgba(59, 130, 246, 0.2)", color: "#93c5fd", padding: "1px 6px", borderRadius: "4px" }}>
                                  {doc.unit}
                                </span>
                              )}
                            </div>

                            {/* Snippets if present */}
                            {doc.snippets && doc.snippets.length > 0 && (
                              <div style={{ marginTop: "6px", fontSize: "0.78rem", color: "#6ee7b7", fontStyle: "italic" }}>
                                {doc.snippets[0]}
                              </div>
                            )}
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                          <button
                            onClick={() => viewFile(doc, doc.first_page || 1)}
                            style={{
                              padding: "6px 12px",
                              background: "#3b82f6",
                              color: "#fff",
                              borderRadius: "6px",
                              fontSize: "0.8rem",
                              fontWeight: 500,
                            }}
                          >
                            View {isPdf ? "PDF" : "Original"}
                          </button>
                          <button
                            onClick={() => downloadFile(doc)}
                            disabled={downloading === doc.document_id}
                            style={{
                              padding: "6px 12px",
                              background: "rgba(255,255,255,0.08)",
                              color: "#ececec",
                              borderRadius: "6px",
                              fontSize: "0.8rem",
                            }}
                          >
                            {downloading === doc.document_id ? "..." : "⬇"}
                          </button>
                          <button
                            onClick={() => {
                              setLibraryOpen(false);
                              setMode("ask");
                              handleSubmit(`Explain the topics covered in ${doc.filename}`, "ask");
                            }}
                            title="Chat about this document"
                            style={{
                              padding: "6px 10px",
                              background: "rgba(16, 163, 127, 0.15)",
                              color: "#10a37f",
                              borderRadius: "6px",
                              fontSize: "0.8rem",
                              border: "1px solid rgba(16, 163, 127, 0.3)",
                            }}
                          >
                            💬 Chat
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
