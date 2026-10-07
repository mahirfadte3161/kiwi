"use client";

import React, { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "./components/ThemeToggle";

const API = "https://kiwi-9w1p.onrender.com"; //"http://localhost:8000";

type Source = {
  document_id: string;
  filename: string;
  file_type?: string;
  relative_path?: string;
  unit?: string;
  locations?: string;
  location?: string;
  view_url?: string;
  download_url?: string;
  preview?: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  sources?: Source[];
};

type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  messages: Message[];
};

// Vercel-Style Clean Markdown & Code Renderer
function MarkdownRenderer({ content }: { content: string }) {
  if (!content) return null;

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let currentList: { type: "ul" | "ol"; items: string[] } | null = null;
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockLang = "";
  let blockIndex = 0;

  const flushList = () => {
    if (!currentList) return;
    if (currentList.type === "ul") {
      elements.push(
        <ul key={`ul-${elements.length}`} style={{ paddingLeft: "1.2rem", margin: "0.5rem 0" }}>
          {currentList.items.map((item, i) => (
            <li key={i} style={{ marginBottom: "0.3rem" }}>
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
    } else {
      elements.push(
        <ol key={`ol-${elements.length}`} style={{ paddingLeft: "1.2rem", margin: "0.5rem 0" }}>
          {currentList.items.map((item, i) => (
            <li key={i} style={{ marginBottom: "0.3rem" }}>
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
    const codeString = codeBlockLines.join("\n");
    const currentIndex = blockIndex++;
    const isCopied = copiedIndex === currentIndex;

    elements.push(
      <div
        key={`code-wrap-${elements.length}`}
        style={{
          margin: "1rem 0",
          borderRadius: "8px",
          overflow: "hidden",
          boxShadow: "var(--shadow)",
          background: "var(--bg-surface)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 12px",
            background: "var(--bg-recessed)",
            borderBottom: "1px solid var(--border-color)",
            fontSize: "0.75rem",
            color: "var(--fg-secondary)",
            fontFamily: "monospace",
          }}
        >
          <span>{codeBlockLang || "code"}</span>
          <button
            onClick={() => copyToClipboard(codeString, currentIndex)}
            style={{
              fontSize: "0.75rem",
              color: isCopied ? "#34D399" : "var(--fg-secondary)",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            {isCopied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre style={{ margin: 0, padding: "0.85rem 1rem", overflowX: "auto" }}>
          <code style={{ color: "var(--fg-primary)", fontSize: "0.85rem" }}>{codeString}</code>
        </pre>
      </div>
    );
    codeBlockLines = [];
    codeBlockLang = "";
    inCodeBlock = false;
  };

  function renderInline(text: string): React.ReactNode {
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
        parts.push(<strong key={match.index} style={{ color: "var(--fg-primary)", fontWeight: 600 }}>{raw.slice(2, -2)}</strong>);
      } else if (raw.startsWith("*") && raw.endsWith("*")) {
        parts.push(<em key={match.index} style={{ color: "var(--fg-secondary)" }}>{raw.slice(1, -1)}</em>);
      } else if (raw.startsWith("`") && raw.endsWith("`")) {
        parts.push(
          <code key={match.index} style={{ background: "var(--bg-recessed)", padding: "0.1rem 0.3rem", borderRadius: "4px", fontSize: "0.86em", fontFamily: "monospace" }}>
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

    if (line.startsWith("```")) {
      if (inCodeBlock) {
        flushCodeBlock();
      } else {
        flushList();
        inCodeBlock = true;
        codeBlockLang = line.replace("```", "").trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    if (line.startsWith("### ")) {
      flushList();
      elements.push(<h3 key={`h3-${i}`} style={{ fontSize: "1.05rem", fontWeight: 600, margin: "1rem 0 0.4rem 0", color: "var(--fg-primary)", letterSpacing: "-0.01em" }}>{renderInline(line.replace("### ", ""))}</h3>);
    } else if (line.startsWith("## ")) {
      flushList();
      elements.push(<h2 key={`h2-${i}`} style={{ fontSize: "1.15rem", fontWeight: 600, margin: "1.1rem 0 0.4rem 0", color: "var(--fg-primary)", letterSpacing: "-0.01em" }}>{renderInline(line.replace("## ", ""))}</h2>);
    } else if (line.startsWith("# ")) {
      flushList();
      elements.push(<h1 key={`h1-${i}`} style={{ fontSize: "1.3rem", fontWeight: 600, margin: "1.25rem 0 0.5rem 0", color: "var(--fg-primary)", letterSpacing: "-0.02em" }}>{renderInline(line.replace("# ", ""))}</h1>);
    } else if (line.startsWith("> ")) {
      flushList();
      elements.push(
        <blockquote key={`bq-${i}`} style={{ borderLeft: "2px solid var(--interactive)", paddingLeft: "1rem", margin: "0.75rem 0", color: "var(--fg-secondary)" }}>
          {renderInline(line.replace("> ", ""))}
        </blockquote>
      );
    } else if (/^(\*|-)\s+/.test(line)) {
      const itemText = line.replace(/^(\*|-)\s+/, "");
      if (!currentList || currentList.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [itemText] };
      } else {
        currentList.items.push(itemText);
      }
    } else if (/^\d+\.\s+/.test(line)) {
      const itemText = line.replace(/^\d+\.\s+/, "");
      if (!currentList || currentList.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [itemText] };
      } else {
        currentList.items.push(itemText);
      }
    } else if (line.trim() === "---") {
      flushList();
      elements.push(<hr key={`hr-${i}`} style={{ border: "none", borderTop: "1px solid var(--border-color)", margin: "1rem 0" }} />);
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      elements.push(<p key={`p-${i}`} style={{ marginBottom: "0.75rem" }}>{renderInline(line)}</p>);
    }
  }

  flushList();
  flushCodeBlock();

  return <div className="markdown-body">{elements}</div>;
}

export default function Home() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initialize or load chats from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("kiwi_chat_sessions");
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

    const defaultSession: ChatSession = {
      id: "session_" + Date.now(),
      title: "New chat",
      createdAt: Date.now(),
      messages: [],
    };
    setSessions([defaultSession]);
    setActiveSessionId(defaultSession.id);
  }, []);

  // Save sessions to localStorage
  useEffect(() => {
    if (sessions.length > 0) {
      try {
        localStorage.setItem("kiwi_chat_sessions", JSON.stringify(sessions));
      } catch {
        // ignore
      }
    }
  }, [sessions]);

  // Scroll to bottom on new messages
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sessions, loading]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  const createNewChat = () => {
    const newSession: ChatSession = {
      id: "session_" + Date.now(),
      title: "New chat",
      createdAt: Date.now(),
      messages: [],
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const deleteChat = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const remaining = sessions.filter((s) => s.id !== id);
    if (remaining.length === 0) {
      const fresh: ChatSession = {
        id: "session_" + Date.now(),
        title: "New chat",
        createdAt: Date.now(),
        messages: [],
      };
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
    } else {
      setSessions(remaining);
      if (activeSessionId === id) {
        setActiveSessionId(remaining[0].id);
      }
    }
  };

  const clearCurrentChat = () => {
    if (!activeSession) return;
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSession.id ? { ...s, messages: [] } : s))
    );
  };

  // Submit Query
  const handleSubmit = async (overridePrompt?: string) => {
    const promptToSend = (overridePrompt || input).trim();
    if (!promptToSend || loading || !activeSession) return;

    const userMessage: Message = {
      id: "msg_" + Date.now(),
      role: "user",
      content: promptToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const updatedMessages = [...activeSession.messages, userMessage];
    const isFirst = activeSession.messages.length === 0;
    const newTitle = isFirst
      ? promptToSend.slice(0, 26) + (promptToSend.length > 26 ? "..." : "")
      : activeSession.title;

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
      const history = updatedMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch(`${API}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: promptToSend, history }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Server returned ${res.status}`);
      }

      const data = await res.json();
      const assistantMessage: Message = {
        id: "msg_" + (Date.now() + 1),
        role: "assistant",
        content: data.answer || "No response generated.",
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
    } catch (err: any) {
      const errMessage: Message = {
        id: "msg_err_" + Date.now(),
        role: "assistant",
        content: `⚠️ **Connection Error**: ${err?.message || "Could not reach the Kiwi backend."}\n\nPlease ensure your backend server is running on \`http://localhost:8000\`.`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? { ...s, messages: [...updatedMessages, errMessage] }
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

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  };

  const samplePrompts = [
    "Explain the Backpropagation algorithm with formulas",
    "Which documents cover Decision Trees vs Random Forests?",
    "Key phases of a Compiler in CD Unit 1",
    "What AWS serverless services were used in internship diary?",
  ];

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", overflow: "hidden", position: "relative", background: "var(--bg-background)", color: "var(--fg-primary)" }}>
      {/* Vercel-Style Sidebar */}
      <aside
        style={{
          width: sidebarOpen ? "260px" : "0px",
          minWidth: sidebarOpen ? "260px" : "0px",
          height: "100%",
          background: "var(--bg-background)",
          boxShadow: sidebarOpen ? "1px 0 0 0 var(--border-color)" : "none",
          display: "flex",
          flexDirection: "column",
          transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          overflow: "hidden",
          zIndex: 30,
        }}
      >
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", height: "100%" }}>
          {/* Brand Header in Sidebar */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 8px 16px 8px" }}>
            <div
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "4px",
                background: "var(--fg-primary)",
                color: "var(--bg-background)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.75rem",
                fontWeight: 600,
              }}
            >
              K
            </div>
            <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--fg-primary)", letterSpacing: "-0.01em" }}>Kiwi AI</span>
            <span style={{ fontSize: "0.7rem", color: "var(--fg-muted)", marginLeft: "auto" }}>v1.0</span>
          </div>

          {/* New Chat Button */}
          <button
            onClick={createNewChat}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 12px",
              borderRadius: "6px",
              background: "var(--bg-surface)",
              boxShadow: "var(--shadow)",
              color: "var(--fg-primary)",
              fontSize: "0.85rem",
              fontWeight: 500,
              width: "100%",
              marginBottom: "16px",
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-surface)")}
          >
            <span style={{ fontSize: "1rem", color: "var(--interactive)", fontWeight: 600 }}>+</span>
            <span>New chat</span>
          </button>

          {/* Conversations Header */}
          <div style={{ fontSize: "0.7rem", color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "0 8px 6px 8px", fontWeight: 500 }}>
            Recent Chats
          </div>

          {/* Session List */}
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
            {sessions.map((s) => {
              const isActive = s.id === activeSession?.id;
              return (
                <div
                  key={s.id}
                  onClick={() => setActiveSessionId(s.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "7px 10px",
                    borderRadius: "6px",
                    fontSize: "0.83rem",
                    cursor: "pointer",
                    color: isActive ? "var(--fg-primary)" : "var(--fg-secondary)",
                    background: isActive ? "var(--bg-hover)" : "transparent",
                    fontWeight: isActive ? 500 : 400,
                    transition: "all 0.1s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = "var(--bg-recessed)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: "170px",
                    }}
                  >
                    {s.title}
                  </span>

                  <button
                    onClick={(e) => deleteChat(s.id, e)}
                    title="Delete chat"
                    style={{
                      opacity: isActive ? 0.7 : 0,
                      color: "var(--fg-muted)",
                      fontSize: "0.75rem",
                      padding: "2px 4px",
                      borderRadius: "4px",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = "1";
                      e.currentTarget.style.color = "#E5484D";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = isActive ? "0.7" : "0";
                      e.currentTarget.style.color = "var(--fg-muted)";
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          {/* Sidebar Footer */}
          <div
            style={{
              paddingTop: "12px",
              boxShadow: "0 -1px 0 0 var(--border-color)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "0.78rem",
              color: "var(--fg-secondary)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#398E4A", display: "inline-block" }} />
              <span style={{ fontSize: "0.78rem", fontWeight: 500 }}>159 documents</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Workspace */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", position: "relative", background: "var(--bg-background)" }}>
        {/* Top Header with ThemeToggle */}
        <header
          style={{
            height: "54px",
            boxShadow: "0 1px 0 0 var(--border-color)",
            background: "var(--bg-background)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 20px",
            zIndex: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title={sidebarOpen ? "Collapse sidebar" : "Open sidebar"}
              className="vercel-button"
              style={{ padding: "5px 8px" }}
            >
              {sidebarOpen ? "◀" : "▶"}
            </button>

            <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--fg-primary)", letterSpacing: "-0.01em" }}>
              {activeSession?.title || "New chat"}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            {activeSession?.messages.length > 0 && (
              <button
                onClick={clearCurrentChat}
                className="vercel-button"
                style={{ fontSize: "0.78rem", padding: "4px 8px" }}
              >
                Clear chat
              </button>
            )}

            {/* INTEGRATED EXACT ANIMATED DAY/NIGHT TOGGLE */}
            <ThemeToggle />
          </div>
        </header>

        {/* Content Stream Area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 0 160px 0" }}>
          {activeSession?.messages.length === 0 ? (
            /* Vercel-Style Minimal Welcome */
            <div
              className="animate-fade-in"
              style={{
                maxWidth: "680px",
                margin: "40px auto 0 auto",
                padding: "0 20px",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <h1 style={{ fontSize: "2rem", fontWeight: 600, color: "var(--fg-primary)", letterSpacing: "-0.025em", marginBottom: "8px" }}>
                Ask Kiwi.
              </h1>
              <p style={{ fontSize: "0.95rem", color: "var(--fg-secondary)", marginBottom: "32px", lineHeight: 1.5 }}>
                Semantic search across your Semester 7 study documents. Answers are generated with exact citations, source previews, and direct document access.
              </p>

              {/* Sample Prompts */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ fontSize: "0.72rem", color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500, marginBottom: "2px" }}>
                  Suggested queries
                </div>
                {samplePrompts.map((promptText, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSubmit(promptText)}
                    className="vercel-card"
                    style={{
                      padding: "12px 16px",
                      textAlign: "left",
                      color: "var(--fg-primary)",
                      fontSize: "0.875rem",
                      fontWeight: 400,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      transition: "box-shadow 0.15s ease, background 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = "0 0 0 1px var(--interactive)";
                      e.currentTarget.style.background = "var(--bg-surface)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = "var(--shadow)";
                      e.currentTarget.style.background = "var(--bg-surface)";
                    }}
                  >
                    <span>{promptText}</span>
                    <span style={{ color: "var(--interactive)", fontSize: "0.85rem" }}>→</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Chat Messages */
            <div style={{ maxWidth: "760px", margin: "0 auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: "32px" }}>
              {activeSession?.messages.map((msg) => {
                const isUser = msg.role === "user";
                return (
                  <div key={msg.id} className="animate-fade-in" style={{ display: "flex", flexDirection: "column" }}>
                    {isUser ? (
                      /* User Question */
                      <div style={{ alignSelf: "flex-end", maxWidth: "85%" }}>
                        <div
                          style={{
                            background: "var(--fg-primary)",
                            color: "var(--bg-background)",
                            padding: "10px 16px",
                            borderRadius: "12px 12px 2px 12px",
                            fontSize: "0.92rem",
                            lineHeight: 1.5,
                            wordBreak: "break-word",
                          }}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      /* Assistant Answer & Sources */
                      <div style={{ display: "flex", flexDirection: "column", width: "100%", gap: "16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div
                            style={{
                              width: "20px",
                              height: "20px",
                              borderRadius: "4px",
                              background: "var(--interactive)",
                              color: "#FFFFFF",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "0.7rem",
                              fontWeight: 600,
                            }}
                          >
                            K
                          </div>
                          <span style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--fg-secondary)" }}>Kiwi Assistant</span>
                          <span style={{ fontSize: "0.72rem", color: "var(--fg-muted)", marginLeft: "auto" }}>{msg.timestamp}</span>
                        </div>

                        {/* Answer Text */}
                        <div style={{ paddingLeft: "28px" }}>
                          <MarkdownRenderer content={msg.content} />
                        </div>

                        {/* Source Document Cards */}
                        {msg.sources && msg.sources.length > 0 && (
                          <div style={{ paddingLeft: "28px", marginTop: "4px" }}>
                            <div style={{ fontSize: "0.72rem", color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px", fontWeight: 500 }}>
                              Retrieved Sources ({msg.sources.length})
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              {msg.sources.map((src, sIdx) => {
                                const locText = src.location || src.locations || "";
                                const isPdf = src.file_type === "pdf" || src.filename.toLowerCase().endsWith(".pdf");
                                let pageNum: string | undefined = undefined;
                                const match = locText.match(/\d+/);
                                if (match) pageNum = match[0];

                                const base = src.download_url || `/documents/${encodeURIComponent(src.document_id)}/file`;
                                const viewUrl = `${API}${base}${isPdf && pageNum ? `#page=${pageNum}` : ""}`;
                                const downloadUrl = `${API}${base}`;

                                return (
                                  <div
                                    key={sIdx}
                                    className="vercel-panel"
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      padding: "10px 14px",
                                      gap: "12px",
                                    }}
                                  >
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 }}>
                                      <span style={{ fontSize: "1rem", color: "var(--fg-muted)", flexShrink: 0 }}>📄</span>
                                      <div style={{ minWidth: 0, flex: 1 }}>
                                        <div
                                          style={{
                                            fontWeight: 500,
                                            color: "var(--fg-primary)",
                                            fontSize: "0.85rem",
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                          }}
                                          title={src.filename}
                                        >
                                          {src.filename}
                                        </div>
                                        {locText && (
                                          <div style={{ fontSize: "0.72rem", color: "var(--interactive)", marginTop: "1px", fontWeight: 500 }}>
                                            {locText}
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                                      <a
                                        href={viewUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="vercel-button"
                                        style={{ fontSize: "0.78rem", padding: "4px 10px", color: "var(--interactive)" }}
                                      >
                                        <span>Open</span>
                                        <span style={{ fontSize: "0.7rem" }}>↗</span>
                                      </a>

                                      <a
                                        href={downloadUrl}
                                        download={src.filename}
                                        className="vercel-button"
                                        style={{ fontSize: "0.78rem", padding: "4px 10px" }}
                                      >
                                        <span>Download</span>
                                        <span style={{ fontSize: "0.7rem" }}>↓</span>
                                      </a>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Loading Indicator */}
              {loading && (
                <div className="animate-fade-in" style={{ display: "flex", gap: "12px", alignItems: "center", paddingLeft: "4px" }}>
                  <div
                    style={{
                      width: "20px",
                      height: "20px",
                      borderRadius: "4px",
                      background: "var(--interactive)",
                      color: "#FFFFFF",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.7rem",
                      fontWeight: 600,
                    }}
                  >
                    K
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "var(--fg-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>Searching documents & generating answer</span>
                    <div className="loading-dots">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>
          )}
        </div>

        {/* Vercel-Style Floating Input Dock */}
        <div
          style={{
            position: "absolute",
            bottom: "0",
            left: "0",
            right: "0",
            padding: "16px 20px 24px 20px",
            background: "linear-gradient(to top, var(--bg-background) 75%, transparent)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            pointerEvents: "none",
          }}
        >
          <div
            className="vercel-card"
            style={{
              width: "100%",
              maxWidth: "720px",
              background: "var(--bg-surface)",
              borderRadius: "12px",
              padding: "10px 12px 10px 16px",
              display: "flex",
              alignItems: "flex-end",
              gap: "10px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.12), var(--shadow)",
              pointerEvents: "auto",
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder="Ask Kiwi about your notes (e.g. Find CD experiment 630)..."
              rows={1}
              style={{
                flex: 1,
                fontSize: "0.92rem",
                color: "var(--fg-primary)",
                resize: "none",
                maxHeight: "160px",
                lineHeight: 1.5,
                padding: "4px 0",
              }}
            />

            <button
              onClick={() => handleSubmit()}
              disabled={!input.trim() || loading}
              className={input.trim() && !loading ? "vercel-button-primary" : "vercel-button"}
              style={{
                width: "32px",
                height: "32px",
                padding: 0,
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                background: input.trim() && !loading ? "var(--interactive)" : "var(--bg-recessed)",
                color: input.trim() && !loading ? "#FFFFFF" : "var(--fg-muted)",
                cursor: input.trim() && !loading ? "pointer" : "default",
              }}
            >
              ↑
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
