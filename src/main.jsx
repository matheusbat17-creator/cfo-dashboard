import React, { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } from "react";
import { createRoot } from "react-dom/client";
import { sb } from "./supabase.js";
import "./app.css";

/* ------------------------------------------------------------------ util */
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmt = (v) => BRL.format(v);
const NUM = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (v) => NUM.format(v);
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DAY = 86400000;

const CATS = {
  essencial: ["Essencial", "#7fc4a3"],
  compromisso: ["Compromisso", "#8fb0d6"],
  cortavel: ["Cortável", "#d99a6c"],
  delivery_restaurante: ["Delivery e restaurante", "#d27a6c"],
  compras_online: ["Compras online", "#c58fb5"],
  uber: ["Uber", "#a79ad6"],
  combustivel: ["Combustível", "#9aa39e"],
  cuidados_pessoais: ["Cuidados pessoais", "#d6b36a"],
  vestuario: ["Vestuário", "#a6c46f"],
  presente: ["Presentes", "#c79ad0"],
  viagem: ["Viagem e Carnaval", "#6fb3c9"],
  outros: ["Outros", "#8a9690"],
};
const catName = (k) => (CATS[k] ? CATS[k][0] : k);
const catColor = (k) => (CATS[k] ? CATS[k][1] : "#8a9690");

function todaySP() {
  const p = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", hour12: false }).formatToParts(new Date());
  const g = (t) => Number(p.find((x) => x.type === t).value);
  return { d: g("day"), m: g("month"), y: g("year"), h: g("hour") % 24 };
}
const CLOSE_DAY = 24; // compras até o dia 24 entram na fatura que vence no dia 1 do mês seguinte
function cycleIdFor({ d, m, y }) {
  const idx = m - 1 + (d <= CLOSE_DAY ? 1 : 2);
  return `${MONTHS[idx % 12]}${String((y + Math.floor(idx / 12)) % 100).padStart(2, "0")}`;
}
function cycleDates(c) {
  const due = new Date(c.due_date + "T00:00:00Z");
  const dy = due.getUTCFullYear(), dm = due.getUTCMonth() + 1;
  const [a, b] = c.period_label.split("→").map((s) => s.trim().split("/").map(Number));
  const yEnd = b[1] > dm ? dy - 1 : dy;
  const yStart = a[1] > b[1] ? yEnd - 1 : yEnd;
  return { start: Date.UTC(yStart, a[1] - 1, a[0]), end: Date.UTC(yEnd, b[1] - 1, b[0]) };
}
/* Débito: o ciclo começa no penúltimo dia útil do mês anterior (dia do salário)
   e termina na véspera do penúltimo dia útil do mês de vigência. */
function easterMs(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, day);
}
const holCache = {};
function holidaysOf(y) {
  if (holCache[y]) return holCache[y];
  const set = new Set([[1, 1], [4, 21], [5, 1], [9, 7], [10, 12], [11, 2], [11, 15], [11, 20], [12, 25]].map(([m, d]) => Date.UTC(y, m - 1, d)));
  const e = easterMs(y);
  [-48, -47, -2, 60].forEach((n) => set.add(e + n * DAY));
  return (holCache[y] = set);
}
function isBiz(t) { const dow = new Date(t).getUTCDay(); return dow !== 0 && dow !== 6 && !holidaysOf(new Date(t).getUTCFullYear()).has(t); }
function penultBizDay(y, m) {
  let t = Date.UTC(y, m, 0), n = 0;
  for (;;) { if (isBiz(t)) { n++; if (n === 2) return new Date(t).getUTCDate(); } t -= DAY; }
}
function debitCycleIdFor({ d, m, y }) {
  const idx = (d >= penultBizDay(y, m) ? m : m - 1);
  return `${MONTHS[idx % 12]}${String((y + Math.floor(idx / 12)) % 100).padStart(2, "0")}`;
}
function debitDates(c) {
  const due = new Date(c.due_date + "T00:00:00Z");
  const y = due.getUTCFullYear(), m = due.getUTCMonth() + 1;
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  return { start: Date.UTC(py, pm - 1, penultBizDay(py, pm)), end: Date.UTC(y, m - 1, penultBizDay(y, m)) - DAY };
}
const fmtDM = (ms) => { const d = new Date(ms); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const sumNet = (list) => list.reduce((t, x) => t + x[1] - x[2], 0);
const sumGross = (list) => list.reduce((t, x) => t + x[1], 0);

/* --------------------------------------------------------------- ícones */
const ICONS = {
  home: "M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z",
  card: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M7 15h3",
  bank: "M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 12h.01",
  chart: "M4 19V5M4 19h16M8 15v-3M12 15V8M16 15v-5",
  eye: "M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  eyeoff: "M3 3l18 18M10.6 6a9.6 9.6 0 0 1 1.4-.1c6.4 0 10 6.1 10 6.1a17 17 0 0 1-3.2 3.9M6.7 7.2A16.5 16.5 0 0 0 2 12s3.6 6.5 10 6.5c1.6 0 3-.4 4.2-1M9.9 9.9a2.5 2.5 0 0 0 3.2 3.2",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3",
};
const Icon = ({ n }) => (<svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[n]} /></svg>);

