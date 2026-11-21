import dotenv from "dotenv";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

const { SUPABASE_URL } = process.env;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!SUPABASE_URL || !supabasePublishableKey) {
  console.error("Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the project root .env before starting the API.");
  process.exit(1);
}

const supabaseAuth = createClient(SUPABASE_URL, supabasePublishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const app = express();
app.use(express.json());

const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value) => {
  if (!DATE.test(value || "")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};
const bad = (res, msg) => res.status(400).json({ error: msg });
const dbError = (res, error) => {
  console.error("Supabase request failed:", error);
  if (["PGRST202", "PGRST204", "PGRST205", "42P01", "42703", "42501", "42883"].includes(error?.code)) {
    return res.status(503).json({ error: "Supabase setup is incomplete. Run the latest server/supabase-schema.sql in your Supabase SQL Editor, then restart the app." });
  }
  return res.status(500).json({ error: "Could not access Supabase. Check the server log and database setup." });
};
const nextMonth = (month) => {
  const [year, m] = month.split("-").map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
};
const monthBounds = (month) => ({ from: `${month}-01`, to: `${nextMonth(month)}-01` });

// Validate every API request and run its queries with that user's JWT so RLS applies.
app.use("/api", async (req, res, next) => {
  const authorization = req.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });
  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error) {
      const details = `${error.code || ""} ${error.message || ""}`;
      console.error("Supabase session verification failed:", { code: error.code, status: error.status, message: error.message });
      if (/expired|invalid jwt|bad_jwt/i.test(details)) {
        return res.status(401).json({ error: "Your session expired. Please sign in again." });
      }
      return res.status(502).json({ error: "Supabase could not verify your session. Check the project URL, publishable key, and network connection." });
    }
    if (!data.user) return res.status(401).json({ error: "Please sign in to continue." });
    req.user = data.user;
    req.db = createClient(SUPABASE_URL, supabasePublishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    next();
  } catch (error) {
    console.error("Supabase session verification request failed:", error?.message || error);
    res.status(502).json({ error: "Could not reach Supabase to verify your session. Check your connection and try again." });
  }
});

// PostgREST limits each response, so page through large months for summaries and exports.
async function allRows(buildQuery) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

const monthTransactions = (db, userId, month, columns = "*") => {
  const { from, to } = monthBounds(month);
  return db.from("transactions").select(columns).eq("user_id", userId).gte("date", from).lt("date", to);
};

// A custom budget applies only to the selected month; otherwise use recorded income.
async function budgetFor(db, userId, month) {
  const { data, error } = await db.from("monthly_budgets").select("amount")
    .eq("user_id", userId).eq("month", month).maybeSingle();
  if (error) throw error;
  const amount = data?.amount == null ? null : Number(data.amount);
  return amount > 0 ? amount : null;
}

app.get("/api/transactions", async (req, res) => {
  const month = String(req.query.month || "");
  if (!MONTH.test(month)) return bad(res, "month must be YYYY-MM");
  try {
    const rows = await allRows(() => monthTransactions(req.db, req.user.id, month).order("date", { ascending: false }).order("id", { ascending: false }));
    res.json(rows);
  } catch (error) { dbError(res, error); }
});

