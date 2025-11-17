// popup.js

// ----------------------
// 전역 상태
// ----------------------

const STATE = {
  baseUrl: "https://www.lexinoa.com",
  tier: "guest",
  usage: { used: 0, limit: 0, scope: "rewrite" },
  auth: {
    logged_in: false,
    user_id: null,
    email: null,
    email_verified: false,
    n_outputs: 1
  },
  templates: [],
  context: {
    source: "generic",
    label: "일반 사이트",
    suggestedCategory: "general",
    suggestedTone: "polite"
  },
  manualContext: "auto",
  theme: "light"
};

// 테마 적용 함수
function applyTheme(theme) {
  STATE.theme = theme === "dark" ? "dark" : "light";
  const body = document.body;
  body.classList.remove("theme-light", "theme-dark");
  body.classList.add(STATE.theme === "dark" ? "theme-dark" : "theme-light");
}
// 저장된 테마 불러오기
async function loadThemeFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["lexinoaTheme"], (data) => {
      const saved = data.lexinoaTheme;
      if (saved === "dark" || saved === "light") {
        applyTheme(saved);
      } else {
        applyTheme("light");
      }

      // 라디오 버튼 UI도 상태 맞춰주기
      const themeRadios = document.querySelectorAll('input[name="theme"]');
      themeRadios.forEach((r) => {
        r.checked = (r.value === STATE.theme);
      });

      resolve();
    });
  });
}

// 테마 저장하기
function onThemeChange(e) {
  const val = e.target.value;
  applyTheme(val);
  chrome.storage.sync.set({ lexinoaTheme: STATE.theme });
}



// ----------------------
// URL 기반 상황 감지 헬퍼
// ----------------------
function detectContextFromUrl(url) {
  if (!url) return { key: "generic", label: "일반 사이트" };

  const u = url.toLowerCase();

  if (u.includes("mail.google.com")) {
    return { key: "gmail", label: "Gmail 메일" };
  }
  if (u.includes("slack.com")) {
    return { key: "slack", label: "Slack 채팅" };
  }
  if (u.includes("mail.naver.com") || (u.includes("naver.com") && u.includes("/mail"))) {
    return { key: "naver_mail", label: "네이버 메일" };
  }
  if (u.includes("outlook.live.com") || u.includes("outlook.office.com")) {
    return { key: "outlook", label: "Outlook 메일" };
  }
  if (u.includes("teams.microsoft.com")) {
    return { key: "teams", label: "Microsoft Teams" };
  }
  if (u.includes("kakao.com") || u.includes("kakaotalk")) {
    return { key: "kakao", label: "카카오톡/카카오" };
  }

  return { key: "generic", label: "일반 사이트" };
}

const CONTEXT_LABELS = {
  gmail: "Gmail 메일",
  slack: "Slack 채팅",
  naver_mail: "네이버 메일",
  outlook: "Outlook 메일",
  teams: "Microsoft Teams",
  kakao: "카카오톡/카카오",
  generic: "일반 사이트"
};

// 상황별 기본 카테고리 / 톤 추천
function guessDefaultsForContext(ctxKey) {
  if (ctxKey === "gmail" || ctxKey === "naver_mail" || ctxKey === "outlook") {
    return { category: "work", tone: "polite" };
  }
  if (ctxKey === "slack" || ctxKey === "teams") {
    return { category: "work", tone: "friendly" };
  }
  if (ctxKey === "kakao") {
    return { category: "general", tone: "friendly" };
  }
  return { category: "general", tone: "polite" }; // generic
}


// 현재 탭 기준으로 자동 컨텍스트 감지 (Pro 전용)
function autoDetectContextFromCurrentTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      const detected = detectContextFromUrl(tab?.url || "");
      const defaults = guessDefaultsForContext(detected.key);

      // 전역 STATE 업데이트
      STATE.context = {
        source: detected.key,
        label: detected.label,
        suggestedCategory: defaults.category,
        suggestedTone: defaults.tone
      };
      STATE.manualContext = "auto";
      window.lexContextKey = detected.key;

      updateContextDisplay();
      resolve();
    });
  });
}