/* ---------------------------------------------------------- privacidade */
const Hide = createContext(false);
const M = ({ v, plain }) => {
  const hidden = useContext(Hide);
  return <span className={"num" + (hidden ? " masked" : "")}>{plain ? v : fmt(v)}</span>;
};

/* ----------------------------------------------------------------- login */
function Gate({ recovery }) {
  const [mode, setMode] = useState(recovery ? "new" : "in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const back = location.origin + location.pathname;

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setOk(""); setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (error) setErr("E-mail ou senha incorretos.");
      } else if (mode === "up") {
        if (pw.length < 12) throw new Error("Use uma senha com pelo menos 12 caracteres.");
        if (pw !== pw2) throw new Error("As senhas não conferem.");
        const { error } = await sb.auth.signUp({ email: email.trim(), password: pw, options: { emailRedirectTo: back } });
        if (error) throw new Error("Não foi possível criar o acesso com este e-mail.");
        setOk("Enviamos um link de confirmação para o seu e-mail. Abra-o e depois volte para entrar.");
        setMode("in");
      } else if (mode === "reset") {
        await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: back });
        setOk("Se o e-mail tiver acesso, você receberá um link para criar uma nova senha.");
        setMode("in");
      } else if (mode === "new") {
        if (pw.length < 12) throw new Error("Use uma senha com pelo menos 12 caracteres.");
        if (pw !== pw2) throw new Error("As senhas não conferem.");
        const { error } = await sb.auth.updateUser({ password: pw });
        if (error) throw new Error("Não foi possível salvar a nova senha. Peça um novo link.");
        location.replace(back);
      }
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  const titles = { in: ["Acesso privado", "Entre para ver as suas finanças."], up: ["Primeiro acesso", "Crie a senha da sua conta. Só o e-mail autorizado é aceito."], reset: ["Nova senha", "Informe o e-mail para receber o link."], new: ["Nova senha", "Escolha uma senha forte, com 12 caracteres ou mais."] };
  return (
    <main className="gate">
      <form className="gate-card" onSubmit={submit} autoComplete="on">
        <div className="crest" aria-hidden="true">C</div>
        <h1>{titles[mode][0]}</h1>
        <p className="sub">{titles[mode][1]}</p>
        {mode !== "new" && (
          <label className="field"><span>E-mail</span>
            <input type="email" inputMode="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        )}
        {mode !== "reset" && (
          <label className="field"><span>{mode === "new" ? "Nova senha" : "Senha"}</span>
            <input type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} required minLength={mode === "in" ? 1 : 12} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        )}
        {(mode === "up" || mode === "new") && (
          <label className="field"><span>Repita a senha</span>
            <input type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        )}
        {err && <p className="err" role="alert">{err}</p>}
        {ok && <p className="ok" role="status">{ok}</p>}
        <button className="primary" disabled={busy}>{busy ? "Aguarde…" : mode === "in" ? "Entrar" : mode === "up" ? "Criar acesso" : mode === "reset" ? "Enviar link" : "Salvar senha"}</button>
        {mode !== "new" && (
          <div className="links">
            <button type="button" onClick={() => { setErr(""); setOk(""); setMode(mode === "up" ? "in" : "up"); }}>{mode === "up" ? "Já tenho acesso" : "Primeiro acesso"}</button>
            <button type="button" onClick={() => { setErr(""); setOk(""); setMode(mode === "reset" ? "in" : "reset"); }}>{mode === "reset" ? "Voltar" : "Esqueci a senha"}</button>
          </div>
        )}
      </form>
    </main>
  );
}