// Export the selected month's entries in spreadsheet-friendly CSV format.
app.get("/api/transactions.csv", async (req, res) => {
  const month = String(req.query.month || "");
  if (!MONTH.test(month)) return bad(res, "month must be YYYY-MM");
  try {
    const rows = await allRows(() => monthTransactions(req.db, req.user.id, month, "type,amount,category,note,date")
      .order("date", { ascending: true }).order("id", { ascending: true }));
    const cell = (value) => {
      let text = String(value ?? "");
      if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const csv = [
      ["Date", "Type", "Category", "Note", "Amount"],
      ...rows.map((row) => [row.date, row.type === "exp" ? "Expense" : "Income", row.category, row.note, row.amount]),
    ].map((row) => row.map(cell).join(",")).join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="everyday-budget-${month}.csv"`);
    res.send("\uFEFF" + csv);
  } catch (error) { dbError(res, error); }
});

app.post("/api/transactions", async (req, res) => {
  const { type, amount, category, note = "", date } = req.body || {};
  if (!["exp", "inc"].includes(type)) return bad(res, "Type must be expense or income");
  if (!(Number(amount) > 0) || !Number.isFinite(Number(amount))) return bad(res, "Amount must be greater than 0");
  if (!category) return bad(res, "Pick a category");
  if (!DATE.test(date || "")) return bad(res, "Date must be YYYY-MM-DD");
  try {
    const { data, error } = await req.db.from("transactions").insert({
      user_id: req.user.id, type, amount: Number(amount), category: String(category), note: String(note).slice(0, 60), date,
    }).select("id").single();
    if (error) throw error;
    res.status(201).json({ id: data.id });
  } catch (error) { dbError(res, error); }
});

app.delete("/api/transactions/:id", async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return bad(res, "Invalid transaction id");
  try {
    const { error } = await req.db.from("transactions").delete().eq("user_id", req.user.id).eq("id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  } catch (error) { dbError(res, error); }
});

app.get("/api/summary", async (req, res) => {
  const month = String(req.query.month || "");
  if (!MONTH.test(month)) return bad(res, "month must be YYYY-MM");
  try {
    const [rows, customBudget] = await Promise.all([
      allRows(() => monthTransactions(req.db, req.user.id, month, "type,category,amount")),
      budgetFor(req.db, req.user.id, month),
    ]);
    const totals = new Map();
    let spent = 0;
    let income = 0;
    for (const row of rows) {
      const amount = Number(row.amount);
      if (row.type === "inc") income += amount;
      else {
        spent += amount;
        totals.set(row.category, (totals.get(row.category) || 0) + amount);
      }
    }
    const byCategory = [...totals].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
    res.json({ budget: customBudget ?? income, budgetMode: customBudget == null ? "automatic" : "custom", spent, income, byCategory });
  } catch (error) { dbError(res, error); }
});

app.put("/api/budget", async (req, res) => {
  const { month, amount } = req.body || {};
  if (!MONTH.test(month || "") || !Number.isFinite(Number(amount)) || Number(amount) < 0) {
    return bad(res, "Month and a budget of 0 or more are required");
  }
  try {
    const { error } = await req.db.from("monthly_budgets").upsert(
      { user_id: req.user.id, month, amount: Number(amount) }, { onConflict: "user_id,month" },
    );
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) { dbError(res, error); }
});

app.get("/api/bills", async (req, res) => {
  try {
    const { data, error } = await req.db.from("recurring_bills").select("id,name,amount,category,due_day,active,last_paid_month")
      .eq("user_id", req.user.id).eq("active", true).order("due_day").order("name");
    if (error) throw error;
    res.json(data);
  } catch (error) { dbError(res, error); }
});

app.post("/api/bills", async (req, res) => {
  const { name, amount, category = "Bills", due_day } = req.body || {};
  const cleanName = String(name || "").trim();
  const dueDay = Number(due_day);
  if (!cleanName || cleanName.length > 60) return bad(res, "Bill name must be 1 to 60 characters");
  if (!(Number(amount) > 0) || !Number.isFinite(Number(amount))) return bad(res, "Amount must be greater than 0");
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return bad(res, "Due day must be between 1 and 31");
  if (!String(category).trim() || String(category).length > 40) return bad(res, "Choose a valid category");
  try {
    const { data, error } = await req.db.from("recurring_bills").insert({
      user_id: req.user.id, name: cleanName, amount: Number(amount), category: String(category).trim(), due_day: dueDay,
    }).select("id").single();
    if (error) throw error;
    res.status(201).json({ id: data.id });
  } catch (error) { dbError(res, error); }
});

app.put("/api/bills/:id", async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return bad(res, "Invalid bill id");
  const { name, amount, category, due_day } = req.body || {};
  const cleanName = String(name || "").trim();
  const dueDay = Number(due_day);
  if (!cleanName || cleanName.length > 60) return bad(res, "Bill name must be 1 to 60 characters");
  if (!(Number(amount) > 0) || !Number.isFinite(Number(amount))) return bad(res, "Amount must be greater than 0");
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return bad(res, "Due day must be between 1 and 31");
  if (!String(category || "").trim() || String(category).length > 40) return bad(res, "Choose a valid category");
  try {
    const { error } = await req.db.from("recurring_bills").update({
      name: cleanName, amount: Number(amount), category: String(category).trim(), due_day: dueDay,
    }).eq("user_id", req.user.id).eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) { dbError(res, error); }
});

app.delete("/api/bills/:id", async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return bad(res, "Invalid bill id");
  try {
    const { error } = await req.db.from("recurring_bills").delete().eq("user_id", req.user.id).eq("id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  } catch (error) { dbError(res, error); }
});

app.post("/api/bills/:id/pay", async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return bad(res, "Invalid bill id");
  const { month, date } = req.body || {};
  if (!MONTH.test(month || "") || !DATE.test(date || "") || date.slice(0, 7) !== month) {
    return bad(res, "Choose a valid payment date in the selected month");
  }
  try {
    const { error } = await req.db.rpc("record_recurring_bill_payment", {
      p_bill_id: Number(req.params.id), p_month: month, p_date: date,
    });
    if (error) {
      if (error.code === "P0001" && /already paid/i.test(error.message || "")) return res.status(409).json({ error: "This bill is already marked paid for that month." });
      if (error.code === "P0001") return bad(res, error.message);
      throw error;
    }
    res.json({ ok: true });
  } catch (error) { dbError(res, error); }
});

app.get("/api/installments", async (req, res) => {
  try {
    const { data, error } = await req.db.from("installment_reminders")
      .select("id,name,amount,due_date,paid").eq("user_id", req.user.id).order("due_date");
    if (error) throw error;
    res.json(data);
  } catch (error) { dbError(res, error); }
});

app.post("/api/installments", async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 60) return bad(res, "Include between 1 and 60 installment reminders");
  const rows = [];
  for (const item of items) {
    const amount = Number(item?.amount);
    const dueDate = String(item?.due_date || "");
    if (!Number.isFinite(amount) || amount <= 0) return bad(res, "Each installment needs an amount greater than 0");
    if (!validDate(dueDate)) return bad(res, "Each installment needs a valid due date");
    rows.push({ user_id: req.user.id, name: "SPayLater installment", amount, due_date: dueDate, paid: false });
  }
  try {
    const { error } = await req.db.from("installment_reminders").upsert(rows, { onConflict: "user_id,name,due_date" });
    if (error) throw error;
    res.status(201).json({ saved: rows.length });
  } catch (error) { dbError(res, error); }
});

app.post("/api/installments/:id/pay", async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return bad(res, "Invalid installment id");
  const { date } = req.body || {};
  if (!validDate(date)) return bad(res, "Choose a valid payment date");
  try {
    const { error } = await req.db.rpc("record_installment_reminder_payment", {
      p_reminder_id: Number(req.params.id), p_date: date,
    });
    if (error) {
      if (error.code === "P0001") return res.status(409).json({ error: error.message });
      throw error;
    }
    res.json({ ok: true });
  } catch (error) { dbError(res, error); }
});

app.delete("/api/installments/:id", async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return bad(res, "Invalid installment id");
  try {
    const { error } = await req.db.from("installment_reminders").delete().eq("user_id", req.user.id).eq("id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  } catch (error) { dbError(res, error); }
});

// After `npm run build`, the server also serves the React app.
const dist = fileURLToPath(new URL("../client/dist", import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(dist + "/index.html"));
}

const port = process.env.PORT || 3001;
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => console.log(`Budget API on http://${host}:${port}`));
