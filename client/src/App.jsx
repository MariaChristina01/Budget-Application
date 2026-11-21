import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase.js";

const EXPENSE_CATEGORIES = ["Food", "Transport", "Shopping", "Bills", "Health", "Fun", "Other"];
const INCOME_CATEGORIES = ["Salary", "Allowance", "Other"];
const categoryMeta = {
  Food: { color: "#ef9d6f", icon: <path d="M7 3v7m3-7v7M7 7h3m-1.5 3v11M16 3v18m0-18c3 2 3 7 0 9" /> },
  Transport: { color: "#77a9a1", icon: <path d="M5 17h14M6 14l1.5-7h9l1.5 7M5 14h14v4H5zM8 18v2m8-2v2M8 10h8" /> },
  Shopping: { color: "#d99baa", icon: <path d="M6 8h12l1 13H5L6 8Zm3 0V6a3 3 0 0 1 6 0v2" /> },
  Bills: { color: "#a592d5", icon: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6" /> },
  Health: { color: "#68a4a5", icon: <path d="M12 21s-8-4.5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.5-8 11-8 11Zm-4-9h2l1-2 2 4 1-2h2" /> },
  Fun: { color: "#c18db4", icon: <path d="M12 3v18M5 7h14M7 7l-4 7h8L7 7Zm10 0-4 7h8l-4-7ZM6 21h12" /> },
  Other: { color: "#8c9ba1", icon: <><circle cx="12" cy="12" r="9" /><path d="M8 12h8m-4-4v8" /></> },
  Salary: { color: "#e5b63c", icon: <path d="M12 3v18m4-14H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H7" /> },
  Allowance: { color: "#e5b63c", icon: <path d="M12 3v18m4-14H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H7" /> },
  Income: { color: "#e5b63c", icon: <path d="M12 3v18m4-14H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H7" /> },
};

const peso = (value) => new Intl.NumberFormat("en-PH", {
  style: "currency", currency: "PHP", maximumFractionDigits: 2,
}).format(Number(value) || 0);
const readPage = () => {
  const page = window.location.pathname.replace(/^\/+|\/+$/g, "");
  return ["transactions", "insights", "bills", "settings"].includes(page) ? page : "overview";
};
const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const parseBillScreenshot = (text) => {
  const section = text.match(/(?:upcoming\s+bill|monthly\s+repayment\s+details)/i);
  const billText = section ? text.slice(section.index + section[0].length) : text;
  const dateToken = "(20\\d{2}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}[-/]\\d{1,2}[-/]\\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{1,2}(?:,?\\s+20\\d{2})?|\\d{1,2}\\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\\s+20\\d{2})?)";
  const dueContexts = [...billText.matchAll(new RegExp(`(?:due\\s*date|payment\\s+due|due\\s+on|pay\\s+by)[\\s\\S]{0,35}?(${dateToken})`, "gi"))];
  let cursor = 0;
  return dueContexts.flatMap((context) => {
    const block = billText.slice(cursor, context.index + context[0].length);
    cursor = context.index + context[0].length;
    if (/\bpaid\b/i.test(block)) return [];
    const amountMatches = [...block.matchAll(/(?:PHP|\u20B1)?\s*([\d,]+\.\d{2})/gi)];
    const amount = amountMatches.length ? Number(amountMatches.at(-1)[1].replace(/,/g, "")) : null;
    const dateText = context[1];
    let dueDate = "";
    const iso = dateText.match(/^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})$/);
    const numeric = dateText.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
    if (iso) dueDate = `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
    else if (numeric) {
      const first = Number(numeric[1]);
      const second = Number(numeric[2]);
      const day = first > 12 ? first : second > 12 ? second : first;
      const month = first > 12 ? second : second > 12 ? first : second;
      let year = Number(numeric[3]);
      if (year < 100) year += 2000;
      dueDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    } else {
      const parsed = new Date(dateText);
      if (!Number.isNaN(parsed.valueOf())) dueDate = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }
    return [{ name: "SPayLater installment", amount: Number.isFinite(amount) && amount > 0 ? amount : "", due_date: dueDate }];
  });
};
const monthLabel = (month) => new Date(`${month}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
const dueMonthLabel = (date) => date
  ? new Date(`${date}T12:00:00`).toLocaleDateString("en-PH", { month: "long", year: "numeric" })
  : "Choose due month";
const errorText = (error) => error?.message || "Something went wrong. Please try again.";

let refreshInFlight;

async function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = supabase.auth.refreshSession().then(({ data, error }) => {
      if (error) {
        const invalidRefresh = error.status === 400 || /invalid_grant|refresh token.*(invalid|expired|not found)/i.test(`${error.code || ""} ${error.message || ""}`);
        if (invalidRefresh) {
          void supabase.auth.signOut({ scope: "local" });
          throw new Error("Your session has expired. Please sign in again.");
        }
        throw error;
      }
      if (!data.session?.access_token) throw new Error("Your session has expired. Please sign in again.");
      return data.session.access_token;
    }).finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function fetchWithSession(url, fallbackToken, options) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  let token = data.session?.access_token || fallbackToken;
  if (!token) throw new Error("Please sign in to continue.");
  const expiresAt = data.session?.expires_at;
  if (expiresAt && expiresAt * 1000 <= Date.now() + 30_000) token = await refreshAccessToken();

  const request = () => {
    const headers = { ...(options?.headers || {}), Authorization: `Bearer ${token}` };
    if (options?.body) headers["Content-Type"] = "application/json";
    return fetch(url, { ...options, headers });
  };
  let response = await request();
  if (response.status === 401) {
    token = await refreshAccessToken();
    response = await request();
  }
  return response;
}

async function api(url, token, options) {
  const response = await fetchWithSession(url, token, options);
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Request failed");
  return response.status === 204 ? null : response.json();
}

function Icon({ name, size = 20 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    wallet: <><path d="M4 7h15a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h13v4" /><path d="M16 12h5v4h-5a2 2 0 0 1 0-4Z" /></>,
    bills: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6m-6 4h6m-6 4h4" /></>,
    chart: <path d="M4 20V10m6 10V4m6 16v-7m6 7H2" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.04.04-2.8 2.8-.04-.04a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.1 1.65V21h-4v-.06A1.8 1.8 0 0 0 8.7 19.3a1.8 1.8 0 0 0-2 .36l-.04.04-2.8-2.8.04-.04a1.8 1.8 0 0 0 .36-2A1.8 1.8 0 0 0 2.6 13H2v-4h.06A1.8 1.8 0 0 0 3.7 7.9a1.8 1.8 0 0 0-.36-2l-.04-.04 2.8-2.8.04.04a1.8 1.8 0 0 0 2 .36A1.8 1.8 0 0 0 9.8 1.8V2h4v.06a1.8 1.8 0 0 0 1.1 1.65 1.8 1.8 0 0 0 2-.36l.04-.04 2.8 2.8-.04.04a1.8 1.8 0 0 0-.36 2A1.8 1.8 0 0 0 21 9.8V10h1v4h-.94A1.8 1.8 0 0 0 19.4 15Z" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M5 21h14" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function CategoryIcon({ category }) {
  const meta = categoryMeta[category] || categoryMeta.Other;
  return <span className="category-icon" style={{ backgroundColor: `${meta.color}22`, color: meta.color }}>
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{meta.icon}</svg>
  </span>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    }).catch(() => setAuthLoading(false));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (authLoading) return <main className="auth-shell"><p>Loading your account…</p></main>;
  if (!session) return <AuthPage />;
  return <Dashboard session={session} />;
}

function AuthPage() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (signInError) throw signInError;
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(), password, options: { emailRedirectTo: window.location.origin },
        });
        if (signUpError) throw signUpError;
        if (!data.session) setMessage("Check your email for a confirmation link, then sign in.");
      }
    } catch (errorValue) { setError(errorText(errorValue)); }
    finally { setBusy(false); }
  };

  return <main className="auth-shell">
    <section className="auth-card">
      <p className="eyebrow">Everyday Budget</p>
      <h1>{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
      <p className="auth-intro">Sign in to see and manage your budget.</p>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {message && <p className="auth-notice" role="status">{message}</p>}
      <form className="auth-form" onSubmit={submit}>
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<div className="password-input-wrap"><input type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /><button className="password-toggle" type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? "Hide" : "Show"}</button></div></label>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button>
      </form>
      <p className="auth-switch">{mode === "signin" ? "New here?" : "Already have an account?"}{" "}
        <button type="button" disabled={busy} onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setMessage(""); }}>
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </section>
  </main>;
}