// ----------------------
// 유틸
// ----------------------

function getFullContext() {
  if (STATE.manualContext && STATE.manualContext !== "auto") {
    const labelMap = {
      gmail: "Gmail 메일",
      slack: "Slack 채팅",
      naver_mail: "네이버 메일",
      outlook: "Outlook 메일",
      teams: "Microsoft Teams",
      kakao: "카카오톡/카카오",
      generic: "일반 사이트"
    };
    return {
      source: STATE.manualContext,
      label: labelMap[STATE.manualContext] || "사용자 지정",
      suggestedCategory: STATE.context.suggestedCategory,
      suggestedTone: STATE.context.suggestedTone
    };
  }
  return STATE.context;
}

function withBaseUrl(path) {
  const base = STATE.baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

async function apiFetch(path, options = {}) {
  const url = withBaseUrl(path);
  const init = {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Lex-Client": "chrome-ext-v1"
    },
    ...options
  };
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error("API error");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${da} ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

// ----------------------
// 초기 로드
// ----------------------
document.addEventListener("DOMContentLoaded", async () => {
  bindTabs();
  bindActions();

  await loadBaseUrl();
  await loadContextFromSession();
  await loadThemeFromStorage();       // 테마 로드
  await refreshAuthStatus();          // 여기서 STATE.tier 세팅

  // Pro인 경우에만, 그리고 드롭다운이 'auto'인 경우에만 자동 감지 실행
  const ctxSelect = document.getElementById("context-manual");
  if (STATE.tier === "pro" && ctxSelect && ctxSelect.value === "auto") {
    await autoDetectContextFromCurrentTab();
  }

  await refreshUsage();
  await refreshTemplatesInMemory();

  updateStatusBar();
  updateContextDisplay();
  renderTemplateSelect();
});




// ----------------------
// 탭 전환
// ----------------------

function bindTabs() {
  const buttons = document.querySelectorAll(".tab-button");
  const views = document.querySelectorAll(".view");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-target");
      buttons.forEach((b) => b.classList.remove("active"));
      views.forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      const view = document.getElementById(target);
      if (view) view.classList.add("active");

      if (target === "view-history") {
        refreshHistoryView();
      }
      if (target === "view-templates") {
        refreshTemplatesView();
      }
      if (target === "view-settings") {
        renderSettingsAuth();
        renderEnvRadios();
      }
    });
  });
}

// ----------------------
// 액션 바인딩
// ----------------------
function bindActions() {
  const openWeb = document.getElementById("open-web");
  openWeb.addEventListener("click", () => {
    chrome.tabs.create({ url: STATE.baseUrl });
  });

  const ctxSelect = document.getElementById("context-manual");
  ctxSelect.addEventListener("change", async (e) => {
    const val = e.target.value;

    // Pro 전용: Guest/Free가 '자동' 선택하면 막기
    if (val === "auto" && STATE.tier !== "pro") {
      alert("상황 자동 감지는 Pro 구독 시 사용 가능합니다.");
      // 다시 generic으로 돌려놓기
      ctxSelect.value = "generic";
      STATE.manualContext = "generic";

      const label = CONTEXT_LABELS["generic"] || "일반 사이트";
      const defaults = guessDefaultsForContext("generic");
      STATE.context = {
        source: "generic",
        label,
        suggestedCategory: defaults.category,
        suggestedTone: defaults.tone
      };
      window.lexContextKey = "generic";
      updateContextDisplay();
      return;
    }

    STATE.manualContext = val;

    if (val === "auto") {
      // Pro일 때만 여기 도달
      await autoDetectContextFromCurrentTab();
    } else {
      const label = CONTEXT_LABELS[val] || "일반 사이트";
      const defaults = guessDefaultsForContext(val);
      STATE.context = {
        source: val,
        label,
        suggestedCategory: defaults.category,
        suggestedTone: defaults.tone
      };
      window.lexContextKey = val;
    }

    updateContextDisplay();
  });

  // 이하 기존 코드 그대로
  document.getElementById("category-select").addEventListener("change", (e) => {
    addChip("category", e.target.value);
    e.target.selectedIndex = 0;
  });
  document.getElementById("tone-select").addEventListener("change", (e) => {
    addChip("tone", e.target.value);
    e.target.selectedIndex = 0;
  });

  document.getElementById("btn-rewrite").addEventListener("click", onClickRewrite);
  document.getElementById("template-save-from-current").addEventListener("click", onClickSaveTemplateFromCurrent);
  document.getElementById("tpl-save").addEventListener("click", onClickTemplateSave);
  document.getElementById("settings-open-login").addEventListener("click", () => {
    chrome.tabs.create({ url: withBaseUrl("/login") });
  });
  document.getElementById("settings-reset").addEventListener("click", onClickSettingsReset);

  const radios = document.querySelectorAll('input[name="env"]');
  radios.forEach((r) => {
    r.addEventListener("change", onEnvChange);
  });
  const themeRadios = document.querySelectorAll('input[name="theme"]');
  themeRadios.forEach((r) => {
    r.addEventListener("change", onThemeChange);
  });
}


