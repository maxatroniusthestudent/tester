/* FinanceFlow — великий проєкт на vanilla JS
 * Архітектура: store + selectors + ui render
 * Дані: localStorage
 * Фічі: транзакції, бюджети, цілі, звіти, CSV/JSON, тема
 * Loader: показ на старті + при F5/оновленні (через sessionStorage)
 */

(function () {
  // =========================
  // Loader (показ при заході + при F5)
  // =========================
  const loaderEl = document.getElementById("loader");

  const showLoader = () => {
    if (!loaderEl) return;
    loaderEl.classList.remove("loader--hidden");
    loaderEl.setAttribute("aria-hidden", "false");
  };

  const hideLoader = () => {
    if (!loaderEl) return;
    loaderEl.classList.add("loader--hidden");
    loaderEl.setAttribute("aria-hidden", "true");
    // прибрати з DOM після анімації
    setTimeout(() => loaderEl.remove(), 380);
    try { sessionStorage.removeItem("ff_show_loader"); } catch (e) {}
  };

  // якщо це було оновлення/перезавантаження — залишаємо loader видимим
  try {
    const shouldShow = sessionStorage.getItem("ff_show_loader") === "1";
    if (shouldShow) showLoader();
  } catch (e) {}

  // позначаємо, що при наступному перезавантаженні треба показати loader
  window.addEventListener("beforeunload", () => {
    try { sessionStorage.setItem("ff_show_loader", "1"); } catch (e) {}
    showLoader();
  });

  // =========================
  // Utils
  // =========================
  const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  const toISODate = (d) => {
    const dt = (d instanceof Date) ? d : new Date(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const monthKey = (isoDate) => isoDate.slice(0, 7); // YYYY-MM
  const nowISO = () => toISODate(new Date());

  const formatMoney = (value, currency) => {
    const v = Number(value) || 0;
    const sign = v < 0 ? "-" : "";
    const abs = Math.abs(v);
    return `${sign}${currency}${abs.toFixed(2)}`;
  };

  const downloadText = (filename, text) => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  };

  const parseCSV = (csvText) => {
    const lines = csvText.trim().split(/\r?\n/);
    const rows = lines.map((line) => {
      const out = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === "," && !inQuotes) { out.push(cur); cur = ""; continue; }
        cur += ch;
      }
      out.push(cur);
      return out.map(s => s.trim());
    });
    const header = rows.shift().map(h => h.toLowerCase());
    return rows.map((r) => {
      const obj = {};
      header.forEach((h, i) => obj[h] = r[i] ?? "");
      return obj;
    });
  };

  const toCSV = (rows) => {
    const esc = (s) => {
      const str = String(s ?? "");
      if (/[",\n]/.test(str)) return `"${str.replaceAll('"', '""')}"`;
      return str;
    };
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(headers.map(h => esc(row[h])).join(","));
    }
    return lines.join("\n");
  };

  // =========================
  // Storage
  // =========================
  const LS_KEY = "financeflow:v1";

  const defaultState = () => ({
    settings: {
      theme: "dark",
      currency: "₴",
    },
    categories: [
      { id: "cat_food", name: "Їжа" },
      { id: "cat_rent", name: "Оренда" },
      { id: "cat_auto", name: "Авто" },
      { id: "cat_health", name: "Здоров'я" },
      { id: "cat_fun", name: "Розваги" },
      { id: "cat_subs", name: "Підписки" },
      { id: "cat_other", name: "Інше" },
    ],
    transactions: [
      { id: uid(), type: "income", date: nowISO(), categoryId: "cat_other", amount: 1200, note: "Зарплата (demo)" },
      { id: uid(), type: "expense", date: nowISO(), categoryId: "cat_food", amount: 45.70, note: "Groceries (demo)" },
      { id: uid(), type: "expense", date: nowISO(), categoryId: "cat_subs", amount: 12.99, note: "Subscription (demo)" },
    ],
    budgets: [],
    goals: [],
  });

  const loadState = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      return {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings || {}) },
      };
    } catch {
      return defaultState();
    }
  };

  const saveState = (state) => {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  };

  // =========================
  // Store (simple)
  // =========================
  let state = loadState();

  const setState = (patchFn) => {
    const next = patchFn(structuredClone(state));
    state = next;
    saveState(state);
    renderAll();
  };

  // =========================
  // Selectors (calculations)
  // =========================
  const getCategoryName = (id) => state.categories.find(c => c.id === id)?.name ?? "—";

  const txSorted = () =>
    [...state.transactions].sort((a, b) => (a.date < b.date ? 1 : -1));

  const monthTotals = (yyyymm) => {
    let income = 0, expense = 0;
    for (const t of state.transactions) {
      if (monthKey(t.date) !== yyyymm) continue;
      if (t.type === "income") income += Number(t.amount) || 0;
      else expense += Number(t.amount) || 0;
    }
    return { income: round2(income), expense: round2(expense), net: round2(income - expense) };
  };

  const balanceAllTime = () => {
    let income = 0, expense = 0;
    for (const t of state.transactions) {
      if (t.type === "income") income += Number(t.amount) || 0;
      else expense += Number(t.amount) || 0;
    }
    return round2(income - expense);
  };

  const expensesByCategory = (fromISO, toISO) => {
    const from = fromISO ? new Date(fromISO) : null;
    const to = toISO ? new Date(toISO) : null;
    const map = new Map();
    for (const t of state.transactions) {
      if (t.type !== "expense") continue;
      const d = new Date(t.date);
      if (from && d < from) continue;
      if (to && d > to) continue;
      const key = t.categoryId;
      map.set(key, (map.get(key) || 0) + (Number(t.amount) || 0));
    }
    const arr = [...map.entries()].map(([categoryId, value]) => ({
      categoryId,
      label: getCategoryName(categoryId),
      value: round2(value),
    }));
    arr.sort((a, b) => b.value - a.value);
    return arr;
  };

  // =========================
  // UI helpers (toast, modal)
  // =========================
  const toastEl = document.getElementById("toast");
  const toast = (title, text = "") => {
    const item = document.createElement("div");
    item.className = "toast__item";
    item.innerHTML = `<div class="toast__title">${title}</div><div class="toast__text">${text}</div>`;
    toastEl.appendChild(item);
    setTimeout(() => item.remove(), 3200);
  };

  const modalEl = document.getElementById("modal");
  const openModal = () => {
    modalEl.classList.add("modal--open");
    modalEl.setAttribute("aria-hidden", "false");
  };
  const closeModal = () => {
    modalEl.classList.remove("modal--open");
    modalEl.setAttribute("aria-hidden", "true");
  };

  modalEl.addEventListener("click", (e) => {
    const target = e.target;
    if (target && target.hasAttribute("data-modal-close")) closeModal();
  });

  // =========================
  // Routing
  // =========================
  const pageTitle = document.getElementById("pageTitle");
  const pageMeta = document.getElementById("pageMeta");

  const titles = {
    dashboard: ["Дашборд", "Огляд фінансів за поточний місяць"],
    transactions: ["Транзакції", "Повний список та фільтри"],
    budgets: ["Бюджети", "Ліміти витрат по категоріях"],
    goals: ["Цілі", "Накопичення та прогрес"],
    reports: ["Звіти", "Аналітика за період"],
    settings: ["Налаштування", "Тема, валюта, бекап"],
  };

  const setRoute = (route) => {
    document.querySelectorAll(".nav__item").forEach(btn => {
      btn.classList.toggle("nav__item--active", btn.dataset.route === route);
    });
    document.querySelectorAll(".view").forEach(v => {
      v.classList.toggle("view--active", v.dataset.view === route);
    });
    pageTitle.textContent = titles[route][0];
    pageMeta.textContent = titles[route][1];
  };

  document.querySelectorAll(".nav__item").forEach(btn => {
    btn.addEventListener("click", () => setRoute(btn.dataset.route));
  });

  document.querySelectorAll("[data-route-jump]").forEach(btn => {
    btn.addEventListener("click", () => setRoute(btn.dataset.routeJump));
  });

  // =========================
  // Charts (Canvas simple)
  // =========================
  const drawPie = (canvas, items, currency) => {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = 220, cy = h / 2;
    const r = 130;

    const total = items.reduce((s, it) => s + it.value, 0) || 1;

    ctx.globalAlpha = 0.2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = "#999"; ctx.fill();
    ctx.globalAlpha = 1;

    let start = -Math.PI / 2;
    const palette = ["#7c5cff", "#32d583", "#ffd35c", "#ff5c7a", "#2dd4bf", "#a78bfa", "#fb7185"];

    items.slice(0, 7).forEach((it, i) => {
      const angle = (it.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = palette[i % palette.length];
      ctx.fill();
      start += angle;
    });

    const lx = 420, ly = 60;
    ctx.font = "600 14px ui-sans-serif, system-ui";
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text").trim() || "#fff";

    const top = items.slice(0, 7);
    top.forEach((it, i) => {
      const y = ly + i * 38;
      ctx.fillStyle = palette[i % palette.length];
      ctx.fillRect(lx, y, 14, 14);
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text").trim() || "#fff";
      ctx.fillText(it.label, lx + 22, y + 12);
      ctx.globalAlpha = 0.75;
      ctx.fillText(formatMoney(it.value, currency), lx + 220, y + 12);
      ctx.globalAlpha = 1;
    });

    ctx.globalAlpha = 0.7;
    ctx.fillText(`Всього: ${formatMoney(total, currency)}`, lx, ly + top.length * 38 + 16);
    ctx.globalAlpha = 1;
  };

  const drawLine = (canvas, points) => {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pad = 40;
    const min = Math.min(...points.map(p => p.y));
    const max = Math.max(...points.map(p => p.y));
    const span = (max - min) || 1;

    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = "#999";
    for (let i = 0; i < 6; i++) {
      const y = pad + (i * (h - 2 * pad)) / 5;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const xAt = (i) => pad + (i * (w - 2 * pad)) / (points.length - 1 || 1);
    const yAt = (val) => (h - pad) - ((val - min) * (h - 2 * pad)) / span;

    ctx.lineWidth = 3;
    ctx.strokeStyle = "#7c5cff";
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xAt(i);
      const y = yAt(p.y);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = "#32d583";
    points.forEach((p, i) => {
      const x = xAt(i);
      const y = yAt(p.y);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  // =========================
  // DOM refs
  // =========================
  const el = (id) => document.getElementById(id);

  const statBalance = el("statBalance");
  const statIncomeMonth = el("statIncomeMonth");
  const statExpenseMonth = el("statExpenseMonth");
  const statSavingsMonth = el("statSavingsMonth");
  const recentTx = el("recentTx");

  const txList = el("txList");
  const txSearch = el("txSearch");
  const txType = el("txType");
  const txCategory = el("txCategory");
  const txFrom = el("txFrom");
  const txTo = el("txTo");
  const txReset = el("txReset");

  const budgetForm = el("budgetForm");
  const budgetCategory = el("budgetCategory");
  const budgetLimit = el("budgetLimit");
  const budgetList = el("budgetList");
  const budgetTips = el("budgetTips");

  const goalForm = el("goalForm");
  const goalTitle = el("goalTitle");
  const goalTarget = el("goalTarget");
  const goalList = el("goalList");
  const goalPick = el("goalPick");
  const goalAddForm = el("goalAddForm");
  const goalAddAmount = el("goalAddAmount");
  const goalNote = el("goalNote");

  const repFrom = el("repFrom");
  const repTo = el("repTo");
  const repBuild = el("repBuild");
  const repIncome = el("repIncome");
  const repExpense = el("repExpense");
  const repNet = el("repNet");
  const repCount = el("repCount");

  const chartPie = el("chartPie");
  const chartLine = el("chartLine");
  const chartRepPie = el("chartRepPie");
  const chartRepLine = el("chartRepLine");

  const btnAddTransaction = el("btnAddTransaction");
  const btnTheme = el("btnTheme");
  const btnExportCSV = el("btnExportCSV");
  const fileImportCSV = el("fileImportCSV");

  const btnExportJSON = el("btnExportJSON");
  const fileImportJSON = el("fileImportJSON");
  const btnResetAll = el("btnResetAll");

  const setCurrency = el("setCurrency");
  const setSaveCurrency = el("setSaveCurrency");

  // modal form
  const txForm = el("txForm");
  const txId = el("txId");
  const txFormType = el("txFormType");
  const txFormDate = el("txFormDate");
  const txFormCategory = el("txFormCategory");
  const txFormAmount = el("txFormAmount");
  const txFormNote = el("txFormNote");

  // =========================
  // Render pieces
  // =========================
  const fillCategorySelect = (select, allowAll = false) => {
    const cur = select.value;
    select.innerHTML = "";
    if (allowAll) {
      const opt = document.createElement("option");
      opt.value = "all";
      opt.textContent = "Всі категорії";
      select.appendChild(opt);
    }
    for (const c of state.categories) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      select.appendChild(opt);
    }
    if ([...select.options].some(o => o.value === cur)) select.value = cur;
  };

  const renderStats = () => {
    const currency = state.settings.currency;
    const m = monthKey(nowISO());
    const { income, expense, net } = monthTotals(m);

    statBalance.textContent = formatMoney(balanceAllTime(), currency);
    statIncomeMonth.textContent = formatMoney(income, currency);
    statExpenseMonth.textContent = formatMoney(expense, currency);
    statSavingsMonth.textContent = formatMoney(net, currency);
  };

  const renderRecentTx = () => {
    const currency = state.settings.currency;
    const rows = txSorted().slice(0, 6);
    recentTx.innerHTML = "";
    rows.forEach((t) => {
      const row = document.createElement("div");
      row.className = "table__row";
      const sign = t.type === "expense" ? "-" : "+";
      const cls = t.type === "expense" ? "stat__value--bad" : "stat__value--good";
      row.innerHTML = `
        <div class="table__cell">${t.date}</div>
        <div class="table__cell">${t.type === "expense" ? "Витрата" : "Дохід"}</div>
        <div class="table__cell">${getCategoryName(t.categoryId)}</div>
        <div class="table__cell">${t.note || "—"}</div>
        <div class="table__cell table__cell--right ${cls}">${sign}${formatMoney(t.amount, currency)}</div>
      `;
      recentTx.appendChild(row);
    });
  };

  const matchTxFilters = (t) => {
    const q = (txSearch.value || "").trim().toLowerCase();
    const type = txType.value;
    const cat = txCategory.value;
    const from = txFrom.value ? new Date(txFrom.value) : null;
    const to = txTo.value ? new Date(txTo.value) : null;

    if (type !== "all" && t.type !== type) return false;
    if (cat !== "all" && t.categoryId !== cat) return false;
    if (q && !(t.note || "").toLowerCase().includes(q)) return false;

    const d = new Date(t.date);
    if (from && d < from) return false;
    if (to && d > to) return false;

    return true;
  };

  const renderTxList = () => {
    const currency = state.settings.currency;
    const list = txSorted().filter(matchTxFilters);
    txList.innerHTML = "";

    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "note note--muted";
      empty.textContent = "Нема транзакцій під ці фільтри.";
      txList.appendChild(empty);
      return;
    }

    list.forEach((t) => {
      const row = document.createElement("div");
      row.className = "table__row";
      const sign = t.type === "expense" ? "-" : "+";
      const cls = t.type === "expense" ? "stat__value--bad" : "stat__value--good";
      row.innerHTML = `
        <div class="table__cell">${t.date}</div>
        <div class="table__cell">${t.type === "expense" ? "Витрата" : "Дохід"}</div>
        <div class="table__cell">${getCategoryName(t.categoryId)}</div>
        <div class="table__cell">${t.note || "—"}</div>
        <div class="table__cell table__cell--right ${cls}">${sign}${formatMoney(t.amount, currency)}</div>
        <div class="table__cell table__cell--right">
          <div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
            <button class="btn btn--ghost" data-edit="${t.id}">Ред.</button>
            <button class="btn btn--danger" data-del="${t.id}">X</button>
          </div>
        </div>
      `;
      txList.appendChild(row);
    });
  };

  const renderBudgets = () => {
    const currency = state.settings.currency;
    const m = monthKey(nowISO());
    const monthExpenses = expensesByCategory(`${m}-01`, `${m}-31`);
    const budgetMap = new Map(state.budgets.filter(b => b.month === m).map(b => [b.categoryId, b]));

    budgetList.innerHTML = "";
    const items = state.categories.map((c) => {
      const spent = monthExpenses.find(x => x.categoryId === c.id)?.value || 0;
      const b = budgetMap.get(c.id);
      const limit = b?.limit ?? 0;
      const pct = limit > 0 ? clamp((spent / limit) * 100, 0, 130) : 0;
      const left = limit > 0 ? round2(limit - spent) : 0;
      const isOver = limit > 0 && spent > limit;

      return { c, spent, limit, pct, left, isOver };
    }).filter(x => x.limit > 0 || x.spent > 0);

    if (!items.length) {
      budgetList.innerHTML = `<div class="note note--muted">Поки нема бюджетів. Додай ліміт по категорії.</div>`;
    } else {
      items.forEach((it) => {
        const row = document.createElement("div");
        row.className = "item";
        row.innerHTML = `
          <div class="item__top">
            <div>
              <div class="item__title">${it.c.name}</div>
              <div class="item__meta">
                Витрачено: ${formatMoney(it.spent, currency)} • Ліміт: ${formatMoney(it.limit, currency)} •
                ${it.isOver ? `<span style="color: var(--bad); font-weight:800;">Перевищено</span>` : `Залишок: ${formatMoney(it.left, currency)}`}
              </div>
            </div>
            <div class="item__actions">
              <button class="btn btn--ghost" data-budget-del="${it.c.id}">Видалити</button>
            </div>
          </div>
          <div class="progress">
            <div class="progress__bar" style="width:${clamp(it.pct, 0, 100)}%"></div>
          </div>
        `;
        budgetList.appendChild(row);
      });
    }

    const over = items.filter(x => x.isOver);
    const near = items.filter(x => !x.isOver && x.limit > 0 && x.pct >= 80);
    let html = "";
    if (over.length) {
      html += `<div class="note"><b style="color:var(--bad)">Перевищено:</b> ${over.map(x => x.c.name).join(", ")}. Спробуй зменшити витрати або збільшити ліміт.</div>`;
    }
    if (near.length) {
      html += `<div class="note"><b style="color:var(--warn)">Майже ліміт:</b> ${near.map(x => x.c.name).join(", ")} (80%+).</div>`;
    }
    if (!html) html = `<div class="note note--muted">Поки все ок. Коли витрати наблизяться до 80% — з’явиться попередження.</div>`;
    budgetTips.innerHTML = html;
  };

  const renderGoals = () => {
    const currency = state.settings.currency;

    goalList.innerHTML = "";
    if (!state.goals.length) {
      goalList.innerHTML = `<div class="note note--muted">Поки нема цілей. Створи, наприклад: “PC 2500”, “Авто”, “Подорож”.</div>`;
    } else {
      state.goals.forEach((g) => {
        const pct = g.target > 0 ? clamp((g.saved / g.target) * 100, 0, 100) : 0;
        const row = document.createElement("div");
        row.className = "item";
        row.innerHTML = `
          <div class="item__top">
            <div>
              <div class="item__title">${g.title}</div>
              <div class="item__meta">
                Зібрано: ${formatMoney(g.saved, currency)} із ${formatMoney(g.target, currency)} • ${pct.toFixed(0)}%
              </div>
            </div>
            <div class="item__actions">
              <button class="btn btn--ghost" data-goal-edit="${g.id}">Ред.</button>
              <button class="btn btn--danger" data-goal-del="${g.id}">X</button>
            </div>
          </div>
          <div class="progress"><div class="progress__bar" style="width:${pct}%"></div></div>
        `;
        goalList.appendChild(row);
      });
    }

    goalPick.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Оберіть ціль";
    goalPick.appendChild(opt0);
    state.goals.forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = g.title;
      goalPick.appendChild(opt);
    });

    goalNote.textContent = "Порада: поповнення цілі можна робити з доходу (логічно) або окремо як ‘накопичення’.";
  };

  const renderDashboardCharts = () => {
    const currency = state.settings.currency;
    const m = monthKey(nowISO());
    const items = expensesByCategory(`${m}-01`, `${m}-31`).slice(0, 7);
    drawPie(chartPie, items, currency);

    const today = new Date();
    const points = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = toISODate(d);

      let net = 0;
      for (const t of state.transactions) {
        if (t.date !== iso) continue;
        const a = Number(t.amount) || 0;
        net += (t.type === "income") ? a : -a;
      }
      points.push({ x: iso, y: net });
    }

    let acc = 0;
    const cum = points.map(p => (acc += p.y, { x: p.x, y: round2(acc) }));
    drawLine(chartLine, cum);
  };

  const renderReports = (fromISO, toISO) => {
    const currency = state.settings.currency;

    const from = fromISO ? new Date(fromISO) : null;
    const to = toISO ? new Date(toISO) : null;

    let inc = 0, exp = 0, count = 0;
    const byDay = new Map();

    for (const t of state.transactions) {
      const d = new Date(t.date);
      if (from && d < from) continue;
      if (to && d > to) continue;
      count++;

      const a = Number(t.amount) || 0;
      if (t.type === "income") inc += a;
      else exp += a;

      const day = t.date;
      byDay.set(day, (byDay.get(day) || 0) + (t.type === "income" ? a : -a));
    }

    inc = round2(inc); exp = round2(exp);
    const net = round2(inc - exp);

    repIncome.textContent = formatMoney(inc, currency);
    repExpense.textContent = formatMoney(exp, currency);
    repNet.textContent = formatMoney(net, currency);
    repCount.textContent = String(count);

    const items = expensesByCategory(fromISO, toISO).slice(0, 7);
    drawPie(chartRepPie, items, currency);

    const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    let acc = 0;
    const points = days.map(([date, delta]) => (acc += delta, { x: date, y: round2(acc) }));
    if (points.length < 2) {
      const fallback = [{ x: nowISO(), y: 0 }, { x: nowISO(), y: 0 }];
      drawLine(chartRepLine, fallback);
    } else {
      drawLine(chartRepLine, points);
    }
  };

  // =========================
  // Actions (CRUD)
  // =========================
  const openTxCreate = () => {
    txId.value = "";
    txFormType.value = "expense";
    txFormDate.value = nowISO();
    txFormCategory.value = state.categories[0]?.id || "";
    txFormAmount.value = "";
    txFormNote.value = "";
    document.getElementById("modalTitle").textContent = "Нова транзакція";
    openModal();
  };

  const openTxEdit = (id) => {
    const t = state.transactions.find(x => x.id === id);
    if (!t) return;
    txId.value = t.id;
    txFormType.value = t.type;
    txFormDate.value = t.date;
    txFormCategory.value = t.categoryId;
    txFormAmount.value = String(t.amount);
    txFormNote.value = t.note || "";
    document.getElementById("modalTitle").textContent = "Редагувати транзакцію";
    openModal();
  };

  const deleteTx = (id) => {
    setState((s) => {
      s.transactions = s.transactions.filter(x => x.id !== id);
      return s;
    });
    toast("Видалено", "Транзакцію прибрано зі списку.");
  };

  // =========================
  // Events
  // =========================
  btnAddTransaction.addEventListener("click", openTxCreate);

  txForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = txId.value || uid();
    const type = txFormType.value;
    const date = txFormDate.value || nowISO();
    const categoryId = txFormCategory.value;
    const amount = round2(Number(txFormAmount.value) || 0);
    const note = (txFormNote.value || "").trim();

    if (!amount || amount < 0) {
      toast("Помилка", "Сума має бути більшою за 0.");
      return;
    }
    if (!categoryId) {
      toast("Помилка", "Оберіть категорію.");
      return;
    }

    setState((s) => {
      const existing = s.transactions.find(x => x.id === id);
      if (existing) {
        existing.type = type;
        existing.date = date;
        existing.categoryId = categoryId;
        existing.amount = amount;
        existing.note = note;
      } else {
        s.transactions.push({ id, type, date, categoryId, amount, note });
      }
      return s;
    });

    closeModal();
    toast("Збережено", "Транзакція оновлена.");
  });

  txList.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.edit) openTxEdit(btn.dataset.edit);
    if (btn.dataset.del) deleteTx(btn.dataset.del);
  });

  [txSearch, txType, txCategory, txFrom, txTo].forEach(inp => inp.addEventListener("input", renderTxList));
  txReset.addEventListener("click", () => {
    txSearch.value = "";
    txType.value = "all";
    txCategory.value = "all";
    txFrom.value = "";
    txTo.value = "";
    renderTxList();
  });

  budgetForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const catId = budgetCategory.value;
    const limit = round2(Number(budgetLimit.value) || 0);
    if (!catId || limit <= 0) {
      toast("Помилка", "Оберіть категорію та введіть ліміт > 0.");
      return;
    }
    const m = monthKey(nowISO());
    setState((s) => {
      const found = s.budgets.find(b => b.month === m && b.categoryId === catId);
      if (found) found.limit = limit;
      else s.budgets.push({ id: uid(), month: m, categoryId: catId, limit });
      return s;
    });
    budgetLimit.value = "";
    toast("OK", "Бюджет збережено.");
  });

  budgetList.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.budgetDel) {
      const catId = btn.dataset.budgetDel;
      const m = monthKey(nowISO());
      setState((s) => {
        s.budgets = s.budgets.filter(b => !(b.month === m && b.categoryId === catId));
        return s;
      });
      toast("Видалено", "Бюджет прибрано.");
    }
  });

  goalForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = (goalTitle.value || "").trim();
    const target = round2(Number(goalTarget.value) || 0);
    if (!title || target <= 0) {
      toast("Помилка", "Введи назву та цільову суму > 0.");
      return;
    }
    setState((s) => {
      s.goals.push({ id: uid(), title, target, saved: 0 });
      return s;
    });
    goalTitle.value = "";
    goalTarget.value = "";
    toast("Створено", "Ціль додана.");
  });

  goalList.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    if (btn.dataset.goalDel) {
      const id = btn.dataset.goalDel;
      setState((s) => {
        s.goals = s.goals.filter(g => g.id !== id);
        return s;
      });
      toast("OK", "Ціль видалена.");
    }

    if (btn.dataset.goalEdit) {
      const id = btn.dataset.goalEdit;
      const g = state.goals.find(x => x.id === id);
      if (!g) return;
      const newTitle = prompt("Нова назва цілі:", g.title);
      if (newTitle === null) return;
      const newTarget = prompt("Нова цільова сума:", String(g.target));
      if (newTarget === null) return;
      const target = round2(Number(newTarget) || 0);
      if (!newTitle.trim() || target <= 0) {
        toast("Помилка", "Некоректні дані.");
        return;
      }
      setState((s) => {
        const gg = s.goals.find(x => x.id === id);
        gg.title = newTitle.trim();
        gg.target = target;
        return s;
      });
      toast("OK", "Ціль оновлена.");
    }
  });

  goalAddForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = goalPick.value;
    const add = round2(Number(goalAddAmount.value) || 0);
    if (!id || add <= 0) {
      toast("Помилка", "Оберіть ціль і введіть суму > 0.");
      return;
    }
    setState((s) => {
      const g = s.goals.find(x => x.id === id);
      g.saved = round2((Number(g.saved) || 0) + add);
      return s;
    });
    goalAddAmount.value = "";
    toast("OK", "Поповнення додано.");
  });

  repBuild.addEventListener("click", () => {
    renderReports(repFrom.value || null, repTo.value || null);
    toast("Звіт", "Оновлено аналітику за період.");
  });

  btnTheme.addEventListener("click", () => {
    setState((s) => {
      s.settings.theme = (s.settings.theme === "dark") ? "light" : "dark";
      return s;
    });
    toast("Тема", `Увімкнено: ${state.settings.theme}`);
  });

  setSaveCurrency.addEventListener("click", () => {
    const c = (setCurrency.value || "").trim();
    if (!c) return toast("Помилка", "Введи символ валюти (наприклад ₴ або $).");
    setState((s) => { s.settings.currency = c; return s; });
    toast("OK", "Валюта збережена.");
  });

  btnExportJSON.addEventListener("click", () => {
    downloadText("financeflow_backup.json", JSON.stringify(state, null, 2));
    toast("Експорт", "JSON збережено.");
  });

  fileImportJSON.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") throw new Error("bad");
      localStorage.setItem(LS_KEY, JSON.stringify(parsed));
      state = loadState();
      renderAll();
      toast("Імпорт", "JSON імпортовано.");
    } catch {
      toast("Помилка", "Не вдалося імпортувати JSON.");
    } finally {
      e.target.value = "";
    }
  });

  btnResetAll.addEventListener("click", () => {
    const ok = confirm("Точно скинути всі дані? Це видалить localStorage.");
    if (!ok) return;
    localStorage.removeItem(LS_KEY);
    state = loadState();
    renderAll();
    toast("Скинуто", "Дані видалені.");
  });

  btnExportCSV.addEventListener("click", () => {
    const rows = state.transactions.map(t => ({
      id: t.id,
      type: t.type,
      date: t.date,
      category: getCategoryName(t.categoryId),
      categoryId: t.categoryId,
      amount: t.amount,
      note: t.note || "",
    }));
    downloadText("financeflow_transactions.csv", toCSV(rows));
    toast("Експорт", "CSV транзакцій збережено.");
  });

  fileImportCSV.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = parseCSV(text);

      const incoming = parsed
        .map((r) => ({
          id: r.id || uid(),
          type: (r.type || "").toLowerCase() === "income" ? "income" : "expense",
          date: r.date ? String(r.date).slice(0, 10) : nowISO(),
          categoryId: r.categoryid || r.categoryId || "cat_other",
          amount: round2(Number(r.amount) || 0),
          note: r.note || "",
        }))
        .filter(x => x.amount > 0 && x.date);

      if (!incoming.length) {
        toast("CSV", "Нічого не імпортовано (перевір формат).");
      } else {
        setState((s) => {
          s.transactions.push(...incoming);
          return s;
        });
        toast("CSV", `Імпортовано: ${incoming.length} транзакцій.`);
      }
    } catch {
      toast("Помилка", "Не вдалося прочитати CSV.");
    } finally {
      e.target.value = "";
    }
  });

  // =========================
  // Main render
  // =========================
  const renderAll = () => {
    document.body.dataset.theme = state.settings.theme;
    setCurrency.value = state.settings.currency;

    fillCategorySelect(txCategory, true);
    fillCategorySelect(txFormCategory, false);
    fillCategorySelect(budgetCategory, false);

    renderStats();
    renderRecentTx();
    renderTxList();
    renderBudgets();
    renderGoals();
    renderDashboardCharts();

    if (!repFrom.value && !repTo.value) {
      const m = monthKey(nowISO());
      repFrom.value = `${m}-01`;
      repTo.value = `${m}-31`;
    }
    renderReports(repFrom.value, repTo.value);
  };

  // First route + init
  const setInitialRoute = () => setRoute("dashboard");
  setInitialRoute();
  renderAll();

  // Ховаємо loader після повного завантаження всіх ресурсів + коротка пауза (щоб виглядало плавно)
  window.addEventListener("load", () => {
    setTimeout(hideLoader, 380);
  });

})();
