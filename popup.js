// popup.js
// NOTE:
// - 기존 기능은 그대로 유지
// - "드래그 기본값으로" 선택 시:
//   1) 선택된 템플릿을 더 진하게 표시 (is-selection-default 클래스 부여)
//   2) 해당 템플릿을 목록 최상단으로 정렬
//   3) 선택 상태를 chrome.storage.sync에 lexinoaSelectionTemplateId 로 저장
//   4) 선택된 항목 버튼 텍스트를 "드래그 기본값 ✓" 로 표시
// - Free/Guest의 "드래그 기본값(1개)" 저장 시, lexinoaSelectionTemplateId는 0으로 초기화

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

// ----------------------
// 토큰 저장 헬퍼
// ----------------------
function getStoredAccessToken() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["lexinoaAccessToken"], (data) => {
      resolve((data && data.lexinoaAccessToken) ? data.lexinoaAccessToken : "");
    });
  });
}

function setStoredAccessToken(token) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ lexinoaAccessToken: token || "" }, () => resolve());
  });
}


// ----------------------
// 테마
// ----------------------

function applyTheme(theme) {
  STATE.theme = theme === "dark" ? "dark" : "light";
  const body = document.body;
  body.classList.remove("theme-light", "theme-dark");
  body.classList.add(STATE.theme === "dark" ? "theme-dark" : "theme-light");
}

async function loadThemeFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["lexinoaTheme"], (data) => {
      const saved = data.lexinoaTheme;
      if (saved === "dark" || saved === "light") {
        applyTheme(saved);
      } else {
        applyTheme("light");
      }

      const themeRadios = document.querySelectorAll('input[name="theme"]');
      themeRadios.forEach((r) => {
        r.checked = r.value === STATE.theme;
      });

      resolve();
    });
  });
}

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
  return { category: "general", tone: "polite" };
}

// 현재 탭 기준 컨텍스트 자동 감지 (Pro 전용)
function autoDetectContextFromCurrentTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      const detected = detectContextFromUrl(tab?.url || "");
      const defaults = guessDefaultsForContext(detected.key);

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
// 드래그 영역 다듬기 기본값 (우클릭용)
// ----------------------

function loadSelectionDefaultsForView() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      ["lexinoaSelectionDefaults", "lexinoaSelectionTemplateTitle"],
      (data) => {
        resolve({
          defaults: data.lexinoaSelectionDefaults || null,
          title: data.lexinoaSelectionTemplateTitle || ""
        });
      }
    );
  });
}