// ----------------------
// Base URL (prod/local)
// ----------------------

async function loadBaseUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["lexinoaBaseUrl"], (data) => {
      if (data.lexinoaBaseUrl) {
        STATE.baseUrl = data.lexinoaBaseUrl;
      } else {
        STATE.baseUrl = "https://www.lexinoa.com";
      }
      resolve();
    });
  });
}

function renderEnvRadios() {
  const prod = document.querySelector('input[name="env"][value="prod"]');
  const local = document.querySelector('input[name="env"][value="local"]');
  const base = STATE.baseUrl.replace(/\/+$/, "");

  if (base === "http://127.0.0.1:5000" || base === "http://localhost:5000") {
    if (local) local.checked = true;
  } else {
    if (prod) prod.checked = true;
  }
}

function onEnvChange(e) {
  const val = e.target.value;
  if (val === "local") {
    STATE.baseUrl = "http://127.0.0.1:5000";
  } else {
    STATE.baseUrl = "https://www.lexinoa.com";
  }
  chrome.storage.sync.set({ lexinoaBaseUrl: STATE.baseUrl }, () => {
    refreshAuthStatus().then(() => {
      refreshUsage().then(() => {
        updateStatusBar();
        renderSettingsAuth();
      });
    });
  });
}

// ----------------------
// 컨텍스트 (상황 감지)
// ----------------------

async function loadContextFromSession() {
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.session) {
      resolve();
      return;
    }
    chrome.storage.session.get(["lexinoaContext"], (data) => {
      if (data && data.lexinoaContext) {
        STATE.context = data.lexinoaContext;
      }
      resolve();
    });
  });
}

function updateContextDisplay() {
  const ctx = getFullContext();
  const el = document.getElementById("context-display");
  if (el) {
    el.textContent = ctx.label || "일반 사이트";
  }
}

// ----------------------
// 칩 (카테고리/톤)
// ----------------------

function addChip(type, value) {
  if (!value) return;
  if (type === "category") {
    const box = document.getElementById("category-chips");
    if (Array.from(box.children).some((c) => c.dataset.value === value)) return;
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.dataset.value = value;
    chip.textContent = mapCategoryLabel(value);
    chip.addEventListener("click", () => chip.remove());
    box.appendChild(chip);
  } else if (type === "tone") {
    const box = document.getElementById("tone-chips");
    if (Array.from(box.children).some((c) => c.dataset.value === value)) return;
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.dataset.value = value;
    chip.textContent = mapToneLabel(value);
    chip.addEventListener("click", () => chip.remove());
    box.appendChild(chip);
  }
}

function getSelectedCategories() {
  const box = document.getElementById("category-chips");
  return Array.from(box.children).map((c) => c.dataset.value);
}

function getSelectedTones() {
  const box = document.getElementById("tone-chips");
  return Array.from(box.children).map((c) => c.dataset.value);
}