/* -------------------------------------------------------- folha: lançar */
function AddSheet({ cycles, defaultMethod, onClose, onSaved }) {
  const t = todaySP();
  const iso = `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
  const [method, setMethod] = useState(defaultMethod);
  const [value, setValue] = useState("");
  const [desc, setDesc] = useState("");
  const [cat, setCat] = useState("outros");
  const [date, setDate] = useState(iso);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const parts = useMemo(() => { const [y, m, d] = date.split("-").map(Number); return { y, m, d }; }, [date]);
  const cid = method === "debito" ? debitCycleIdFor(parts) : cycleIdFor(parts);
  const cyc = cycles.find((c) => c.id === cid);

  const save = async (e) => {
    e.preventDefault();
    const v = Number(String(value).replace(/\./g, "").replace(",", "."));
    if (!(v > 0)) return setErr("Informe um valor maior que zero.");
    if (!desc.trim()) return setErr("Descreva o gasto.");
    if (!cyc) return setErr("Esta data não tem um ciclo cadastrado.");
    setBusy(true); setErr("");
    const { error } = await sb.from("expenses").insert({
      cycle: cid, date_label: `${String(parts.d).padStart(2, "0")}/${String(parts.m).padStart(2, "0")}`,
      description: desc.trim().slice(0, 120), value: v, category: cat, source: "manual", payment_method: method, status: "confirmed",
    });
    setBusy(false);
    if (error) return setErr("Não foi possível salvar. Tente de novo.");
    onSaved();
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <form className="sheet" onSubmit={save} role="dialog" aria-modal="true" aria-label="Novo lançamento">
        <div className="grab" />
        <h3>Novo lançamento</h3>
        <div className="seg" role="group" aria-label="Forma de pagamento">
          <button type="button" aria-pressed={method === "credito"} onClick={() => setMethod("credito")}>Crédito</button>
          <button type="button" aria-pressed={method === "debito"} onClick={() => setMethod("debito")}>Débito</button>
        </div>
        <div className="two">
          <label className="field"><span>Valor</span><input inputMode="decimal" placeholder="0,00" value={value} onChange={(e) => setValue(e.target.value)} autoFocus /></label>
          <label className="field"><span>Data</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <label className="field"><span>Descrição</span><input value={desc} maxLength={120} onChange={(e) => setDesc(e.target.value)} placeholder="Ex.: iFood almoço" /></label>
        <label className="field"><span>Categoria</span>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>{Object.keys(CATS).map((k) => <option key={k} value={k}>{catName(k)}</option>)}</select></label>
        <p className="hint" style={{ color: "var(--sage)", fontSize: 13, margin: "0 0 12px" }}>{cyc ? (method === "debito" ? `Débito do ciclo ${cyc.label} (${fmtDM(debitDates(cyc).start)} → ${fmtDM(debitDates(cyc).end)}).` : `Entra na fatura ${cyc.label} (${cyc.period_label}).`) : "Sem ciclo cadastrado para esta data."}</p>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="primary" disabled={busy}>{busy ? "Salvando…" : "Salvar lançamento"}</button>
        <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
      </form>
    </>
  );
}

/* ------------------------------------------------------------ componentes */
function Entry({ r, onDelete }) {
  const [ask, setAsk] = useState(false);
  return (
    <div className="row">
      <div className="ico"><Icon n={r.payment_method === "debito" ? "bank" : "card"} /></div>
      <div className="main">
        <b>{r.description}</b>
        <span><span className={"tag" + (r.payment_method === "debito" ? " deb" : "")}>{r.payment_method === "debito" ? "Débito" : "Crédito"}</span>{r.date_label} · {catName(r.category)}{r.installment ? ` · ${r.installment}` : ""}</span>
      </div>
      <div className={"amt" + (r.value === 0 ? " zero" : "")}><M v={r.value} /></div>
      {ask ? (
        <div className="confirm">
          <button className="mini danger" onClick={() => onDelete(r)}>Apagar</button>
          <button className="mini" onClick={() => setAsk(false)}>Não</button>
        </div>
      ) : (
        <button className="trash" aria-label={`Apagar ${r.description}`} onClick={() => setAsk(true)}><Icon n="trash" /></button>
      )}
    </div>
  );
}

function CatBars({ rows, active, onPick }) {
  const tot = {};
  rows.forEach((r) => { tot[r.category] = (tot[r.category] || 0) + r.value; });
  const list = Object.entries(tot).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = list.length ? list[0][1] : 1;
  if (!list.length) return null;
  return (
    <div>
      {list.map(([k, v]) => (
        <button key={k} className="bar" aria-pressed={active === k} onClick={() => onPick(active === k ? null : k)}>
          <div className="head"><span>{catName(k)}</span><span><M v={v} /></span></div>
          <div className="track"><i style={{ width: `${(v / max) * 100}%`, background: catColor(k) }} /></div>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ app privado */
function Private({ session }) {
  const [cycles, setCycles] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [settings, setSettings] = useState({});
  const [state, setState] = useState("loading");
  const [tab, setTab] = useState("home");
  const [cid, setCid] = useState(null);
  const [catFilter, setCatFilter] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState(null);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem("hide") === "1"; } catch { return false; } });
  const [veil, setVeil] = useState(false);
  const [meta, setMeta] = useState(null);
  const lastActive = useRef(Date.now());
  const hiddenAt = useRef(0);

  const load = useCallback(async () => {
    const [c, e, s] = await Promise.all([
      sb.from("cycles").select("id,label,period_label,due_date,salary").order("due_date"),
      sb.from("expenses").select("id,cycle,date_label,description,value,category,installment,status,source,payment_method,needs_review,clarifying_question,created_at").is("deleted_at", null).order("created_at", { ascending: false }).limit(3000),
      sb.from("app_settings").select("key,value"),
    ]);
    if (c.error || e.error || s.error) { setState("error"); return; }
    if (!c.data.length) { setState("denied"); return; }
    setCycles(c.data.map((x) => ({ ...x, salary: Number(x.salary) })));
    setExpenses(e.data.map((r) => ({ ...r, value: Number(r.value) })));
    setSettings(Object.fromEntries(s.data.map((x) => [x.key, x.value])));
    setState("ready");
  }, []);

  useEffect(() => { load(); }, [load]);

  // atualiza ao voltar para o app e a cada minuto enquanto visível; bloqueia por inatividade
  useEffect(() => {
    const touch = () => { lastActive.current = Date.now(); };
    const onVis = () => {
      if (document.hidden) { hiddenAt.current = Date.now(); setVeil(true); }
      else {
        setVeil(false);
        if (hiddenAt.current && Date.now() - hiddenAt.current > 30 * 60 * 1000) { sb.auth.signOut(); return; }
        load();
      }
    };
    const iv = setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - lastActive.current > 30 * 60 * 1000) sb.auth.signOut(); else load();
    }, 60000);
    ["pointerdown", "keydown", "scroll"].forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); ["pointerdown", "keydown", "scroll"].forEach((ev) => window.removeEventListener(ev, touch)); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  const fixedContribution = settings.fixed_contribution ?? 0;
  const budget = settings.debit_budget ?? 1000;
  const metaBase = settings.card_meta_aporte ?? 640;
  const gympass = settings.gympass ?? 0;
  const fixas = settings.fixas ?? [];
  const goals = settings.goals ?? [];
  const checkpoints = settings.checkpoints ?? [];
  const forecastMap = useMemo(() => Object.fromEntries((settings.forecast ?? []).map((f) => [f.id, f.parcelas])), [settings]);
  const metaAporte = meta ?? metaBase;

  const nowId = cycleIdFor(todaySP());
  const finId = debitCycleIdFor(todaySP());
  useEffect(() => { if (cycles.length && !cid) setCid(cycles.find((c) => c.id === finId) ? finId : cycles[cycles.length - 1].id); }, [cycles, cid, finId]);

  const by = useMemo(() => {
    const o = {};
    cycles.forEach((c) => { o[c.id] = { card: 0, deb: 0, debN: 0, rows: [] }; });
    expenses.forEach((r) => {
      const b = o[r.cycle]; if (!b) return;
      b.rows.push(r);
      if (r.status === "pending_method") return;
      if (r.payment_method === "debito") { b.deb += r.value; b.debN++; } else b.card += r.value;
    });
    return o;
  }, [cycles, expenses]);

  const summarize = useCallback((c) => {
    const b = by[c.id] || { card: 0, deb: 0, debN: 0, rows: [] };
    const fc = forecastMap[c.id];
    const floor = fc ? sumNet(fixas) + sumNet(fc) : 0;
    const gym = fc ? gympass : 0;
    const cardProj = b.card + floor;
    const aporte = c.salary - cardProj - gym - fixedContribution - Math.max(budget, b.deb);
    const aporteHist = c.salary - b.card - fixedContribution - (b.debN ? b.deb : budget);
    return { ...b, fc, floor, gym, cardProj, aporte, aporteHist, sobraDeb: Math.max(0, budget - b.deb) };
  }, [by, forecastMap, fixas, gympass, fixedContribution, budget]);

  const cur = cycles.find((c) => c.id === cid);
  const sum = cur ? summarize(cur) : null;
  const dates = cur ? cycleDates(cur) : null;
  const t = todaySP();
  const today = Date.UTC(t.y, t.m - 1, t.d);
  const daysLeft = dates ? (today > dates.end ? 0 : today < dates.start ? Math.round((dates.end - dates.start) / DAY) + 1 : Math.round((dates.end - today) / DAY) + 1) : 0;

  const dd = cur ? debitDates(cur) : null;
  const daysLeftDeb = dd ? (today > dd.end ? 0 : today < dd.start ? Math.round((dd.end - dd.start) / DAY) + 1 : Math.round((dd.end - today) / DAY) + 1) : 0;
  const isOpenDeb = !!dd && today <= dd.end;

  const del = async (r) => {
    await sb.from("expenses").update({ deleted_at: new Date().toISOString() }).eq("id", r.id);
    setToast({ msg: "Lançamento apagado.", undo: async () => { await sb.from("expenses").update({ deleted_at: null }).eq("id", r.id); setToast(null); load(); } });
    setTimeout(() => setToast((x) => (x && x.msg === "Lançamento apagado." ? null : x)), 7000);
    load();
  };
  const pickMethod = async (r, m) => { await sb.from("expenses").update({ payment_method: m, status: r.needs_review ? "pending_review" : "confirmed" }).eq("id", r.id); load(); };
  const pickCat = async (r, cat) => { await sb.from("expenses").update({ category: cat, status: "confirmed", needs_review: false }).eq("id", r.id); load(); };
  const toggleHide = () => setHidden((h) => { const n = !h; try { localStorage.setItem("hide", n ? "1" : "0"); } catch { /* ok */ } return n; });

  if (state === "loading") return <div className="loading">Abrindo…</div>;
  if (state === "denied") return (<div className="gate"><div className="gate-card"><div className="crest" aria-hidden="true">C</div><h1>Sem acesso</h1><p className="sub">Esta conta não está autorizada a ver estes dados.</p><button className="primary" onClick={() => sb.auth.signOut()}>Sair</button></div></div>);
  if (state === "error") return (<div className="gate"><div className="gate-card"><h1>Sem conexão</h1><p className="sub">Não foi possível carregar os dados. Verifique a internet e tente de novo.</p><button className="primary" onClick={() => { setState("loading"); load(); }}>Tentar de novo</button></div></div>);

  const hour = t.h;
  const hello = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const name = settings.display_name || "";
  const visibleCycles = cycles.filter((c) => c.due_date <= (cycles.find((x) => x.id === nowId)?.due_date ? addMonths(cycles.find((x) => x.id === nowId).due_date, 2) : "9999"));
  const pendings = expenses.filter((r) => r.status === "pending_method" || r.status === "pending_review");
  const meta62 = metaAporte * 0.625;
  const level = !sum ? "" : sum.aporte >= metaAporte ? "" : sum.aporte >= meta62 ? "amber" : "red";
  const levelText = level === "" ? "Dentro da meta" : level === "amber" ? "Atenção: perto do limite" : "Abaixo da meta";
  const isOpen = cur && today <= dates.end;
  const folga = sum ? Math.max(0, sum.aporte - metaAporte) : 0;

  const listRows = (rows, method) => rows.filter((r) => r.payment_method === method && r.status !== "pending_method" && (!catFilter || r.category === catFilter));

  return (
    <Hide.Provider value={hidden}>
      <div className="shell">
        <header className="top">
          <div className="who">
            <div className="mono" aria-hidden="true">{(name || "C")[0].toUpperCase()}</div>
            <div><b>{hello}{name ? `, ${name}` : ""}</b><span>Visão do ciclo {cur ? cur.label : ""}</span></div>
          </div>
          <div className="tools">
            <button className="ibtn" onClick={toggleHide} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}><Icon n={hidden ? "eyeoff" : "eye"} /></button>
            <button className="ibtn" onClick={() => sb.auth.signOut()} aria-label="Sair"><Icon n="lock" /></button>
          </div>
        </header>

        {(tab === "home" || tab === "card" || tab === "debit") && (
          <div className="chips" role="group" aria-label="Ciclo">
            {visibleCycles.map((c) => (
              <button key={c.id} className="chip" aria-pressed={c.id === cid} onClick={() => { setCid(c.id); setCatFilter(null); }}>{c.label}</button>
            ))}
          </div>
        )}

        {tab === "home" && cur && sum && (
          <>
            <section className="hero" aria-label="Aporte projetado">
              <p className="hero-label">Aporte projetado para o cofrinho</p>
              <p className="hero-fig"><small>R$</small><M v={fmtNum(sum.aporte)} plain /></p>
              <div className="status"><span className={"dot " + level} /> {levelText}</div>
              {(() => {
                const max = Math.max(metaAporte * 2, sum.aporte * 1.05, 1);
                return (
                  <>
                    <div className="gauge"><i style={{ width: `${Math.min(100, Math.max(0, sum.aporte / max) * 100)}%` }} /><b style={{ left: `${(metaAporte / max) * 100}%` }} /></div>
                    <div className="gauge-cap"><span>Meta <em><M v={metaAporte} /></em></span>{sum.sobraDeb > 0 && isOpenDeb ? <span>+ <M v={sum.sobraDeb} /> se sobrar no débito</span> : <span />}</div>
                  </>
                );
              })()}
            </section>

            <div className="pair">
              <div><p>Cartão de crédito</p><strong><M v={sum.cardProj} /></strong><span>{sum.fc ? <>fixos e parcelas <M v={sum.floor} /></> : "fatura do ciclo"}</span></div>
              <div><p>Débito</p><strong><M v={sum.deb} /></strong><span>{sum.deb > budget ? "acima do orçamento" : <>restam <M v={sum.sobraDeb} /> de <M v={budget} /></>}</span></div>
            </div>

            {isOpen && folga > 0 && (
              <section className="sec">
                <h2>Folga no cartão</h2>
                <p className="hint">Você ainda pode gastar <b style={{ color: "var(--ivory)" }}><M v={folga} /></b> no cartão neste ciclo{daysLeft > 0 ? <>, cerca de <b style={{ color: "var(--ivory)" }}><M v={folga / daysLeft} /></b> por dia,</> : ""} e manter a meta.</p>
              </section>
            )}

            {pendings.length > 0 && (
              <section className="pending" aria-label="Pendências">
                <h3>Falta confirmar {pendings.length === 1 ? "1 lançamento" : `${pendings.length} lançamentos`}</h3>
                {pendings.map((r) => (
                  <div className="it" key={r.id}>
                    <b>{r.description} · <M v={r.value} /></b>
                    {r.status === "pending_method" ? (
                      <><button className="mini" onClick={() => pickMethod(r, "credito")}>Crédito</button><button className="mini" onClick={() => pickMethod(r, "debito")}>Débito</button></>
                    ) : (
                      <select defaultValue="" onChange={(e) => e.target.value && pickCat(r, e.target.value)} aria-label="Categoria">
                        <option value="" disabled>Categoria…</option>{Object.keys(CATS).map((k) => <option key={k} value={k}>{catName(k)}</option>)}
                      </select>
                    )}
                  </div>
                ))}
              </section>
            )}

            <section className="sec">
              <h2>Movimentação recente</h2>
              {sum.rows.filter((r) => r.status !== "pending_method").slice(0, 6).length ? (
                sum.rows.filter((r) => r.status !== "pending_method").slice(0, 6).map((r) => <Entry key={r.id} r={r} onDelete={del} />)
              ) : (
                <div className="empty">Nada lançado em {cur.label} ainda. Mande um gasto pelo Telegram ou toque em Lançar.</div>
              )}
            </section>
          </>
        )}

        {tab === "card" && cur && sum && (
          <>
            <section className="hero">
              <p className="hero-label">Fatura de {cur.label}{sum.fc ? ", prevista" : ""}</p>
              <p className="hero-fig"><small>R$</small><M v={fmtNum(sum.cardProj)} plain /></p>
              <div className="status">Vence em {cur.due_date.split("-").reverse().join("/")}, compras de {cur.period_label}</div>
            </section>
            <section className="sec">
              <h2>Por categoria</h2>
              <p className="hint">Toque em uma categoria para filtrar a lista.</p>
              <CatBars rows={sum.rows.filter((r) => r.payment_method !== "debito" && r.status !== "pending_method")} active={catFilter} onPick={setCatFilter} />
            </section>
            {sum.fc && (
              <section className="sec">
                <h2>Já previsto neste ciclo</h2>
                <p className="hint">Fixos e parcelas que ainda vão cair na fatura (já sem os reembolsos): <M v={sum.floor} />.</p>
                <details>
                  <summary style={{ color: "var(--brass)", cursor: "pointer", padding: "6px 0" }}>Ver os itens</summary>
                  {[...fixas, ...sum.fc].map((x, i) => (
                    <div className="row" key={i}><div className="main"><b>{x[0]}</b></div><div className="amt"><M v={x[1] - x[2]} /></div></div>
                  ))}
                </details>
              </section>
            )}
            <section className="sec">
              <h2>Lançamentos{catFilter ? `: ${catName(catFilter)}` : ""}</h2>
              {listRows(sum.rows, "credito").length ? listRows(sum.rows, "credito").map((r) => <Entry key={r.id} r={r} onDelete={del} />) : <div className="empty">Nenhum lançamento no crédito neste ciclo.</div>}
            </section>
          </>
        )}

        {tab === "debit" && cur && sum && (
          <>
            <section className="hero">
              <p className="hero-label">Débito em {cur.label}, de {fmtDM(dd.start)} a {fmtDM(dd.end)}</p>
              <div className="ring-wrap" style={{ marginTop: 14 }}>
                {(() => {
                  const r = 54, c = 2 * Math.PI * r, p = Math.min(1, sum.deb / budget);
                  return (
                    <div className="ring" role="img" aria-label={`${Math.round((sum.deb / budget) * 100)}% do orçamento usado`}>
                      <svg viewBox="0 0 132 132"><circle className="bg" cx="66" cy="66" r={r} /><circle className={"fg" + (sum.deb > budget ? " over" : "")} cx="66" cy="66" r={r} strokeDasharray={`${c * p} ${c}`} /></svg>
                      <div className="mid"><b>{Math.round((sum.deb / budget) * 100)}%</b><span>usado</span></div>
                    </div>
                  );
                })()}
                <div className="ring-facts">
                  <p>Gasto<b><M v={sum.deb} /></b></p>
                  <p>{sum.deb > budget ? "Acima do orçamento" : "Ainda disponível"}<b><M v={sum.deb > budget ? sum.deb - budget : sum.sobraDeb} /></b></p>
                  {isOpenDeb && sum.sobraDeb > 0 && daysLeftDeb > 0 && <p>Por dia, até {fmtDM(dd.end)}<b><M v={sum.sobraDeb / daysLeftDeb} /></b></p>}
                </div>
              </div>
            </section>
            <section className="sec">
              <h2>Por categoria</h2>
              <CatBars rows={sum.rows.filter((r) => r.payment_method === "debito" && r.status !== "pending_method")} active={catFilter} onPick={setCatFilter} />
            </section>
            <section className="sec">
              <h2>Lançamentos no débito</h2>
              {listRows(sum.rows, "debito").length ? listRows(sum.rows, "debito").map((r) => <Entry key={r.id} r={r} onDelete={del} />) : <div className="empty">Nenhum gasto no débito neste ciclo. O que sobrar do orçamento de <M v={budget} /> vai para o cofrinho.</div>}
            </section>
          </>
        )}

        {tab === "goals" && (
          <>
            <section className="sec" style={{ marginTop: 6 }}>
              <h2>Metas</h2>
              {goals.map((g) => {
                const p = Math.min(100, (g.saved / g.target) * 100);
                return (
                  <div className="goal" key={g.id}>
                    <div className="head"><b>{g.name}</b><span>{g.deadline}</span></div>
                    <div className="track"><i style={{ width: `${p}%` }} /></div>
                    <div className="foot"><span><M v={g.saved} /> de <M v={g.target} /></span><span>{Math.round(p)}%</span></div>
                  </div>
                );
              })}
            </section>
            <section className="sec">
              <h2>Aporte por ciclo</h2>
              <p className="hint">Salário menos cartão, contribuição fixa e débito (ou orçamento, quando não há débito lançado).</p>
              {(() => {
                const hist = cycles.filter((c) => cycleDates(c).end < today).filter((c) => (by[c.id]?.card || 0) > 0).slice(-8).map((c) => ({ c, a: summarize(c).aporteHist }));
                const mx = Math.max(...hist.map((h) => h.a), 1);
                return (
                  <div className="bars">
                    {hist.map(({ c, a }) => (
                      <div key={c.id}><em><M v={Math.round(a)} plain /></em><i className={a >= metaAporte ? "" : a >= meta62 ? "amber" : "red"} style={{ height: `${Math.max(4, (Math.max(a, 0) / mx) * 82)}%` }} /><span>{c.label.split("/")[0]}</span></div>
                    ))}
                  </div>
                );
              })()}
            </section>
            <section className="sec">
              <h2>Marcos do cofrinho</h2>
              {checkpoints.map((cp) => (
                <div className="row" key={cp.cycle}><div className="main"><b>{cp.cycle}</b></div><div className="amt"><M v={cp.target} /></div></div>
              ))}
            </section>
          </>
        )}

        {tab === "plan" && (() => {
          const fcs = cycles.filter((c) => forecastMap[c.id]);
          const rows = fcs.map((c) => {
            const par = forecastMap[c.id];
            const fatura = sumGross(fixas) + sumGross(par);
            const reemb = fixas.reduce((t, x) => t + x[2], 0) + par.reduce((t, x) => t + x[2], 0);
            const liq = fatura - reemb;
            const apMax = c.salary - liq - gympass - fixedContribution - budget;
            return { c, fixasV: sumGross(fixas), parV: sumGross(par), fatura, reemb, liq, apMax, folga: Math.max(0, apMax - metaAporte) };
          });
          const line = (label, f, cls, strong) => (<tr className={strong ? "strong" : ""}><td>{label}</td>{rows.map((r) => <td key={r.c.id} className={cls || ""}><M v={f(r)} /></td>)}</tr>);
          return (
            <>
              <section className="sec" style={{ marginTop: 6 }}>
                <h2>Quanto ainda posso gastar</h2>
                <p className="hint">Além dos fixos e das parcelas já mapeados, no cartão, mantendo a meta de aporte.</p>
                <label className="meta-input">Meta de aporte por ciclo, R$ <input type="number" inputMode="decimal" value={metaAporte} onChange={(e) => setMeta(Number(e.target.value) || 0)} /></label>
                <div className="slack" style={{ gridTemplateColumns: `repeat(${Math.max(1, rows.length)}, 1fr)` }}>
                  {rows.map((r) => {
                    const dts = cycleDates(r.c), dias = Math.round((dts.end - dts.start) / DAY) + 1;
                    return (<div key={r.c.id}><span>{r.c.label}</span><b><M v={r.folga} /></b><span><M v={r.folga / dias} /> por dia</span></div>);
                  })}
                </div>
              </section>
              <section className="sec">
                <h2>Projeção dos próximos ciclos</h2>
                <p className="hint">Só o que já está mapeado: despesas fixas e parcelas restantes.</p>
                <div className="scroll-x">
                  <table className="tbl">
                    <thead><tr><th></th>{rows.map((r) => <th key={r.c.id}>{r.c.label}</th>)}</tr></thead>
                    <tbody>
                      {line("Salário líquido", (r) => r.c.salary)}
                      {line("Despesas fixas", (r) => r.fixasV)}
                      {line("Parcelas", (r) => r.parV)}
                      {line("Fatura no cartão", (r) => r.fatura, "", true)}
                      {line("Reembolsos", (r) => -r.reemb, "pos")}
                      {line("Fatura líquida", (r) => r.liq, "", true)}
                      {line("Gympass", (r) => -gympass, "neg")}
                      {line("Contribuição fixa", (r) => -fixedContribution, "neg")}
                      {line("Orçamento do débito", (r) => -budget, "neg")}
                      {line("Aporte máximo", (r) => r.apMax, "pos", true)}
                      {line("Folga para gastar", (r) => r.folga, "pos", true)}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          );
        })()}
      </div>

      {(tab === "home" || tab === "card" || tab === "debit") && (
        <button className="fab" onClick={() => setSheet(tab === "debit" ? "debito" : "credito")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Lançar</button>
      )}

      <div className="tabbar"><nav aria-label="Navegação">
        {[["home", "Início", "home"], ["card", "Cartão", "card"], ["debit", "Débito", "bank"], ["goals", "Metas", "target"], ["plan", "Previsão", "chart"]].map(([k, l, i]) => (
          <button key={k} className="tab" aria-current={tab === k ? "page" : undefined} onClick={() => { setTab(k); setCatFilter(null); window.scrollTo(0, 0); }}><Icon n={i} />{l}</button>
        ))}
      </nav></div>

      {sheet && <AddSheet cycles={cycles} defaultMethod={sheet} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} />}
      {toast && <div className="toast" role="status">{toast.msg}{toast.undo && <button onClick={toast.undo}>Desfazer</button>}</div>}
      {veil && <div className="privacy-veil" aria-hidden="true">Protegido</div>}
    </Hide.Provider>
  );
}

function addMonths(iso, n) {
  const [y, m] = iso.split("-").map(Number);
  const idx = m - 1 + n;
  return `${y + Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`;
}

/* ------------------------------------------------------------------ raiz */
function App() {
  const [session, setSession] = useState(undefined);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((ev, s) => { if (ev === "PASSWORD_RECOVERY") setRecovery(true); setSession(s); });
    return () => sub.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <div className="loading">Abrindo…</div>;
  if (!session || recovery) return <Gate recovery={recovery} />;
  return <Private session={session} />;
}

// não renderiza dentro de iframe (evita clickjacking)
if (window.top === window.self) {
  createRoot(document.getElementById("root")).render(<App />);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