// 추가: "드래그 기본값으로" 선택된 템플릿 id (Pro에서 사용)
function loadSelectionDefaultTemplateId() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["lexinoaSelectionTemplateId"], (data) => {
      resolve(Number(data.lexinoaSelectionTemplateId || 0));
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

  const token = await getStoredAccessToken();

  const headers = {
    "Content-Type": "application/json",
    "X-Lex-Client": "chrome-ext-v1",
    ...(options.headers || {})
  };

  // 토큰 있으면 Bearer
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const init = {
    // ✅ FIX: 항상 쿠키 포함 (토큰이 있어도 쿠키도 같이 보내서 서버가 guest로 오인하는 케이스 방지)
    credentials: "include",
    headers,
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
  await loadThemeFromStorage();
  await refreshAuthStatus();
  await updateConnectionStatus();

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

    if (val === "auto" && STATE.tier !== "pro") {
      alert("상황 자동 감지는 Pro 구독 시 사용 가능합니다.");
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

  document.getElementById("category-select").addEventListener("change", (e) => {
    addChip("category", e.target.value);
    e.target.selectedIndex = 0;
  });
  document.getElementById("tone-select").addEventListener("change", (e) => {
    addChip("tone", e.target.value);
    e.target.selectedIndex = 0;
  });

  document.getElementById("btn-rewrite").addEventListener("click", onClickRewrite);
  document
    .getElementById("template-save-from-current")
    .addEventListener("click", onClickSaveTemplateFromCurrent);
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
// 이 loadBaseUrl 은 개발, 운영 둘 다 존재
/*
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
*/
// 이 loadBaseUrl 은 운영 전용
async function loadBaseUrl() {
  STATE.baseUrl = "https://www.lexinoa.com";
  // 혹시 남아있는 로컬 설정값이 있으면 제거(선택)
  chrome.storage.sync.remove(["lexinoaBaseUrl"], () => {});
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

// 운영/로컬 변경 핸들러 (배포 시 운영 고정)
/*
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
*/
// 운영/로컬 변경 핸들러 (배포 시 운영 고정) --- END ---
function onEnvChange(e) {
  // 운영 고정
  STATE.baseUrl = "https://www.lexinoa.com";
  chrome.storage.sync.remove(["lexinoaBaseUrl"], () => {
    renderEnvRadios();
    // 기존 흐름 유지(새로고침만 수행)
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
  const tabId = await new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0].id : null);
    });
  });

  if (!tabId) return;

  await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "LEXINOA_GET_CONTEXT" }, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) {
        // content script가 주입되지 않는 페이지(chrome:// 등)에서는 여기로 옴
        // 이 경우 자동은 generic으로 두는게 정상
        resolve();
        return;
      }

      if (resp && resp.ok && resp.ctx) {
        STATE.context = resp.ctx;
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
    usageEl.textContent = `총 ${STATE.usage.limit}회 / ${STATE.usage.limit - STATE.usage.used}회 남음`;
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

    const ctx = getFullContext();

    const body = {
      input_text: text,
      selected_categories: cats,
      selected_tones: tones,
      honorific_checked: honorific,
      opener_checked: opener,
      emoji_checked: emoji,
      provider: "claude",

      // 플랫폼 감지 결과를 서버로 보냄
      context_source: ctx.source || "generic",
      context_label: ctx.label || "일반 사이트"
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

  // ------------------------------
  // 1) Guest / Free : 서버 템플릿 대신
  //    드래그 영역 다듬기 기본값 1개를
  //    템플릿 탭 안에서 직접 선택/저장
  // ------------------------------
  if (tier !== "pro") {
    info.textContent =
      "현재 플랜에서는 템플릿 여러 개를 저장할 수는 없지만, 드래그 영역 다듬기 기본값 1개는 설정해서 사용할 수 있습니다.";
    warning.hidden = true;
    editor.hidden = true;
    list.innerHTML = "";

    const { defaults } = await loadSelectionDefaultsForView();

    const item = document.createElement("div");
    item.className = "tpl-item";

    // 헤더
    const header = document.createElement("div");
    header.className = "tpl-header";

    const headerTitle = document.createElement("div");
    headerTitle.textContent = "드래그 영역 다듬기 기본값 (1개)";

    const btns = document.createElement("div");

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn small";
    saveBtn.textContent = "이 설정으로 저장";

    btns.appendChild(saveBtn);
    header.appendChild(headerTitle);
    header.appendChild(btns);

    // 폼 영역
    const formWrap = document.createElement("div");
    formWrap.style.marginTop = "8px";
    formWrap.style.display = "flex";
    formWrap.style.flexDirection = "column";
    formWrap.style.gap = "8px";

    // 카테고리 select
    const catGroup = document.createElement("div");
    const catLabel = document.createElement("div");
    catLabel.className = "field-label";
    catLabel.textContent = "카테고리";

    const catSelect = document.createElement("select");
    catSelect.className = "select";

    const categoryOptions = [
      { value: "", label: "선택 없음" },
      { value: "general", label: "일반" },
      { value: "work", label: "업무" },
      { value: "support", label: "고객응대" },
      { value: "apology", label: "사과" },
      { value: "inquiry", label: "문의" },
      { value: "thanks", label: "감사" },
      { value: "request", label: "요청" },
      { value: "guidance", label: "안내" },
      { value: "report/approval", label: "보고/결재" },
      { value: "feedback", label: "피드백" }
    ];

    categoryOptions.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      catSelect.appendChild(o);
    });

    if (defaults && defaults.selected_categories && defaults.selected_categories[0]) {
      catSelect.value = defaults.selected_categories[0];
    }

    catGroup.appendChild(catLabel);
    catGroup.appendChild(catSelect);

    // 톤 select
    const toneGroup = document.createElement("div");
    const toneLabel = document.createElement("div");
    toneLabel.className = "field-label";
    toneLabel.textContent = "톤";

    const toneSelect = document.createElement("select");
    toneSelect.className = "select";

    const toneOptions = [
      { value: "", label: "선택 없음" },
      { value: "soft", label: "부드럽게" },
      { value: "polite", label: "정중하게" },
      { value: "concise", label: "간결하게" },
      { value: "report", label: "보고서체" },
      { value: "friendly", label: "친근하게" },
      { value: "warmly", label: "따뜻하게" },
      { value: "calmly", label: "차분하게" },
      { value: "formally", label: "격식 있게" },
      { value: "clearly", label: "명확하게" },
      { value: "without_emotion", label: "감정 없이" }
    ];

    toneOptions.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      toneSelect.appendChild(o);
    });

    if (defaults && defaults.selected_tones && defaults.selected_tones[0]) {
      toneSelect.value = defaults.selected_tones[0];
    }

    toneGroup.appendChild(toneLabel);
    toneGroup.appendChild(toneSelect);

    // 옵션 체크박스들
    const checkboxGroup = document.createElement("div");
    checkboxGroup.className = "checkbox-group";

    const honorificLabel = document.createElement("label");
    honorificLabel.className = "checkbox-item";
    const honorificInput = document.createElement("input");
    honorificInput.type = "checkbox";
    honorificInput.checked = !!(defaults && defaults.honorific_checked);
    const honorificSpan = document.createElement("span");
    honorificSpan.textContent = "존댓말";

    honorificLabel.appendChild(honorificInput);
    honorificLabel.appendChild(honorificSpan);

    const openerLabel = document.createElement("label");
    openerLabel.className = "checkbox-item";
    const openerInput = document.createElement("input");
    openerInput.type = "checkbox";
    openerInput.checked = !!(defaults && defaults.opener_checked);
    const openerSpan = document.createElement("span");
    openerSpan.textContent = "완충문·인사";

    openerLabel.appendChild(openerInput);
    openerLabel.appendChild(openerSpan);

    const emojiLabel = document.createElement("label");
    emojiLabel.className = "checkbox-item";
    const emojiInput = document.createElement("input");
    emojiInput.type = "checkbox";
    emojiInput.checked = !!(defaults && defaults.emoji_checked);
    const emojiSpan = document.createElement("span");
    emojiSpan.textContent = "이모지 허용 🙂";

    emojiLabel.appendChild(emojiInput);
    emojiLabel.appendChild(emojiSpan);

    checkboxGroup.appendChild(honorificLabel);
    checkboxGroup.appendChild(openerLabel);
    checkboxGroup.appendChild(emojiLabel);

    formWrap.appendChild(catGroup);
    formWrap.appendChild(toneGroup);
    formWrap.appendChild(checkboxGroup);

    // 메타 요약
    const meta = document.createElement("div");
    meta.className = "tpl-meta";

    if (!defaults) {
      meta.textContent =
        "드래그로 선택한 문장을 우클릭했을 때, 어떤 카테고리·톤·옵션으로 다듬을지 여기에서 설정할 수 있습니다.";
    } else {
      const catVal = (defaults.selected_categories && defaults.selected_categories[0]) || "";
      const toneVal = (defaults.selected_tones && defaults.selected_tones[0]) || "";
      const catLabelText = catVal ? mapCategoryLabel(catVal) : "카테고리 없음";
      const toneLabelText = toneVal ? mapToneLabel(toneVal) : "톤 없음";

      const opts = [];
      if (defaults.honorific_checked) opts.push("존댓말");
      if (defaults.opener_checked) opts.push("완충문");
      if (defaults.emoji_checked) opts.push("이모지");
      const optText = opts.length ? opts.join(", ") : "추가 옵션 없음";

      meta.textContent = `현재 저장된 기본값 · ${catLabelText} · ${toneLabelText} · ${optText}`;
    }

    // 저장 버튼 동작
    saveBtn.addEventListener("click", () => {
      const catVal = catSelect.value || "";
      const toneVal = toneSelect.value || "";

      const newDefaults = {
        selected_categories: catVal ? [catVal] : [],
        selected_tones: toneVal ? [toneVal] : [],
        honorific_checked: honorificInput.checked,
        opener_checked: openerInput.checked,
        emoji_checked: emojiInput.checked
      };

      chrome.storage.sync.set(
        {
          lexinoaSelectionDefaults: newDefaults,
          lexinoaSelectionTemplateTitle: "드래그 영역 다듬기 기본값",
          lexinoaSelectionTemplateId: 0 // Free/Guest는 템플릿 기반 선택이 아니므로 초기화
        },
        () => {
          alert("드래그 영역 다듬기 기본값이 저장되었습니다.");
          refreshTemplatesView();
        }
      );
    });

    item.appendChild(header);
    item.appendChild(formWrap);
    item.appendChild(meta);
    list.appendChild(item);

    return;
  }

  // ------------------------------
  // 2) Pro : 기존 템플릿 + 드래그 기본값 연결 버튼
  // ------------------------------
  info.textContent = "자주 쓰는 설정을 템플릿으로 저장해 두고, 빠르게 불러올 수 있습니다.";
  warning.hidden = true;
  editor.hidden = false;

  await refreshTemplatesInMemory();
  const selectedTplId = await loadSelectionDefaultTemplateId();

  list.innerHTML = "";
  if (!STATE.templates || STATE.templates.length === 0) {
    const empty = document.createElement("div");
    empty.className = "info-text";
    empty.textContent = "저장된 템플릿이 없습니다.";
    list.appendChild(empty);
    return;
  }

  // 선택된 템플릿이 있으면 최상단으로 정렬
  const templatesSorted = [...STATE.templates].sort((a, b) => {
    const aSel = Number(a.id) === selectedTplId ? 0 : 1;
    const bSel = Number(b.id) === selectedTplId ? 0 : 1;
    if (aSel !== bSel) return aSel - bSel;
    return Number(b.id) - Number(a.id);
  });

  templatesSorted.forEach((tpl) => {
    const item = document.createElement("div");
    item.className = "tpl-item";

    // 선택 표시 클래스 (진한 색은 CSS에서 is-selection-default로 처리)
    if (Number(tpl.id) === selectedTplId) {
      item.classList.add("is-selection-default");
    }

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

    const selectionBtn = document.createElement("button");
    selectionBtn.className = "btn small";
    selectionBtn.textContent =
      Number(tpl.id) === selectedTplId ? "드래그 기본값 ✓" : "드래그 기본값으로";

    selectionBtn.addEventListener("click", () => {
      const defaults = {
        selected_categories: tpl.category ? [tpl.category] : [],
        selected_tones: tpl.tone ? [tpl.tone] : [],
        honorific_checked: !!tpl.honorific,
        opener_checked: !!tpl.opener,
        emoji_checked: !!tpl.emoji
      };

      chrome.storage.sync.set(
        {
          lexinoaSelectionDefaults: defaults,
          lexinoaSelectionTemplateTitle: tpl.title || "",
          lexinoaSelectionTemplateId: Number(tpl.id)
        },
        () => {
          alert("이 템플릿을 드래그 영역 다듬기 기본값으로 설정했습니다.");
          // 즉시 UI 반영 (강조 + 맨 위)
          refreshTemplatesView();
          renderTemplateSelect();
        }
      );
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

        // 삭제한 템플릿이 "드래그 기본값"이었다면 선택 상태 초기화
        if (Number(tpl.id) === selectedTplId) {
          chrome.storage.sync.set(
            {
              lexinoaSelectionTemplateId: 0,
              lexinoaSelectionTemplateTitle: "드래그 영역 다듬기 기본값"
            },
            () => {}
          );
        }

        await refreshTemplatesInMemory();
        renderTemplateSelect();
        refreshTemplatesView();
      } catch (e) {
        alert("삭제 중 오류가 발생했습니다.");
      }
    });

    btns.appendChild(applyBtn);
    btns.appendChild(selectionBtn);
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
    box.textContent =
      "로그인되지 않은 상태입니다. 웹에서 로그인하면 Free / Pro 플랜으로 이용할 수 있습니다.";
    return;
  }

  const tier = a.tier || "free";
  const tierLabel = tier === "pro" ? "Pro" : tier === "free" ? "Free" : "Guest";
  const id = a.user_id || "";
  const verified = a.email_verified ? "인증 완료" : "인증 필요";

  box.textContent = `${id} · ${tierLabel} (${verified})`;
}