function mapCategoryLabel(v) {
  const map = {
    general: "일반",
    work: "업무",
    support: "고객응대",
    apology: "사과",
    inquiry: "문의",
    thanks: "감사",
    request: "요청",
    guidance: "안내",
    "report/approval": "보고/결재",
    feedback: "피드백"
  };
  return map[v] || v;
}

function mapToneLabel(v) {
  const map = {
    soft: "부드럽게",
    polite: "정중하게",
    concise: "간결하게",
    report: "보고서체",
    friendly: "친근하게",
    warmly: "따뜻하게",
    calmly: "차분하게",
    formally: "격식 있게",
    clearly: "명확하게",
    without_emotion: "감정 없이"
  };
  return map[v] || v;
}

// ----------------------
// Auth / Usage
// ----------------------

async function refreshAuthStatus() {
  try {
    const data = await apiFetch("/api/auth/status", { method: "GET" });
    STATE.auth = data;
    STATE.tier = data.tier || "guest";
    STATE.auth.n_outputs = data.n_outputs || (STATE.tier === "pro" ? 3 : 1);
  } catch (e) {
    STATE.auth = {
      logged_in: false,
      tier: "guest",
      user_id: null,
      email: null,
      email_verified: false,
      n_outputs: 1
    };
    STATE.tier = "guest";
  }
}

async function refreshUsage() {
  try {
    const data = await apiFetch("/api/usage?scope=rewrite", { method: "GET" });
    STATE.usage = data;
  } catch (e) {
    STATE.usage = { used: 0, limit: 0, scope: "rewrite" };
  }
}

function updateStatusBar() {
  const tierEl = document.getElementById("status-tier");
  const usageEl = document.getElementById("status-usage");

  const tier = STATE.tier || "guest";
  let label = "Guest";
  if (tier === "free") label = "Free";
  if (tier === "pro") label = "Pro";

  tierEl.textContent = label;

  if (STATE.usage && STATE.usage.limit > 0) {
    usageEl.textContent = `이용량: ${STATE.usage.used} / ${STATE.usage.limit} (${STATE.usage.scope})`;
  } else {
    usageEl.textContent = "이용량 정보를 불러올 수 없습니다.";
  }

  const proBadge = document.getElementById("template-pro-badge");
  if (proBadge) {
    proBadge.hidden = !(tier === "pro");
  }
}

// ----------------------
// 순화하기
// ----------------------

async function onClickRewrite() {
  const input = document.getElementById("input-text");
  const errEl = document.getElementById("rewrite-error");
  const btn = document.getElementById("btn-rewrite");
  const spinner = document.getElementById("btn-rewrite-spinner");

  errEl.hidden = true;
  errEl.textContent = "";

  const text = (input.value || "").trim();
  if (!text) {
    errEl.textContent = "입력할 문장을 적어주세요.";
    errEl.hidden = false;
    return;
  }

  btn.disabled = true;
  spinner.hidden = false;

  try {
    const cats = getSelectedCategories();
    const tones = getSelectedTones();
    const honorific = document.getElementById("opt-honorific").checked;
    const opener = document.getElementById("opt-opener").checked;
    const emoji = document.getElementById("opt-emoji").checked;

    const body = {
      input_text: text,
      selected_categories: cats,
      selected_tones: tones,
      honorific_checked: honorific,
      opener_checked: opener,
      emoji_checked: emoji,
      provider: "claude"
    };

    const res = await apiFetch("/api/polish", {
      method: "POST",
      body: JSON.stringify(body)
    });

    const outputs = res.outputs || (res.output_text ? [res.output_text] : []);
    renderOutputs(outputs);
    await refreshUsage();
    updateStatusBar();
  } catch (e) {
    let msg = "요청 중 오류가 발생했습니다.";
    if (e.data && e.data.error === "daily_limit_reached") {
      msg = `일일 사용 한도(${e.data.limit})를 초과했습니다.`;
    } else if (e.data && e.data.error === "monthly_limit_reached") {
      msg = `월간 사용 한도(${e.data.limit})를 초과했습니다.`;
    } else if (e.status === 401) {
      msg = "로그인이 필요합니다. 웹에서 로그인 후 다시 시도해 주세요.";
    }
    errEl.textContent = msg;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    spinner.hidden = true;
  }
}

