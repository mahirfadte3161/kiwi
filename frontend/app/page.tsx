"use client";

import React, { useEffect, useRef, useState } from "react";

const API = "http://localhost:8000";

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

// Clean ChatGPT-style Markdown & Code Renderer
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
        <ul key={`ul-${elements.length}`} style={{ paddingLeft: "1.4rem", margin: "0.6rem 0" }}>
          {currentList.items.map((item, i) => (
            <li key={i} style={{ marginBottom: "0.35rem" }}>
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
    } else {
      elements.push(
        <ol key={`ol-${elements.length}`} style={{ paddingLeft: "1.4rem", margin: "0.6rem 0" }}>
          {currentList.items.map((item, i) => (
            <li key={i} style={{ marginBottom: "0.35rem" }}>
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
          borderRadius: "10px",
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.1)",
          background: "#090a0f",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 14px",
            background: "rgba(255,255,255,0.04)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            fontSize: "0.78rem",
            color: "#9ca3af",
          }}
        >
          <span>{codeBlockLang || "code"}</span>
          <button
            onClick={() => copyToClipboard(codeString, currentIndex)}
            style={{
              fontSize: "0.75rem",
              color: isCopied ? "#10a37f" : "#9ca3af",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            {isCopied ? "✓ Copied" : "Copy"}
          </button>
        </div>
        <pre style={{ margin: 0, padding: "0.9rem 1.1rem", overflowX: "auto" }}>
          <code>{codeString}</code>
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
        parts.push(<strong key={match.index} style={{ color: "#ffffff", fontWeight: 600 }}>{raw.slice(2, -2)}</strong>);
      } else if (raw.startsWith("*") && raw.endsWith("*")) {
        parts.push(<em key={match.index} style={{ color: "#d1d5db" }}>{raw.slice(1, -1)}</em>);
      } else if (raw.startsWith("`") && raw.endsWith("`")) {
        parts.push(
          <code key={match.index}>
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
      elements.push(<h3 key={`h3-${i}`}>{renderInline(line.replace("### ", ""))}</h3>);
    } else if (line.startsWith("## ")) {
      flushList();
      elements.push(<h2 key={`h2-${i}`}>{renderInline(line.replace("## ", ""))}</h2>);
    } else if (line.startsWith("# ")) {
      flushList();
      elements.push(<h1 key={`h1-${i}`}>{renderInline(line.replace("# ", ""))}</h1>);
    } else if (line.startsWith("> ")) {
      flushList();
      elements.push(
        <blockquote key={`bq-${i}`}>
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
      elements.push(<hr key={`hr-${i}`} />);
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      elements.push(<p key={`p-${i}`}>{renderInline(line)}</p>);
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

  const openSourceDocument = (source: Source) => {
    const isPdf = source.file_type === "pdf" || source.filename.toLowerCase().endsWith(".pdf");
    let pageNum: string | undefined = undefined;
    const loc = source.location || source.locations || "";
    const match = loc.match(/\d+/);
    if (match) pageNum = match[0];

    const base = source.download_url || `/documents/${encodeURIComponent(source.document_id)}/file`;
    const fullUrl = `${API}${base}${isPdf && pageNum ? `#page=${pageNum}` : ""}`;
    window.open(fullUrl, "_blank", "noopener,noreferrer");
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
    e.target.style.height = Math.min(e.target.scrollHeight, 180) + "px";
  };

  const samplePrompts = [
    "Explain the Backpropagation algorithm with step-by-step formulas",
    "Which documents cover Decision Trees vs Random Forests?",
    "Key phases of a Compiler in CD Unit 1",
    "What AWS serverless services were used in the internship diary?",
  ];

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}>
      {/* Sleek Glassmorphism Collapsible Sidebar */}
      <aside
        style={{
          width: sidebarOpen ? "var(--sidebar-w)" : "0px",
          minWidth: sidebarOpen ? "var(--sidebar-w)" : "0px",
          height: "100%",
          background: "rgba(14, 16, 22, 0.85)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderRight: "1px solid rgba(255, 255, 255, 0.07)",
          display: "flex",
          flexDirection: "column",
          transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          overflow: "hidden",
          zIndex: 30,
        }}
      >
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", height: "100%" }}>
          {/* New Chat Button */}
          <button
            onClick={createNewChat}
            className="glass-panel-hover"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 14px",
              borderRadius: "10px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.09)",
              color: "#f3f4f6",
              fontSize: "0.88rem",
              fontWeight: 500,
              width: "100%",
              marginBottom: "16px",
            }}
          >
            <span style={{ fontSize: "1.1rem", color: "var(--kiwi-green)" }}>+</span>
            <span>New chat</span>
          </button>

          {/* Chat History Header */}
          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 8px 8px 8px" }}>
            Conversations
          </div>

          {/* Session List */}
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "3px" }}>
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
                    padding: "9px 12px",
                    borderRadius: "8px",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    color: isActive ? "#ffffff" : "#9ca3af",
                    background: isActive ? "rgba(255, 255, 255, 0.08)" : "transparent",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
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
                      maxWidth: "180px",
                    }}
                  >
                    {s.title}
                  </span>

                  <button
                    onClick={(e) => deleteChat(s.id, e)}
                    title="Delete chat"
                    style={{
                      opacity: isActive ? 0.7 : 0,
                      color: "#9ca3af",
                      fontSize: "0.85rem",
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = "1";
                      e.currentTarget.style.color = "#f87171";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = isActive ? "0.7" : "0";
                      e.currentTarget.style.color = "#9ca3af";
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
              paddingTop: "14px",
              borderTop: "1px solid rgba(255, 255, 255, 0.07)",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              fontSize: "0.82rem",
              color: "#9ca3af",
            }}
          >
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                background: "rgba(16, 163, 127, 0.15)",
                border: "1px solid rgba(16, 163, 127, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.95rem",
              }}
            >
              🥝
            </div>
            <div>
              <div style={{ color: "#ffffff", fontWeight: 600, fontSize: "0.84rem" }}>KIWI AI</div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Academic Document Agent</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Chat Interface */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
        {/* Top Navbar */}
        <header
          style={{
            height: "54px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            background: "rgba(15, 16, 21, 0.6)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 20px",
            zIndex: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title={sidebarOpen ? "Collapse sidebar" : "Open sidebar"}
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#9ca3af",
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.06)",
              }}
            >
              {sidebarOpen ? "◀" : "▶"}
            </button>

            <span style={{ fontSize: "0.92rem", fontWeight: 600, color: "#ffffff" }}>
              {activeSession?.title || "Kiwi Chat"}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span
              style={{
                fontSize: "0.74rem",
                color: "var(--kiwi-green)",
                background: "rgba(16, 163, 127, 0.1)",
                border: "1px solid rgba(16, 163, 127, 0.2)",
                padding: "3px 9px",
                borderRadius: "999px",
                fontWeight: 500,
              }}
            >
              • 159 docs loaded
            </span>

            {activeSession?.messages.length > 0 && (
              <button
                onClick={clearCurrentChat}
                title="Clear messages"
                style={{
                  fontSize: "0.78rem",
                  color: "#9ca3af",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  background: "rgba(255, 255, 255, 0.04)",
                }}
              >
                Clear
              </button>
            )}
          </div>
        </header>

        {/* Message Feed Area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 0 160px 0" }}>
          {activeSession?.messages.length === 0 ? (
            /* Minimal ChatGPT-Style Welcome Hero */
            <div
              className="animate-fade-in"
              style={{
                maxWidth: "760px",
                margin: "0 auto",
                padding: "40px 20px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
              }}
            >
              {/* Glowing Kiwi Glass Icon */}
              <div
                style={{
                  width: "60px",
                  height: "60px",
                  borderRadius: "18px",
                  background: "rgba(16, 163, 127, 0.1)",
                  border: "1px solid rgba(16, 163, 127, 0.3)",
                  boxShadow: "0 0 35px var(--kiwi-green-glow)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "2rem",
                  marginBottom: "20px",
                }}
              >
                🥝
              </div>

              <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#ffffff", marginBottom: "8px" }}>
                What would you like to study?
              </h1>
              <p style={{ fontSize: "0.92rem", color: "var(--text-secondary)", maxWidth: "520px", marginBottom: "36px", lineHeight: 1.5 }}>
                Ask any question about your Semester 7 courses. Answers are synthesized directly with exact references from your notes.
              </p>

              {/* Minimal Prompt Suggestions Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "10px", width: "100%" }}>
                {samplePrompts.map((promptText, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSubmit(promptText)}
                    className="glass-panel glass-panel-hover"
                    style={{
                      padding: "14px 16px",
                      borderRadius: "12px",
                      textAlign: "left",
                      color: "#d1d5db",
                      fontSize: "0.85rem",
                      lineHeight: 1.45,
                    }}
                  >
                    <span style={{ color: "var(--kiwi-green)", marginRight: "8px" }}>→</span>
                    <span>{promptText}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Conversation Stream */
            <div style={{ maxWidth: "800px", margin: "0 auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: "28px" }}>
              {activeSession?.messages.map((msg) => {
                const isUser = msg.role === "user";
                return (
                  <div key={msg.id} className="animate-fade-in" style={{ display: "flex", flexDirection: "column" }}>
                    {isUser ? (
                      /* User Message Bubble */
                      <div style={{ alignSelf: "flex-end", maxWidth: "80%" }}>
                        <div
                          style={{
                            background: "rgba(35, 40, 52, 0.75)",
                            backdropFilter: "blur(12px)",
                            WebkitBackdropFilter: "blur(12px)",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            padding: "12px 18px",
                            borderRadius: "18px 18px 4px 18px",
                            color: "#ffffff",
                            fontSize: "0.95rem",
                            lineHeight: 1.55,
                            wordBreak: "break-word",
                          }}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      /* Assistant Message (ChatGPT style) */
                      <div style={{ display: "flex", gap: "14px", alignItems: "flex-start", width: "100%" }}>
                        <div
                          style={{
                            width: "30px",
                            height: "30px",
                            borderRadius: "50%",
                            background: "rgba(16, 163, 127, 0.15)",
                            border: "1px solid rgba(16, 163, 127, 0.3)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "1rem",
                            flexShrink: 0,
                            marginTop: "2px",
                          }}
                        >
                          🥝
                        </div>

                        <div style={{ flex: 1, overflow: "hidden" }}>
                          <MarkdownRenderer content={msg.content} />

                          {/* Minimal Glassmorphic Source Pills */}
                          {msg.sources && msg.sources.length > 0 && (
                            <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px solid rgba(255, 255, 255, 0.07)" }}>
                              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
                                Referenced Course Documents
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                {msg.sources.map((src, sIdx) => {
                                  const locText = src.location || src.locations || "";
                                  return (
                                    <button
                                      key={sIdx}
                                      onClick={() => openSourceDocument(src)}
                                      className="glass-pill"
                                      title="Open original document at referenced page"
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "6px",
                                        padding: "5px 10px",
                                        borderRadius: "999px",
                                        fontSize: "0.78rem",
                                        color: "#cbd5e1",
                                      }}
                                    >
                                      <span>📄</span>
                                      <span style={{ fontWeight: 500, color: "#ffffff" }}>{src.filename}</span>
                                      {locText && (
                                        <span style={{ color: "var(--kiwi-green)", fontSize: "0.75rem" }}>
                                          • {locText}
                                        </span>
                                      )}
                                      <span style={{ fontSize: "0.7rem", opacity: 0.6 }}>↗</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Generating / Loading indicator */}
              {loading && (
                <div className="animate-fade-in" style={{ display: "flex", gap: "14px", alignItems: "center" }}>
                  <div
                    style={{
                      width: "30px",
                      height: "30px",
                      borderRadius: "50%",
                      background: "rgba(16, 163, 127, 0.15)",
                      border: "1px solid rgba(16, 163, 127, 0.3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1rem",
                      flexShrink: 0,
                    }}
                  >
                    🥝
                  </div>
                  <div className="loading-dots" style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>
          )}
        </div>

        {/* Floating Glassmorphic Input Dock (ChatGPT Style) */}
        <div
          style={{
            position: "absolute",
            bottom: "0",
            left: "0",
            right: "0",
            padding: "16px 20px 22px 20px",
            background: "linear-gradient(to top, var(--bg-deep) 70%, transparent)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "760px",
              background: "rgba(24, 27, 36, 0.78)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid rgba(255, 255, 255, 0.11)",
              borderRadius: "24px",
              padding: "10px 14px 10px 18px",
              display: "flex",
              alignItems: "flex-end",
              gap: "10px",
              boxShadow: "0 10px 30px rgba(0, 0, 0, 0.4)",
              pointerEvents: "auto",
              transition: "border-color 0.2s ease, box-shadow 0.2s ease",
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder="Ask Kiwi about your semester notes..."
              rows={1}
              style={{
                flex: 1,
                fontSize: "0.95rem",
                color: "#ffffff",
                resize: "none",
                maxHeight: "180px",
                lineHeight: 1.5,
                padding: "4px 0",
              }}
            />

            <button
              onClick={() => handleSubmit()}
              disabled={!input.trim() || loading}
              style={{
                width: "34px",
                height: "34px",
                borderRadius: "50%",
                background: input.trim() && !loading ? "var(--kiwi-green)" : "rgba(255, 255, 255, 0.08)",
                color: input.trim() && !loading ? "#ffffff" : "#6b7280",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1rem",
                fontWeight: 600,
                flexShrink: 0,
                boxShadow: input.trim() && !loading ? "0 0 14px var(--kiwi-green-glow)" : "none",
              }}
            >
              ↑
            </button>
          </div>

          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "8px", pointerEvents: "auto" }}>
            Kiwi AI synthesizes answers directly from your Semester 7 course materials.
          </div>
        </div>
      </main>
    </div>
  );
}