function Dashboard({ session }) {
  const token = session.access_token;
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState({ budget: 0, budgetMode: "automatic", spent: 0, income: 0, byCategory: [] });
  const [budgetDraft, setBudgetDraft] = useState("0");
  const [showBudgetInput, setShowBudgetInput] = useState(false);
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryType, setEntryType] = useState("exp");
  const [search, setSearch] = useState("");
  const [transactionTypeFilter, setTransactionTypeFilter] = useState("all");
  const [transactionCategoryFilter, setTransactionCategoryFilter] = useState("all");
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [activeNav, setActiveNav] = useState(readPage);
  const [error, setError] = useState("");
  const [savingEntry, setSavingEntry] = useState(false);
  const [savingBudget, setSavingBudget] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [nameDraft, setNameDraft] = useState(session.user.user_metadata?.display_name || session.user.email?.split("@")[0] || "");
  const [savingName, setSavingName] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef(null);
  const [bills, setBills] = useState([]);
  const [installments, setInstallments] = useState([]);
  const [installmentDrafts, setInstallmentDrafts] = useState([]);
  const [savingInstallments, setSavingInstallments] = useState(false);
  const [payingInstallmentId, setPayingInstallmentId] = useState(null);
  const [deletingInstallmentId, setDeletingInstallmentId] = useState(null);
  const [billDraft, setBillDraft] = useState({ name: "", amount: "", category: "Bills", due_day: "1" });
  const [showBillForm, setShowBillForm] = useState(false);
  const [editingBill, setEditingBill] = useState(null);
  const [billError, setBillError] = useState("");
  const [billScanMessage, setBillScanMessage] = useState("");
  const [scanningBill, setScanningBill] = useState(false);
  const billScanInputRef = useRef(null);
  const [savingBill, setSavingBill] = useState(false);
  const [payingBillId, setPayingBillId] = useState(null);
  const [deletingBillId, setDeletingBillId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [rows, totals] = await Promise.all([
        api(`/api/transactions?month=${month}`, token),
        api(`/api/summary?month=${month}`, token),
      ]);
      setEntries(rows);
      setSummary(totals);
      setBudgetDraft(totals.budgetMode === "automatic" ? "0" : String(totals.budget));
      setError("");
    } catch (errorValue) { setError(errorText(errorValue)); }
  }, [month, token]);
  useEffect(() => { load(); }, [load]);
  const loadBills = useCallback(async () => {
    try {
      const result = await api("/api/bills", token);
      setBills(result);
      setBillError("");
    } catch (errorValue) { setBillError(errorText(errorValue)); }
  }, [token]);
  useEffect(() => { loadBills(); }, [loadBills]);
  const loadInstallments = useCallback(async () => {
    try { setInstallments(await api("/api/installments", token)); }
    catch (errorValue) { setBillError(errorText(errorValue)); }
  }, [token]);
  useEffect(() => { loadInstallments(); }, [loadInstallments]);
  useEffect(() => {
    const onPopState = () => setActiveNav(readPage());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setShowEntryForm(false); setSelectedEntry(null); setShowNotifications(false); setShowAccountMenu(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const totalIncome = summary.income;
  const spent = summary.spent;
  const budget = Number(summary.budget) || 0;
  const automaticBudget = summary.budgetMode !== "custom";
  const remaining = budget - spent;
  const spentPercentage = budget > 0 ? Math.min(Math.round((spent / budget) * 100), 100) : spent > 0 ? 100 : 0;
  const monthName = monthLabel(month);
  const displayName = session.user.user_metadata?.display_name || session.user.email?.split("@")[0] || "Your account";
  const initials = displayName.split(/[ ._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "U";
  const avatarPath = session.user.user_metadata?.avatar_path;
  const avatarUrl = avatarPath ? supabase.storage.from("avatars").getPublicUrl(avatarPath).data.publicUrl : "";
  const avatar = (className = "avatar") => avatarUrl
    ? <img className={className} src={avatarUrl} alt={`${displayName}'s profile`} />
    : <span className={className} aria-label={`${displayName}'s profile`}>{initials}</span>;
  const status = spent > budget ? "Over budget" : budget === 0 ? "Add income" : spentPercentage >= 80 ? "Near limit" : "On track";
  const today = localDate();
  const todayDate = new Date(`${today}T12:00:00`);
  const currentMonth = today.slice(0, 7);
  const recurringBillReminders = bills.flatMap((bill) => {
    if (bill.last_paid_month === currentMonth) return [];
    const dueDay = Math.min(Number(bill.due_day), new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0).getDate());
    const dueDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), dueDay, 12);
    const daysUntilDue = Math.round((dueDate - todayDate) / 86400000);
    return daysUntilDue <= 3 ? [{ ...bill, kind: "recurring", daysUntilDue }] : [];
  });
  const installmentReminders = installments.flatMap((installment) => {
    if (installment.paid) return [];
    const dueDate = new Date(`${installment.due_date}T12:00:00`);
    const daysUntilDue = Math.round((dueDate - todayDate) / 86400000);
    return daysUntilDue <= 3 ? [{ ...installment, kind: "installment", daysUntilDue }] : [];
  });
  const dueBillReminders = [...recurringBillReminders, ...installmentReminders].sort((a, b) => a.daysUntilDue - b.daysUntilDue);

  const categoryRows = useMemo(() => {
    const values = new Map(summary.byCategory.map((item) => [item.category, Number(item.total)]));
    const names = [...new Set([...EXPENSE_CATEGORIES, ...values.keys()])];
    return names.map((name) => ({ name, spent: values.get(name) || 0 }))
      .sort((a, b) => b.spent - a.spent);
  }, [summary.byCategory]);
  const matchingEntries = useMemo(() => entries.filter((entry) =>
    `${entry.note} ${entry.category}`.toLowerCase().includes(search.toLowerCase())), [entries, search]);
  const filteredEntries = useMemo(() => matchingEntries.filter((entry) =>
    (transactionTypeFilter === "all" || entry.type === transactionTypeFilter)
    && (transactionCategoryFilter === "all" || entry.category === transactionCategoryFilter)),
  [matchingEntries, transactionTypeFilter, transactionCategoryFilter]);
  const visibleEntries = activeNav === "transactions" ? filteredEntries : matchingEntries.slice(0, 5);
  const filteredTotals = useMemo(() => filteredEntries.reduce((totals, entry) => {
    if (entry.type === "inc") totals.income += Number(entry.amount);
    else totals.expenses += Number(entry.amount);
    return totals;
  }, { income: 0, expenses: 0 }), [filteredEntries]);
  const transactionCategories = useMemo(() => [...new Set(entries.map((entry) => entry.category))].sort(), [entries]);
  const dailySpend = useMemo(() => {
    const [year, monthNumber] = month.split("-").map(Number);
    const numberOfDays = new Date(year, monthNumber, 0).getDate();
    const buckets = Array.from({ length: 14 }, (_, index) => {
      const firstDay = Math.floor(index * numberOfDays / 14) + 1;
      const lastDay = Math.floor((index + 1) * numberOfDays / 14);
      const total = entries.reduce((sum, entry) => {
        const day = Number(entry.date.slice(-2));
        return entry.type === "exp" && day >= firstDay && day <= lastDay ? sum + Number(entry.amount) : sum;
      }, 0);
      return { firstDay, lastDay, total };
    });
    const max = Math.max(...buckets.map((item) => item.total), 0);
    const activeDays = new Set(entries.filter((entry) => entry.type === "exp").map((entry) => entry.date)).size;
    const average = activeDays ? spent / activeDays : 0;
    return { buckets, max, average, activeDays, numberOfDays };
  }, [entries, month, spent]);

  const navigate = (section) => {
    const path = section === "overview" ? "/" : `/${section}`;
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setActiveNav(section);
    setShowNotifications(false);
    setError("");
    setSearch("");
    setTransactionTypeFilter("all");
    setTransactionCategoryFilter("all");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const saveBudget = async (event) => {
    event.preventDefault();
    const amount = Number(budgetDraft);
    if (budgetDraft === "" || !Number.isFinite(amount) || amount < 0) { setError("Enter a monthly budget of 0 or more."); return; }
    setSavingBudget(true);
    try {
      await api("/api/budget", token, { method: "PUT", body: JSON.stringify({ month, amount }) });
      setShowBudgetInput(false);
      await load();
    } catch (errorValue) { setError(errorText(errorValue)); }
    finally { setSavingBudget(false); }
  };
  const saveBill = async (event) => {
    event.preventDefault();
    setSavingBill(true);
    setBillError("");
    try {
      const url = editingBill ? `/api/bills/${editingBill.id}` : "/api/bills";
      await api(url, token, { method: editingBill ? "PUT" : "POST", body: JSON.stringify({
        name: billDraft.name.trim(), amount: Number(billDraft.amount), category: billDraft.category,
        due_day: Number(billDraft.due_day),
      }) });
      setShowBillForm(false);
      setEditingBill(null);
      setBillDraft({ name: "", amount: "", category: "Bills", due_day: "1" });
      await loadBills();
    } catch (errorValue) { setBillError(errorText(errorValue)); }
    finally { setSavingBill(false); }
  };
  const payBill = async (bill) => {
    const [year, monthNumber] = month.split("-").map(Number);
    const lastDay = new Date(year, monthNumber, 0).getDate();
    const date = `${month}-${String(Math.min(Number(bill.due_day), lastDay)).padStart(2, "0")}`;
    setPayingBillId(bill.id);
    setBillError("");
    try {
      await api(`/api/bills/${bill.id}/pay`, token, { method: "POST", body: JSON.stringify({ month, date }) });
      await Promise.all([loadBills(), load()]);
    } catch (errorValue) { setBillError(errorText(errorValue)); }
    finally { setPayingBillId(null); }
  };
  const deleteBill = async (bill) => {
    if (!window.confirm(`Remove ${bill.name} from recurring bills?`)) return;
    setDeletingBillId(bill.id);
    setBillError("");
    try {
      await api(`/api/bills/${bill.id}`, token, { method: "DELETE" });
      await loadBills();
    } catch (errorValue) { setBillError(errorText(errorValue)); }
    finally { setDeletingBillId(null); }
  };
  const scanBillScreenshot = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setBillError("Choose a screenshot or photo of your SPayLater bill."); return; }
    if (file.size > 12 * 1024 * 1024) { setBillError("Choose an image smaller than 12 MB."); return; }

    setScanningBill(true);
    setBillError("");
    setBillScanMessage("Reading the screenshot on this device…");
    let worker;
    try {
      const { createWorker } = await import("tesseract.js");
      worker = await createWorker("eng", 1, { logger: (progress) => {
        if (progress.status === "recognizing text") setBillScanMessage(`Reading screenshot… ${Math.round((progress.progress || 0) * 100)}%`);
      } });
      const { data: { text } } = await worker.recognize(file);
      const extracted = parseBillScreenshot(text);
      const unique = [...new Map(extracted.map((item) => [`${item.due_date}-${item.amount}`, item])).values()];
      if (!unique.length) throw new Error("No installment due dates were found. Try a clearer screenshot of the unpaid bill list.");
      setInstallmentDrafts(unique);
      setShowBillForm(false);
      setBillScanMessage(`Found ${unique.length} installment${unique.length === 1 ? "" : "s"}. Review every amount and due date before importing.`);
    } catch (errorValue) {
      setBillError(`Could not read that screenshot. ${errorText(errorValue)}`);
      setBillScanMessage("");
    } finally {
      if (worker) await worker.terminate();
      setScanningBill(false);
    }
  };
  const saveInstallmentReminders = async (event) => {
    event.preventDefault();
    if (installmentDrafts.some((item) => !item.due_date || !(Number(item.amount) > 0))) {
      setBillError("Enter a valid due date and amount for every installment before importing.");
      return;
    }
    setSavingInstallments(true);
    setBillError("");
    try {
      await api("/api/installments", token, { method: "POST", body: JSON.stringify({ items: installmentDrafts }) });
      setBillScanMessage(`Saved ${installmentDrafts.length} SPayLater installment reminders.`);
      setInstallmentDrafts([]);
      await loadInstallments();
    } catch (errorValue) { setBillError(errorText(errorValue)); }
    finally { setSavingInstallments(false); }
  };
  const payInstallment = async (installment) => {
    setPayingInstallmentId(installment.id);
    setBillError("");
    try {
      await api(`/api/installments/${installment.id}/pay`, token, { method: "POST", body: JSON.stringify({ date: localDate() }) });
      await Promise.all([loadInstallments(), load()]);
    } catch (errorValue) { setBillError(errorText(errorValue)); }
    finally { setPayingInstallmentId(null); }
  };
  const deleteInstallment = async (installment) => {
    if (!window.confirm(`Remove the SPayLater installment due ${installment.due_date}?`)) return;
    setDeletingInstallmentId(installment.id);
    setBillError("");
    try {
      await api(`/api/installments/${installment.id}`, token, { method: "DELETE" });
      await loadInstallments();
    } catch (errorValue) { setBillError(errorText(errorValue)); }
    finally { setDeletingInstallmentId(null); }
  };
  const saveEntry = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amount = Number(data.get("amount"));
    const date = String(data.get("date") || "");
    if (!Number.isFinite(amount) || amount <= 0) { setError("Enter an amount greater than 0."); return; }
    setSavingEntry(true);
    try {
      await api("/api/transactions", token, { method: "POST", body: JSON.stringify({
        type: entryType,
        amount,
        category: String(data.get("category") || (entryType === "inc" ? "Salary" : "Food")),
        note: String(data.get("note") || ""),
        date,
      }) });
      setShowEntryForm(false);
      const entryMonth = date.slice(0, 7);
      if (entryMonth !== month) setMonth(entryMonth);
      else await load();
    } catch (errorValue) { setError(errorText(errorValue)); }
    finally { setSavingEntry(false); }
  };
  const deleteEntry = async (entry) => {
    setDeleting(true);
    try {
      await api(`/api/transactions/${entry.id}`, token, { method: "DELETE" });
      setSelectedEntry(null);
      await load();
    } catch (errorValue) { setError(errorText(errorValue)); }
    finally { setDeleting(false); }
  };
  const exportCsv = async () => {
    setExporting(true);
    try {
      const response = await fetchWithSession(`/api/transactions.csv?month=${month}`, token);
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Could not export CSV");
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `everyday-budget-${month}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (errorValue) { setError(errorText(errorValue)); }
    finally { setExporting(false); }
  };
  const signOut = async () => {
    setSigningOut(true);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
    } catch (errorValue) { setError(errorText(errorValue)); }
    finally { setSigningOut(false); }
  };
  const saveName = async (event) => {
    event.preventDefault();
    const display_name = nameDraft.trim();
    if (!display_name) { setProfileMessage("Enter a name to continue."); return; }
    setSavingName(true);
    setProfileMessage("");
    try {
      const { data, error: updateError } = await supabase.auth.updateUser({ data: { display_name } });
      if (updateError) setProfileMessage(errorText(updateError));
      else {
        setNameDraft(data.user?.user_metadata?.display_name || display_name);
        setProfileMessage("Your name has been updated.");
      }
    } catch (errorValue) { setProfileMessage(errorText(errorValue)); }
    finally { setSavingName(false); }
  };

  const uploadAvatar = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) { setProfileMessage("Choose a JPG, PNG, or WebP image."); return; }
    if (file.size > 5 * 1024 * 1024) { setProfileMessage("Choose an image smaller than 5 MB."); return; }

    setUploadingAvatar(true);
    setProfileMessage("");
    let uploadedPath;
    const previousPath = session.user.user_metadata?.avatar_path;
    try {
      const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
      uploadedPath = `${session.user.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(uploadedPath, file, {
        contentType: file.type,
        cacheControl: "3600",
      });
      if (uploadError) throw uploadError;
      const { error: updateError } = await supabase.auth.updateUser({ data: { avatar_path: uploadedPath } });
      if (updateError) throw updateError;
      if (previousPath) await supabase.storage.from("avatars").remove([previousPath]).catch(() => {});
      setProfileMessage("Your profile picture has been updated.");
    } catch (errorValue) {
      if (uploadedPath) await supabase.storage.from("avatars").remove([uploadedPath]).catch(() => {});
      setProfileMessage(errorText(errorValue));
    } finally { setUploadingAvatar(false); }
  };

  const statusMessage = budget > 0
    ? spent > budget ? `You are ${peso(spent - budget)} over your ${monthName} budget.`
      : spentPercentage >= 80 ? `${spentPercentage}% of your ${monthName} budget has been used.`
        : `${peso(remaining)} remains in your ${monthName} budget.`
    : `Add income for ${monthName} and your available budget will update automatically.`;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">E</span><span>Everyday</span></div>
      <nav className="main-nav" aria-label="Main navigation">
        <button className={`nav-item${activeNav === "overview" ? " active" : ""}`} type="button" title="Overview" aria-current={activeNav === "overview" ? "page" : undefined} onClick={() => navigate("overview")}><Icon name="grid" />Overview</button>
        <button className={`nav-item${activeNav === "transactions" ? " active" : ""}`} type="button" title="Transactions" aria-current={activeNav === "transactions" ? "page" : undefined} onClick={() => navigate("transactions")}><Icon name="wallet" />Transactions</button>
        <button className={`nav-item${activeNav === "bills" ? " active" : ""}`} type="button" title="Bills" aria-current={activeNav === "bills" ? "page" : undefined} onClick={() => navigate("bills")}><Icon name="bills" />Bills</button>
        <button className={`nav-item${activeNav === "insights" ? " active" : ""}`} type="button" title="Insights" aria-current={activeNav === "insights" ? "page" : undefined} onClick={() => navigate("insights")}><Icon name="chart" />Insights</button>
      </nav>
      <div className="sidebar-bottom">
        <div className="account-menu-wrap">
          <button className="profile profile-button" type="button" onClick={() => setShowAccountMenu((open) => !open)} aria-label="Open account menu" aria-expanded={showAccountMenu}>
            {avatar()}
            <span className="profile-copy"><strong>{displayName}</strong><span>{session.user.email}</span></span>
            <Icon name="chevron" size={16} />
          </button>
          {showAccountMenu && <div className="account-popover" role="menu">
            <button type="button" role="menuitem" onClick={() => { navigate("settings"); setShowAccountMenu(false); }}>Account settings</button>
            <button type="button" role="menuitem" className="account-signout" disabled={signingOut} onClick={signOut}>{signingOut ? "Signing out…" : "Sign out"}</button>
          </div>}
        </div>
      </div>
    </aside>

    <main className={`main page-${activeNav}`}>
      <header className="topbar">
        <div><p className="eyebrow">{activeNav === "overview" ? "Personal budget" : `${activeNav} · ${monthName}`}</p><h1>{activeNav === "overview" ? `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${displayName}.` : activeNav === "transactions" ? "Transactions" : activeNav === "insights" ? "Spending insights" : activeNav === "bills" ? "Recurring bills" : "Settings"}</h1></div>
        <div className="top-actions">
          <div className="notification-wrap">
            <button className="icon-button notification-button" type="button" aria-label={dueBillReminders.length ? `${dueBillReminders.length} bills due soon` : "Budget and bill reminders"} aria-expanded={showNotifications} onClick={() => setShowNotifications((open) => !open)}><Icon name="bell" />{dueBillReminders.length > 0 && <span className="notification-count">{dueBillReminders.length}</span>}</button>
            {showNotifications && <div className="notification-popover" role="status">
              <strong>{status}</strong><span>{statusMessage}</span>
              <div className="notification-bills-heading">Bill reminders</div>
              {dueBillReminders.length ? dueBillReminders.map((bill) => <div className="notification-bill" key={`${bill.kind}-${bill.id}`}>
                <strong>{bill.name}</strong><span>{bill.daysUntilDue < 0 ? `Overdue by ${Math.abs(bill.daysUntilDue)} day${Math.abs(bill.daysUntilDue) === 1 ? "" : "s"}` : bill.daysUntilDue === 0 ? "Due today" : `Due in ${bill.daysUntilDue} day${bill.daysUntilDue === 1 ? "" : "s"}`} · {peso(bill.amount)}</span>
              </div>) : <span>No bills due in the next 3 days. Add SPayLater once as a recurring bill to get monthly reminders.</span>}
              <button className="notification-manage" type="button" onClick={() => { navigate("bills"); setShowNotifications(false); }}>Manage recurring bills</button>
            </div>}
          </div>
          <label className="month-picker-label" aria-label="Select month"><input className="month-picker" type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} /></label>
          <button className="primary-button" type="button" onClick={() => { setError(""); setShowEntryForm(true); }}><Icon name="plus" size={18} />Add transaction</button>
        </div>
      </header>

      {error && <div className="dashboard-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}

      {activeNav === "overview" && <section className="hero-grid" aria-label="Monthly budget summary">
        <article className="balance-card">
          <div className="card-heading"><div><span>Available to spend</span><h2>{peso(remaining)}</h2></div><span className={`status-pill${remaining < 0 ? " status-over" : ""}`}>{status}</span></div>
          <div className="budget-track"><span style={{ width: `${spentPercentage}%` }} /></div>
          <div className="budget-labels"><span>{peso(spent)} spent</span><span>{spentPercentage}% of budget</span></div>
          <div className="balance-footer">
            <div><span>{automaticBudget ? "Budget from income" : "Custom monthly budget"}</span><strong>{peso(budget)}</strong></div>
            {showBudgetInput ? <form onSubmit={saveBudget} className="budget-form">
              <input autoFocus type="number" min="0" step="100" value={budgetDraft} onChange={(event) => setBudgetDraft(event.target.value)} aria-label="Monthly budget" />
              <button type="submit" disabled={savingBudget}>{savingBudget ? "Saving…" : "Save"}</button>
              <button type="button" className="cancel-budget" onClick={() => { setShowBudgetInput(false); setBudgetDraft(automaticBudget ? "0" : String(budget)); }}>Cancel</button>
            </form> : <button className="text-button" type="button" onClick={() => { setBudgetDraft(automaticBudget ? "0" : String(budget)); setShowBudgetInput(true); }}>{automaticBudget ? "Set custom budget" : "Edit budget"} <Icon name="arrow" size={16} /></button>}
          </div>
        </article>
        <div className="summary-cards">
          <article className="summary-card"><span className="summary-icon income"><Icon name="arrow" size={18} /></span><div><span>Total income</span><strong>{peso(totalIncome)}</strong><small>{monthName}</small></div></article>
          <article className="summary-card"><span className="summary-icon expense"><Icon name="arrow" size={18} /></span><div><span>Total spent</span><strong>{peso(spent)}</strong><small>{spentPercentage}% of budget</small></div></article>
        </div>
      </section>}

      {activeNav === "insights" && <section className="insights-summary" aria-label="Monthly totals">
        <article><span>Income this month</span><strong>{peso(totalIncome)}</strong></article>
        <article><span>Expenses this month</span><strong>{peso(spent)}</strong></article>
        <article><span>Budget remaining</span><strong className={remaining < 0 ? "negative" : ""}>{peso(remaining)}</strong></article>
        <article><span>Active spending days</span><strong>{dailySpend.activeDays}</strong></article>
      </section>}

      {(activeNav === "overview" || activeNav === "insights") && <section className="content-grid">
        <article className="panel categories-panel">
          <div className="section-heading"><div><p className="eyebrow">Spending plan</p><h3>Categories</h3></div>
            {activeNav === "overview" && <button className="text-button" type="button" onClick={() => navigate("insights")}>See insights <Icon name="arrow" size={16} /></button>}
          </div>
          <div className="category-list">
            {(activeNav === "overview" ? categoryRows.filter((category) => category.spent > 0).slice(0, 4) : categoryRows).length === 0 && <p className="empty-state">No expense categories yet this month.</p>}
            {(activeNav === "overview" ? categoryRows.filter((category) => category.spent > 0).slice(0, 4) : categoryRows).map((category) => {
              const percentage = spent > 0 ? Math.round((category.spent / spent) * 100) : 0;
              return <div className="category-row" key={category.name}>
                <CategoryIcon category={category.name} />
                <div className="category-detail"><div><strong>{category.name}</strong><span>{peso(category.spent)} <small>spent</small></span></div>
                  <div className="category-track"><span style={{ width: `${percentage}%`, backgroundColor: categoryMeta[category.name]?.color || categoryMeta.Other.color }} /></div>
                </div>
                <span className="percentage">{percentage}%</span>
              </div>;
            })}
          </div>
        </article>

        <article className="panel insight-panel">
          <div className="section-heading"><div><p className="eyebrow">{monthName}</p><h3>Daily spending</h3></div>
            <span className="mini-stat">Avg. {peso(dailySpend.average)}/active day</span>
          </div>
          <div className="chart" aria-label={`Daily expense totals for ${monthName}`}>
            {dailySpend.buckets.map((bucket) => <span key={bucket.firstDay} title={`${bucket.firstDay}${bucket.lastDay !== bucket.firstDay ? `–${bucket.lastDay}` : ""}: ${peso(bucket.total)}`} style={{ height: `${dailySpend.max ? Math.max(4, bucket.total / dailySpend.max * 100) : 4}%` }} className={bucket.total === dailySpend.max && bucket.total > 0 ? "today" : ""} />)}
          </div>
          <div className="chart-labels"><span>{monthName.split(" ")[0]} 1</span><span>{monthName.split(" ")[0]} {Math.ceil(dailySpend.numberOfDays / 2)}</span><span>{monthName.split(" ")[0]} {dailySpend.numberOfDays}</span></div>
          <div className="insight-note"><span className="spark">↗</span><p><strong>{dailySpend.activeDays ? `${dailySpend.activeDays} active spending day${dailySpend.activeDays === 1 ? "" : "s"}` : "No spending recorded yet"}</strong><br />{spentPercentage}% of this month's budget used.</p></div>
        </article>
      </section>}

      {(activeNav === "overview" || activeNav === "transactions") && <section className={`panel transaction-panel${activeNav === "transactions" ? " full-transactions" : ""}`}>
        <div className="section-heading transaction-heading"><div><p className="eyebrow">{activeNav === "overview" ? "Activity" : monthName}</p><h3>{activeNav === "overview" ? "Recent transactions" : "All transactions"}</h3></div>
          <div className="transaction-tools">{activeNav === "transactions" && <label className="search"><Icon name="search" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" aria-label="Search transactions" /></label>}
            <button className="outline-button" type="button" onClick={exportCsv} disabled={exporting}><Icon name="download" size={17} />{exporting ? "Exporting…" : "Export"}</button>
          </div>
        </div>
        {activeNav === "transactions" && <>
          <div className="transaction-filters">
            <label>Type<select value={transactionTypeFilter} onChange={(event) => setTransactionTypeFilter(event.target.value)}><option value="all">All types</option><option value="exp">Expenses</option><option value="inc">Income</option></select></label>
            <label>Category<select value={transactionCategoryFilter} onChange={(event) => setTransactionCategoryFilter(event.target.value)}><option value="all">All categories</option>{transactionCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          </div>
          <div className="transaction-filter-summary" aria-live="polite"><span>{filteredEntries.length} transaction{filteredEntries.length === 1 ? "" : "s"}</span><span>Income {peso(filteredTotals.income)}</span><span>Expenses {peso(filteredTotals.expenses)}</span></div>
        </>}
        <div className="transaction-list">
          {visibleEntries.map((entry) => <div className="transaction-row" key={entry.id}>
            <CategoryIcon category={entry.type === "inc" ? entry.category : entry.category} />
            <div className="transaction-name"><strong>{entry.note || entry.category}</strong><span>{entry.category}</span></div>
            <time>{new Date(`${entry.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time>
            <strong className={entry.type === "inc" ? "income" : "expense"}>{entry.type === "exp" ? "−" : "+"}{peso(entry.amount)}</strong>
            <button type="button" aria-label={`View ${entry.note || entry.category}`} onClick={() => setSelectedEntry(entry)}><Icon name="chevron" size={17} /></button>
          </div>)}
          {visibleEntries.length === 0 && <p className="empty-state">{activeNav === "transactions" && entries.length && (search || transactionTypeFilter !== "all" || transactionCategoryFilter !== "all") ? "No transactions match these filters." : `No transactions for ${monthName} yet.`}</p>}
        </div>
        {activeNav === "overview" && matchingEntries.length > 5 && <button className="view-all" type="button" onClick={() => navigate("transactions")}>View all transactions<Icon name="arrow" size={16} /></button>}
      </section>}

      {activeNav === "bills" && <section className="bills-page">
        <div className="bills-toolbar"><div><p className="eyebrow">Monthly commitments</p><p className="settings-description">Keep regular expenses in one place. Scan a SPayLater screenshot to read every visible installment and due date, then review before saving.</p></div>
          <div className="bills-toolbar-actions">
            <input ref={billScanInputRef} className="bill-scan-input" type="file" accept="image/*" onChange={scanBillScreenshot} />
            <button className="outline-button" type="button" disabled={scanningBill} onClick={() => billScanInputRef.current?.click()}>{scanningBill ? "Reading screenshot…" : "Scan"}</button>
            <button className="primary-button" type="button" onClick={() => { setBillDraft({ name: "", amount: "", category: "Bills", due_day: "1" }); setEditingBill(null); setBillScanMessage(""); setShowBillForm((open) => !open); }}><Icon name="plus" size={18} />Add bill</button>
          </div>
        </div>
        {billError && <div className="dashboard-error" role="alert"><span>{billError}</span><button type="button" onClick={() => setBillError("")} aria-label="Dismiss error">×</button></div>}
        {billScanMessage && !scanningBill && <p className="bill-scan-message" role="status">{billScanMessage}</p>}
        {installmentDrafts.length > 0 && <form className="panel installment-review" onSubmit={saveInstallmentReminders}>
          <div className="section-heading"><div><p className="eyebrow">Screenshot scan</p><h3>Review installments</h3></div><button className="text-button" type="button" onClick={() => { setInstallmentDrafts([]); setBillScanMessage(""); }}>Cancel</button></div>
          <p className="settings-description">Check each amount and exact due date. Only the details you save are stored; the screenshot itself stays on this device.</p>
          <div className="installment-review-list">{installmentDrafts.map((item, index) => <div className="installment-review-row" key={`${item.due_date}-${index}`}>
            <strong>{dueMonthLabel(item.due_date)}</strong>
            <label>Due date<input type="date" required value={item.due_date} onChange={(event) => setInstallmentDrafts((previous) => previous.map((row, rowIndex) => rowIndex === index ? { ...row, due_date: event.target.value } : row))} /></label>
            <label>Amount<div className="amount-input"><b>₱</b><input type="number" min="0.01" step="0.01" required value={item.amount} onChange={(event) => setInstallmentDrafts((previous) => previous.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row))} /></div></label>
            <button className="bill-remove" type="button" onClick={() => setInstallmentDrafts((previous) => previous.filter((_, rowIndex) => rowIndex !== index))}>Remove</button>
          </div>)}</div>
          <div className="installment-review-actions"><button className="outline-button" type="button" onClick={() => setInstallmentDrafts((previous) => [...previous, { name: "SPayLater installment", amount: "", due_date: "" }])}>Add installment</button><button className="primary-button" type="submit" disabled={savingInstallments}>{savingInstallments ? "Saving…" : `Save ${installmentDrafts.length} reminders`}</button></div>
        </form>}
        <div className="bill-summary"><strong>{peso(bills.reduce((total, bill) => total + Number(bill.amount), 0))}</strong><span>monthly recurring · {bills.length} bill{bills.length === 1 ? "" : "s"}</span></div>
        {showBillForm && <form className="panel bill-form" onSubmit={saveBill}>
          <div className="section-heading"><h3>{editingBill ? "Edit bill" : "Add a recurring bill"}</h3><button className="text-button" type="button" onClick={() => { setShowBillForm(false); setEditingBill(null); }}>Cancel</button></div>
          <label>Bill name<input value={billDraft.name} maxLength={60} onChange={(event) => setBillDraft({ ...billDraft, name: event.target.value })} placeholder="Rent, internet, electricity" required /></label>
          <div className="bill-form-row">
            <label>Monthly amount<div className="amount-input"><b>₱</b><input type="number" min="0.01" step="0.01" value={billDraft.amount} onChange={(event) => setBillDraft({ ...billDraft, amount: event.target.value })} placeholder="0.00" required /></div></label>
            <label>Category<select value={billDraft.category} onChange={(event) => setBillDraft({ ...billDraft, category: event.target.value })}>{EXPENSE_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label>Due day<input type="number" min="1" max="31" step="1" value={billDraft.due_day} onChange={(event) => setBillDraft({ ...billDraft, due_day: event.target.value })} required /></label>
          </div>
          <button className="primary-button" type="submit" disabled={savingBill}>{savingBill ? "Saving…" : editingBill ? "Save changes" : "Save bill"}</button>
        </form>}
        {bills.length === 0 ? <article className="panel bills-empty"><h3>No recurring bills yet</h3><p>Add rent, utilities, subscriptions, or other monthly commitments to see them alongside your budget.</p></article> : <div className="bill-list">
          {bills.map((bill) => {
            const billMarker = `Bill #${bill.id}:`;
            const paid = entries.some((entry) => entry.type === "exp" && entry.note?.startsWith(billMarker));
            const isCurrentMonth = month === localDate().slice(0, 7);
            const overdue = !paid && isCurrentMonth && Number(bill.due_day) < Number(localDate().slice(-2));
            return <article className="panel bill-card" key={bill.id}>
              <div className="bill-card-heading"><CategoryIcon category={bill.category} /><div><h3>{bill.name}</h3><span>{bill.category}</span></div><strong>{peso(bill.amount)}</strong></div>
              <div className="bill-card-meta"><span>Due day {bill.due_day}</span><span className={`bill-status${paid ? " paid" : overdue ? " overdue" : ""}`}>{paid ? "Paid this month" : overdue ? "Past due" : "Upcoming"}</span></div>
              <div className="bill-card-actions"><button className="primary-button" type="button" disabled={paid || payingBillId === bill.id} onClick={() => payBill(bill)}>{payingBillId === bill.id ? "Saving…" : paid ? "Paid" : "Mark paid"}</button><button className="outline-button" type="button" onClick={() => { setEditingBill(bill); setBillDraft({ name: bill.name, amount: String(bill.amount), category: bill.category, due_day: String(bill.due_day) }); setShowBillForm(true); }}>Edit</button><button className="bill-remove" type="button" disabled={deletingBillId === bill.id} onClick={() => deleteBill(bill)}>{deletingBillId === bill.id ? "Removing…" : "Remove"}</button></div>
            </article>;
          })}
        </div>}
        <div className="installment-section">
          <div className="section-heading"><div><p className="eyebrow">Pay-later schedule</p><h3>SPayLater installments</h3></div><span className="mini-stat">{installments.filter((item) => !item.paid).length} unpaid</span></div>
          {installments.length === 0 ? <article className="panel bills-empty"><p>Scan the Unpaid bills screenshot to add each installment and its exact due date at once.</p></article> : <div className="installment-list">{installments.map((item) => {
            const daysUntilDue = Math.round((new Date(`${item.due_date}T12:00:00`) - todayDate) / 86400000);
            const dueStatus = item.paid ? "Paid" : daysUntilDue < 0 ? `Overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) === 1 ? "" : "s"}` : daysUntilDue === 0 ? "Due today" : `Due ${new Date(`${item.due_date}T12:00:00`).toLocaleDateString("en-PH", { day: "2-digit", month: "short", year: "numeric" })}`;
            return <article className="panel installment-card" key={item.id}>
              <div><h4>{dueMonthLabel(item.due_date)}</h4><span>SPayLater · {new Date(`${item.due_date}T12:00:00`).toLocaleDateString("en-PH", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
              <strong>{peso(item.amount)}</strong>
              <span className={`bill-status${item.paid ? " paid" : daysUntilDue < 0 ? " overdue" : ""}`}>{dueStatus}</span>
              <div className="installment-card-actions"><button className="primary-button" type="button" disabled={item.paid || payingInstallmentId === item.id} onClick={() => payInstallment(item)}>{payingInstallmentId === item.id ? "Saving…" : item.paid ? "Paid" : "Mark paid"}</button><button className="bill-remove" type="button" disabled={deletingInstallmentId === item.id} onClick={() => deleteInstallment(item)}>{deletingInstallmentId === item.id ? "Removing…" : "Remove"}</button></div>
            </article>;
          })}</div>}
        </div>
      </section>}

      {activeNav === "settings" && <section className="settings-page">
        <article className="panel settings-card">
          <div className="section-heading"><div><p className="eyebrow">Account</p><h3>Your profile</h3></div>{avatar("avatar settings-avatar")}</div>
          <dl className="settings-details"><div><dt>Email</dt><dd>{session.user.email}</dd></div></dl>
          <div className="avatar-settings-row">
            <div><strong>Profile picture</strong><span>JPG, PNG, or WebP up to 5 MB</span></div>
            <input ref={avatarInputRef} className="avatar-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadAvatar} />
            <button className="outline-button" type="button" disabled={uploadingAvatar} onClick={() => avatarInputRef.current?.click()}>{uploadingAvatar ? "Uploading…" : avatarUrl ? "Change picture" : "Add picture"}</button>
          </div>
          <form className="profile-name-form" onSubmit={saveName}>
            <label htmlFor="profile-name">Display name</label>
            <div><input id="profile-name" value={nameDraft} maxLength={40} onChange={(event) => setNameDraft(event.target.value)} autoComplete="name" /><button className="primary-button" type="submit" disabled={savingName}>{savingName ? "Saving…" : "Save name"}</button></div>
            {profileMessage && <p className="profile-message" role="status">{profileMessage}</p>}
          </form>
        </article>
        <article className="panel settings-card">
          <div className="section-heading"><div><p className="eyebrow">Monthly plan</p><h3>{monthName} budget</h3></div><strong className="settings-budget-value">{peso(budget)}</strong></div>
          <p className="settings-description">By default, your budget follows the income you record for this month. Enter a custom target below, or save 0 to return to automatic budgeting.</p>
          <form className="settings-budget-form" onSubmit={saveBudget}>
            <label htmlFor="settings-budget">Custom monthly budget (0 = automatic)</label>
            <div><input id="settings-budget" type="number" min="0" step="100" value={budgetDraft} onChange={(event) => setBudgetDraft(event.target.value)} /><button className="primary-button" type="submit" disabled={savingBudget}>{savingBudget ? "Saving…" : "Save budget"}</button></div>
          </form>
        </article>
      </section>}
    </main>

    {showEntryForm && <div className="modal-backdrop" onMouseDown={() => !savingEntry && setShowEntryForm(false)}>
      <div className="entry-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="entry-title">
        <button className="close-button" type="button" onClick={() => setShowEntryForm(false)} aria-label="Close" disabled={savingEntry}>×</button>
        <p className="eyebrow">New activity</p><h2 id="entry-title">Add a transaction</h2>
        <div className="type-switch"><button type="button" className={entryType === "exp" ? "active" : ""} onClick={() => setEntryType("exp")}>Expense</button><button type="button" className={entryType === "inc" ? "active" : ""} onClick={() => setEntryType("inc")}>Income</button></div>
        <form onSubmit={saveEntry} className="entry-form">
          <label><span>Amount</span><div className="amount-input"><b>₱</b><input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required autoFocus /></div></label>
          <label><span>Category</span><select name="category">{(entryType === "exp" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).map((category) => <option key={category}>{category}</option>)}</select></label>
          <label><span>Note</span><input name="note" maxLength="60" placeholder={entryType === "exp" ? "What did you buy?" : "Where is it from?"} /></label>
          <label><span>Date</span><input name="date" type="date" defaultValue={month === localDate().slice(0, 7) ? localDate() : `${month}-01`} required /></label>
          {error && <p className="modal-error" role="alert">{error}</p>}
          <button className="primary-button submit-button" type="submit" disabled={savingEntry}>{savingEntry ? "Saving…" : "Save transaction"}</button>
        </form>
      </div>
    </div>}

    {selectedEntry && <div className="modal-backdrop" onMouseDown={() => !deleting && setSelectedEntry(null)}>
      <section className="entry-modal detail-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <button className="close-button" type="button" onClick={() => setSelectedEntry(null)} aria-label="Close" disabled={deleting}>×</button>
        <p className="eyebrow">Transaction details</p><h2 id="detail-title">{selectedEntry.note || selectedEntry.category}</h2>
        <dl className="detail-list"><div><dt>Type</dt><dd>{selectedEntry.type === "inc" ? "Income" : "Expense"}</dd></div><div><dt>Category</dt><dd>{selectedEntry.category}</dd></div><div><dt>Date</dt><dd>{selectedEntry.date}</dd></div><div><dt>Amount</dt><dd>{selectedEntry.type === "inc" ? "+" : "−"}{peso(selectedEntry.amount)}</dd></div></dl>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <button className="delete-entry" type="button" disabled={deleting} onClick={() => deleteEntry(selectedEntry)}>{deleting ? "Deleting…" : "Delete transaction"}</button>
      </section>
    </div>}

  </div>;
}