function renderOutputs(outputs) {
  const list = document.getElementById("output-list");
  const note = document.getElementById("output-note");
  list.innerHTML = "";

  if (!outputs || outputs.length === 0) {
    note.textContent = "";
    return;
  }

  const tier = STATE.tier || "guest";
  if (tier === "pro") {
    note.textContent = `${outputs.length}개 문장을 비교해 보세요.`;
  } else {
    note.textContent = "Pro에서는 최대 3개 문장을 비교할 수 있습니다.";
  }

  outputs.forEach((text, idx) => {
    const card = document.createElement("div");
    card.className = "output-card";

    const header = document.createElement("div");
    header.className = "output-card-header";

    const title = document.createElement("div");
    title.className = "output-card-title";
    title.textContent = `결과 ${idx + 1}`;

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn ghost small";
    copyBtn.textContent = "복사";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(text || "").catch(() => {});
    });

    header.appendChild(title);
    header.appendChild(copyBtn);

    const body = document.createElement("div");
    body.className = "output-text";
    body.textContent = text || "";

    card.appendChild(header);
    card.appendChild(body);

    list.appendChild(card);
  });
}

// ----------------------
// 템플릿
// ----------------------

async function refreshTemplatesInMemory() {
  if (STATE.tier !== "pro") {
    STATE.templates = [];
    return;
  }
  try {
    const data = await apiFetch("/api/user_templates", { method: "GET" });
    STATE.templates = data.items || [];
  } catch (e) {
    STATE.templates = [];
  }
}

function renderTemplateSelect() {
  const select = document.getElementById("template-select");
  if (!select) return;

  const tier = STATE.tier || "guest";
  select.innerHTML = "";

  const baseOption = document.createElement("option");
  baseOption.value = "";
  baseOption.textContent = tier === "pro" ? "템플릿 선택…" : "Pro에서 템플릿 사용 가능";
  select.appendChild(baseOption);

  if (tier !== "pro") {
    select.disabled = true;
    return;
  }

  select.disabled = false;

  STATE.templates.forEach((tpl) => {
    const opt = document.createElement("option");
    opt.value = String(tpl.id);
    opt.textContent = tpl.title || `템플릿 #${tpl.id}`;
    select.appendChild(opt);
  });

  select.addEventListener("change", (e) => {
    const id = Number(e.target.value || 0);
    if (!id) return;

    const tpl = STATE.templates.find((t) => t.id === id);
    if (!tpl) return;

    applyTemplateToForm(tpl);
  });
}

function applyTemplateToForm(tpl) {
  const cat = tpl.category || "";
  const tone = tpl.tone || "";

  const catBox = document.getElementById("category-chips");
  const toneBox = document.getElementById("tone-chips");
  catBox.innerHTML = "";
  toneBox.innerHTML = "";

  if (cat) addChip("category", cat);
  if (tone) addChip("tone", tone);

  document.getElementById("opt-honorific").checked = !!tpl.honorific;
  document.getElementById("opt-opener").checked = !!tpl.opener;
  document.getElementById("opt-emoji").checked = !!tpl.emoji;
}

async function onClickSaveTemplateFromCurrent() {
  if (STATE.tier !== "pro") {
    alert("템플릿 저장은 Pro에서만 가능합니다.");
    return;
  }

  const cats = getSelectedCategories();
  const tones = getSelectedTones();
  const honorific = document.getElementById("opt-honorific").checked;
  const opener = document.getElementById("opt-opener").checked;
  const emoji = document.getElementById("opt-emoji").checked;

  const ctx = getFullContext();
  const defaultName = `${ctx.label} · ${cats[0] ? mapCategoryLabel(cats[0]) : "카테고리 없음"}`;

  const title = prompt("템플릿 이름을 입력해 주세요.", defaultName);
  if (!title) return;

  const category = cats[0] || "";
  const tone = tones[0] || "";

  try {
    await apiFetch("/api/user_templates", {
      method: "POST",
      body: JSON.stringify({
        title,
        category,
        tone,
        honorific,
        opener,
        emoji
      })
    });
    await refreshTemplatesInMemory();
    renderTemplateSelect();
    alert("템플릿이 저장되었습니다.");
  } catch (e) {
    alert("템플릿 저장 중 오류가 발생했습니다.");
  }
}