async function onClickSettingsReset() {
  if (!chrome.storage || !chrome.storage.session) {
    document.getElementById("settings-reset-msg").textContent =
      "세션 스토리지를 사용할 수 없습니다.";
    return;
  }
  chrome.storage.session.clear(() => {
    document.getElementById("settings-reset-msg").textContent =
      "컨텍스트 및 세션 데이터가 초기화되었습니다.";
  });
}


function base64urlEncode(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomString(len = 32) {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  let out = "";
  const rnd = new Uint8Array(len);
  crypto.getRandomValues(rnd);
  for (let i = 0; i < len; i++) out += charset[rnd[i] % charset.length];
  return out;
}

async function pkceChallengeFromVerifier(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64urlEncode(digest);
}

async function connectWithOAuth() {
  const base = STATE.baseUrl.replace(/\/+$/, "");
  const redirectUri = chrome.identity.getRedirectURL("lexinoa");
  const state = randomString(32);
  const codeVerifier = randomString(64);
  const codeChallenge = await pkceChallengeFromVerifier(codeVerifier);

  // 임시 저장(토큰 교환에 필요)
  await new Promise((resolve) => {
    chrome.storage.sync.set(
      { lexinoaPkceVerifier: codeVerifier, lexinoaOauthState: state, lexinoaRedirectUri: redirectUri },
      () => resolve()
    );
  });

  const authUrl =
    `${base}/extension/oauth/authorize` +
    `?redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code_challenge=${encodeURIComponent(codeChallenge)}` +
    `&state=${encodeURIComponent(state)}`;

  const finalUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true
  });

  // finalUrl: https://<extid>.chromiumapp.org/lexinoa?code=...&state=...
  const u = new URL(finalUrl);
  const code = u.searchParams.get("code");
  const returnedState = u.searchParams.get("state");

  const stored = await new Promise((resolve) => {
    chrome.storage.sync.get(["lexinoaPkceVerifier", "lexinoaOauthState", "lexinoaRedirectUri"], (d) => resolve(d));
  });

  if (!code) throw new Error("OAuth failed: missing code");
  if (stored.lexinoaOauthState && returnedState !== stored.lexinoaOauthState) {
    throw new Error("OAuth failed: state mismatch");
  }

  // token 교환
  const tokenRes = await fetch(`${base}/extension/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Lex-Client": "chrome-ext-v1" },
    body: JSON.stringify({
      code,
      code_verifier: stored.lexinoaPkceVerifier,
      redirect_uri: stored.lexinoaRedirectUri
    })
  });

  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.ok) {
    throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
  }

  await setStoredAccessToken(tokenData.access_token);

  // PKCE 임시값 정리
  await new Promise((resolve) => {
    chrome.storage.sync.remove(["lexinoaPkceVerifier", "lexinoaOauthState", "lexinoaRedirectUri"], () => resolve());
  });

  return true;
}


async function updateConnectionStatus() {
  const el = document.getElementById("connStatus");
  if (!el) return;

  const token = await getStoredAccessToken();

  // ✅ FIX: 사용자 혼동 유발 문구 제거
  // - 토큰이 있으면 "연결됨"
  // - 없으면 "미연결"
  if (token) {
    el.textContent = "연결됨";
  } else {
    el.textContent = "미연결";
  }
}

document.getElementById("btnConnect")?.addEventListener("click", async () => {
  try {
    await connectWithOAuth();
    await updateConnectionStatus();
    alert("Lexinoa 계정 연결이 완료되었습니다.");
  } catch (e) {
    alert(String(e && e.message ? e.message : e));
  }
});

document.getElementById("btnDisconnect")?.addEventListener("click", async () => {
  await setStoredAccessToken("");
  await updateConnectionStatus();
  alert("연결이 해제되었습니다.");
});