async function onClickTemplateSave() {
  if (STATE.tier !== "pro") {
    alert("템플릿 저장은 Pro에서만 가능합니다.");
    return;
  }

  const title = (document.getElementById("tpl-title").value || "").trim();
  const category = document.getElementById("tpl-category").value || "";
  const tone = document.getElementById("tpl-tone").value || "";
  const honorific = document.getElementById("tpl-honorific").checked;
  const opener = document.getElementById("tpl-opener").checked;
  const emoji = document.getElementById("tpl-emoji").checked;

  if (!title) {
    alert("템플릿 이름을 입력해 주세요.");
    return;
  }

  try {
    await apiFetch("/api/user_templates", {
      method: "POST",
      body: JSON.stringify({
        title,
        category,
        tone,
        honorific,
        opener,
        emoji
      })
    });
    document.getElementById("tpl-title").value = "";
    await refreshTemplatesInMemory();
    renderTemplateSelect();
    refreshTemplatesView();
    alert("템플릿이 저장되었습니다.");
  } catch (e) {
    alert("템플릿 저장 중 오류가 발생했습니다.");
  }
}

async function refreshTemplatesView() {
  const info = document.getElementById("tpl-info");
  const warning = document.getElementById("tpl-warning");
  const editor = document.getElementById("tpl-editor");
  const list = document.getElementById("tpl-list");

  const tier = STATE.tier || "guest";
  if (tier !== "pro") {
    info.textContent = "Pro 구독 시 카테고리·톤·옵션을 템플릿으로 저장해 둘 수 있습니다.";
    warning.hidden = false;
    warning.textContent = "현재 플랜에서는 템플릿 기능을 사용할 수 없습니다.";
    editor.hidden = true;
    list.innerHTML = "";
    return;
  }

  info.textContent = "자주 쓰는 설정을 템플릿으로 저장해 두고, 빠르게 불러올 수 있습니다.";
  warning.hidden = true;
  editor.hidden = false;

  await refreshTemplatesInMemory();

  list.innerHTML = "";
  if (!STATE.templates || STATE.templates.length === 0) {
    const empty = document.createElement("div");
    empty.className = "info-text";
    empty.textContent = "저장된 템플릿이 없습니다.";
    list.appendChild(empty);
    return;
  }

  STATE.templates.forEach((tpl) => {
    const item = document.createElement("div");
    item.className = "tpl-item";

    const header = document.createElement("div");
    header.className = "tpl-header";

    const title = document.createElement("div");
    title.textContent = tpl.title || `템플릿 #${tpl.id}`;

    const btns = document.createElement("div");

    const applyBtn = document.createElement("button");
    applyBtn.className = "btn ghost small";
    applyBtn.textContent = "적용";
    applyBtn.addEventListener("click", () => {
      applyTemplateToForm(tpl);
      alert("현재 입력창에 템플릿이 적용되었습니다.");
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger small";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", async () => {
      if (!confirm("이 템플릿을 삭제하시겠습니까?")) return;
      try {
        await apiFetch(`/api/user_templates/${tpl.id}`, {
          method: "DELETE"
        });
        await refreshTemplatesInMemory();
        renderTemplateSelect();
        refreshTemplatesView();
      } catch (e) {
        alert("삭제 중 오류가 발생했습니다.");
      }
    });

    btns.appendChild(applyBtn);
    btns.appendChild(delBtn);

    header.appendChild(title);
    header.appendChild(btns);

    const meta = document.createElement("div");
    meta.className = "tpl-meta";

    const catLabel = tpl.category ? mapCategoryLabel(tpl.category) : "카테고리 없음";
    const toneLabel = tpl.tone ? mapToneLabel(tpl.tone) : "톤 없음";
    const opts = [];
    if (tpl.honorific) opts.push("존댓말");
    if (tpl.opener) opts.push("완충문");
    if (tpl.emoji) opts.push("이모지");
    const optText = opts.length ? opts.join(", ") : "추가 옵션 없음";

    meta.textContent = `${catLabel} · ${toneLabel} · ${optText}`;

    item.appendChild(header);
    item.appendChild(meta);

    list.appendChild(item);
  });
}

// ----------------------
// 히스토리
// ----------------------

async function refreshHistoryView() {
  const info = document.getElementById("history-info");
  const list = document.getElementById("history-list");

  const tier = STATE.tier || "guest";
  if (tier !== "pro") {
    info.textContent = "Pro 구독 시 최근 순화 기록을 확인할 수 있습니다.";
    list.innerHTML = "";
    return;
  }

  info.textContent = "최근 순화 기록입니다. 클릭해서 입력창에 불러올 수 있습니다.";
  list.innerHTML = "";

  try {
    const data = await apiFetch("/api/history?limit=20", { method: "GET" });
    const items = data.items || [];
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "info-text";
      empty.textContent = "히스토리가 없습니다.";
      list.appendChild(empty);
      return;
    }

    items.forEach((r) => {
      const item = document.createElement("div");
      item.className = "history-item";

      const meta = document.createElement("div");
      meta.className = "history-meta";

      const dt = document.createElement("span");
      dt.textContent = fmtDate(r.created_at);

      const model = document.createElement("span");
      model.textContent = r.model || "";

      meta.appendChild(dt);
      //meta.appendChild(model);

      const body = document.createElement("div");
      body.className = "history-body";
      body.textContent = r.input_text || "";

      const footer = document.createElement("div");
      footer.className = "history-meta";

      const btnApply = document.createElement("button");
      btnApply.className = "btn ghost small";
      btnApply.textContent = "이 문장 불러오기";
      btnApply.addEventListener("click", () => {
        document.getElementById("input-text").value = r.input_text || "";
        renderOutputs([r.output_text || ""]);
        switchTab("view-rewrite");
      });

      footer.appendChild(btnApply);

      item.appendChild(meta);
      item.appendChild(body);
      item.appendChild(footer);

      list.appendChild(item);
    });
  } catch (e) {
    const err = document.createElement("div");
    err.className = "error-text";
    err.textContent = "히스토리를 불러오는 중 오류가 발생했습니다.";
    list.appendChild(err);
  }
}

function switchTab(targetId) {
  const buttons = document.querySelectorAll(".tab-button");
  const views = document.querySelectorAll(".view");
  buttons.forEach((b) => {
    const t = b.getAttribute("data-target");
    b.classList.toggle("active", t === targetId);
  });
  views.forEach((v) => {
    v.classList.toggle("active", v.id === targetId);
  });
}

// ----------------------
// 설정
// ----------------------

function renderSettingsAuth() {
  const box = document.getElementById("settings-auth");
  const a = STATE.auth || { logged_in: false, tier: "guest" };

  if (!a.logged_in) {
    box.textContent = "로그인되지 않은 상태입니다. 웹에서 로그인하면 Free / Pro 플랜으로 이용할 수 있습니다.";
    return;
  }

  const tier = a.tier || "free";
  const tierLabel = tier === "pro" ? "Pro" : tier === "free" ? "Free" : "Guest";
  //const email = a.email || "";
  const id = a.user_id || "";
  const verified = a.email_verified ? "인증 완료" : "인증 필요";

  box.textContent = `${id} · ${tierLabel} (${verified})`;
}

async function onClickSettingsReset() {
  if (!chrome.storage || !chrome.storage.session) {
    document.getElementById("settings-reset-msg").textContent = "세션 스토리지를 사용할 수 없습니다.";
    return;
  }
  chrome.storage.session.clear(() => {
    document.getElementById("settings-reset-msg").textContent = "컨텍스트 및 세션 데이터가 초기화되었습니다.";
  });
}
