// popup.js
// NOTE:
// - "드래그 기본값으로" 선택 시:
//   1) 선택된 템플릿을 더 진하게 표시 (is-selection-default 클래스 부여)
//   2) 해당 템플릿을 목록 최상단으로 정렬
//   3) 선택 상태를 chrome.storage.sync에 lexinoaSelectionTemplateId 로 저장
//   4) 선택된 항목 버튼 텍스트를 "드래그 기본값 ✓" 로 표시
// - Free/Guest의 "드래그 기본값(1개)" 저장 시, lexinoaSelectionTemplateId는 0으로 초기화

// ----------------------
// 전역 상태
// ----------------------

// ----------------------
// UI language override (popup runtime switch)
// ----------------------
let UI_LANG_OVERRIDE = "auto"; // "auto" | "ko" | "en"
const LOCALE_CACHE = {}; // { lang: { key: {message: "..."} } }

async function loadLocaleMessages(lang) {
  if (lang === "auto") return;
  if (LOCALE_CACHE[lang]) return;

  const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load locale messages: ${lang}`);
  LOCALE_CACHE[lang] = await res.json();
}

function applySubstitutions(msg, substitutions) {
  if (!substitutions || !Array.isArray(substitutions)) return msg;
  let out = msg;
  substitutions.forEach((v, i) => {
    const token = `$${i + 1}`;
    out = out.split(token).join(String(v));
  });
  return out;
}

// 단일 t(): UI override -> chrome i18n fallback
function t(key, substitutions) {
  try {
    const lang = UI_LANG_OVERRIDE || "auto";

    if (lang !== "auto") {
      const pack = LOCALE_CACHE[lang];
      const entry = pack && pack[key];
      if (entry && typeof entry.message === "string") {
        return applySubstitutions(entry.message, substitutions);
      }
    }

    const msg = chrome.i18n.getMessage(key, substitutions);
    return msg || key;
  } catch (e) {
    return key;
  }
}

function applyI18n() {
  const uiLang =
    UI_LANG_OVERRIDE && UI_LANG_OVERRIDE !== "auto"
      ? UI_LANG_OVERRIDE
      : (chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || "en";

  document.documentElement.lang = uiLang;
  document.title = t("popupPageTitle");

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    el.textContent = t(key);
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key) return;
    el.setAttribute("placeholder", t(key));
  });
}

// ----------------------
// Web language (for website, not extension UI)
// ----------------------
function getStoredWebLang() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["lexinoaWebLang"], (data) => {
      const v = (data && data.lexinoaWebLang) ? String(data.lexinoaWebLang) : "";
      resolve(v === "en" ? "en" : "ko");
    });
  });
}

function setStoredWebLang(lang) {
  return new Promise((resolve) => {
    const v = (lang === "en") ? "en" : "ko";
    chrome.storage.sync.set({ lexinoaWebLang: v }, () => resolve());
  });
}

// 웹 서버에 /lang/<code> 라우트가 있어야 함
function buildWebLangUrl(langCode) {
  const lang = (langCode === "en") ? "en" : "ko";
  return withBaseUrl(`/lang/${lang}?next=/`);
}

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
    label: "", // 초기엔 i18n 후 세팅
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
  if (!url) return { key: "generic", label: t("ctxGenericLabel") };

  const u = url.toLowerCase();

  if (u.includes("mail.google.com")) return { key: "gmail", label: t("ctxGmailLabel") };
  if (u.includes("slack.com")) return { key: "slack", label: t("ctxSlackLabel") };
  if (u.includes("mail.naver.com") || (u.includes("naver.com") && u.includes("/mail"))) {
    return { key: "naver_mail", label: t("ctxNaverMailLabel") };
  }
  if (u.includes("outlook.live.com") || u.includes("outlook.office.com")) {
    return { key: "outlook", label: t("ctxOutlookLabel") };
  }
  if (u.includes("teams.microsoft.com")) return { key: "teams", label: t("ctxTeamsLabel") };
  if (u.includes("kakao.com") || u.includes("kakaotalk")) return { key: "kakao", label: t("ctxKakaoLabel") };

  return { key: "generic", label: t("ctxGenericLabel") };
}

const CONTEXT_LABELS = {
  gmail: () => t("ctxGmailLabel"),
  slack: () => t("ctxSlackLabel"),
  naver_mail: () => t("ctxNaverMailLabel"),
  outlook: () => t("ctxOutlookLabel"),
  teams: () => t("ctxTeamsLabel"),
  kakao: () => t("ctxKakaoLabel"),
  generic: () => t("ctxGenericLabel")
};

function guessDefaultsForContext(ctxKey) {
  if (ctxKey === "gmail" || ctxKey === "naver_mail" || ctxKey === "outlook") return { category: "work", tone: "polite" };
  if (ctxKey === "slack" || ctxKey === "teams") return { category: "work", tone: "friendly" };
  if (ctxKey === "kakao") return { category: "general", tone: "friendly" };
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
    const labelFn = CONTEXT_LABELS[STATE.manualContext] || (() => t("ctxGenericLabel"));
    return {
      source: STATE.manualContext,
      label: labelFn(),
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

  if (token) headers["Authorization"] = `Bearer ${token}`;

  const init = {
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
  // 1) UI 언어 오버라이드 먼저 로드
  try {
    const saved = await new Promise((resolve) => {
      chrome.storage.sync.get(["lexinoaUiLang"], (d) => resolve(d.lexinoaUiLang || "auto"));
    });
    UI_LANG_OVERRIDE = (saved === "ko" || saved === "en") ? saved : "auto";
    await loadLocaleMessages(UI_LANG_OVERRIDE);
  } catch (_) {}

  // 2) i18n 적용
  applyI18n();

  // 3) 기본 컨텍스트 라벨 초기화
  if (!STATE.context.label) STATE.context.label = t("ctxGenericLabel");

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

      if (target === "view-history") refreshHistoryView();
      if (target === "view-templates") refreshTemplatesView();
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
  // 웹 열기
  const openWeb = document.getElementById("open-web");
  if (openWeb) {
    openWeb.addEventListener("click", async () => {
      const lang = await getStoredWebLang();
      chrome.tabs.create({ url: `${STATE.baseUrl}/?lang=${lang}` });
    });
  }

  // 웹 언어 선택 (웹사이트용)
  const webLangSelect = document.getElementById("web-lang-select");
  if (webLangSelect) {
    getStoredWebLang().then((lang) => { webLangSelect.value = lang; });
    webLangSelect.addEventListener("change", async (e) => {
      const lang = e.target.value === "en" ? "en" : "ko";
      await setStoredWebLang(lang);
      chrome.tabs.create({ url: buildWebLangUrl(lang) });
    });
  }

  // 팝업 UI 언어 선택 (즉시 반영)
  const langSelect = document.getElementById("lang-select");
  if (langSelect) {
    langSelect.value = UI_LANG_OVERRIDE;

    langSelect.addEventListener("change", async (e) => {
      const v = e.target.value;
      UI_LANG_OVERRIDE = (v === "ko" || v === "en") ? v : "auto";

      chrome.storage.sync.set({ lexinoaUiLang: UI_LANG_OVERRIDE }, async () => {
        try {
          await loadLocaleMessages(UI_LANG_OVERRIDE);
        } catch (_) {}
        applyI18n();
        // 동적 텍스트 재랜더
        updateContextDisplay();
        updateStatusBar();
        renderTemplateSelect();
      });
    });
  }

  // 컨텍스트 수동 선택
  const ctxSelect = document.getElementById("context-manual");
  if (ctxSelect) {
    ctxSelect.addEventListener("change", async (e) => {
      const val = e.target.value;

      if (val === "auto" && STATE.tier !== "pro") {
        alert(t("alertProContext"));
        ctxSelect.value = "generic";
        STATE.manualContext = "generic";

        const label = (CONTEXT_LABELS["generic"] ? CONTEXT_LABELS["generic"]() : t("ctxGenericLabel"));
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
        const label = CONTEXT_LABELS[val] ? CONTEXT_LABELS[val]() : t("ctxGenericLabel");
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
  }

  // 카테고리/톤 칩
  document.getElementById("category-select")?.addEventListener("change", (e) => {
    addChip("category", e.target.value);
    e.target.selectedIndex = 0;
  });
  document.getElementById("tone-select")?.addEventListener("change", (e) => {
    addChip("tone", e.target.value);
    e.target.selectedIndex = 0;
  });

  // 버튼들
  document.getElementById("btn-rewrite")?.addEventListener("click", onClickRewrite);
  document.getElementById("template-save-from-current")?.addEventListener("click", onClickSaveTemplateFromCurrent);
  document.getElementById("tpl-save")?.addEventListener("click", onClickTemplateSave);

  document.getElementById("settings-open-login")?.addEventListener("click", () => {
    chrome.tabs.create({ url: withBaseUrl("/login") });
  });
  document.getElementById("settings-reset")?.addEventListener("click", onClickSettingsReset);

  // env/theme 라디오
  document.querySelectorAll('input[name="env"]')?.forEach((r) => r.addEventListener("change", onEnvChange));
  document.querySelectorAll('input[name="theme"]')?.forEach((r) => r.addEventListener("change", onThemeChange));
}

// ----------------------
// Base URL (prod/local)
// ----------------------
const PROD_BASE_URL = "https://www.lexinoa.com";
const LOCAL_BASE_URL = "http://127.0.0.1:5000";

async function loadBaseUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["lexinoaBaseUrl"], (data) => {
      const saved = (data && data.lexinoaBaseUrl) ? String(data.lexinoaBaseUrl) : "";
      const base = saved.trim().replace(/\/+$/, "");

      if (base === LOCAL_BASE_URL || base === "http://localhost:5000") {
        STATE.baseUrl = LOCAL_BASE_URL;
      } else {
        STATE.baseUrl = PROD_BASE_URL;
      }
      resolve();
    });
  });
}

function renderEnvRadios() {
  const prod = document.querySelector('input[name="env"][value="prod"]');
  const local = document.querySelector('input[name="env"][value="local"]');
  const base = String(STATE.baseUrl || "").trim().replace(/\/+$/, "");

  if (local) local.checked = (base === LOCAL_BASE_URL);
  if (prod) prod.checked = (base !== LOCAL_BASE_URL);
}

function onEnvChange(e) {
  const val = e && e.target && e.target.value ? e.target.value : "prod";
  STATE.baseUrl = (val === "local") ? LOCAL_BASE_URL : PROD_BASE_URL;

  chrome.storage.sync.set({ lexinoaBaseUrl: STATE.baseUrl }, () => {
    renderEnvRadios();
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
        resolve();
        return;
      }
      if (resp && resp.ok && resp.ctx) {
        // resp.ctx.label이 서버/콘텐츠에서 한글로 넘어올 수 있어 i18n 라벨로 교정
        const label = CONTEXT_LABELS[resp.ctx.source]
          ? CONTEXT_LABELS[resp.ctx.source]()
          : (resp.ctx.label || t("ctxGenericLabel"));

        STATE.context = { ...resp.ctx, label };
      }
      resolve();
    });
  });
}

function updateContextDisplay() {
  const ctx = getFullContext();
  const el = document.getElementById("context-display");
  if (el) el.textContent = ctx.label || t("ctxGenericLabel");
}

// ----------------------
// 칩 (카테고리/톤)
// ----------------------
function addChip(type, value) {
  if (!value) return;

  if (type === "category") {
    const box = document.getElementById("category-chips");
    if (!box) return;
    if (Array.from(box.children).some((c) => c.dataset.value === value)) return;

    const chip = document.createElement("div");
    chip.className = "chip";
    chip.dataset.value = value;
    chip.textContent = mapCategoryLabel(value);
    chip.addEventListener("click", () => chip.remove());
    box.appendChild(chip);
  } else if (type === "tone") {
    const box = document.getElementById("tone-chips");
    if (!box) return;
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
  if (!box) return [];
  return Array.from(box.children).map((c) => c.dataset.value);
}

function getSelectedTones() {
  const box = document.getElementById("tone-chips");
  if (!box) return [];
  return Array.from(box.children).map((c) => c.dataset.value);
}

function mapCategoryLabel(v) {
  const map = {
    general: "catGeneral",
    work: "catWork",
    support: "catSupport",
    apology: "catApology",
    inquiry: "catInquiry",
    thanks: "catThanks",
    request: "catRequest",
    guidance: "catGuidance",
    "report/approval": "catReport",
    feedback: "catFeedback"
  };
  return map[v] ? t(map[v]) : v;
}

function mapToneLabel(v) {
  const map = {
    soft: "toneSoft",
    polite: "tonePolite",
    concise: "toneConcise",
    report: "toneReport",
    friendly: "toneFriendly",
    warmly: "toneWarmly",
    calmly: "toneCalmly",
    formally: "toneFormally",
    clearly: "toneClearly",
    without_emotion: "toneNoEmotion"
  };
  return map[v] ? t(map[v]) : v;
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
  if (!tierEl || !usageEl) return;

  const tier = STATE.tier || "guest";
  let label = t("tierGuest");
  if (tier === "free") label = t("tierFree");
  if (tier === "pro") label = t("tierPro");
  tierEl.textContent = label;

  if (STATE.usage && STATE.usage.limit > 0) {
    usageEl.textContent = t("statusUsageFormat", [
      String(STATE.usage.limit),
      String(STATE.usage.limit - STATE.usage.used)
    ]);
  } else {
    usageEl.textContent = t("statusUsageUnavailable");
  }

  const proBadge = document.getElementById("template-pro-badge");
  if (proBadge) proBadge.hidden = !(tier === "pro");
}

// ----------------------
// 순화하기
// ----------------------
async function onClickRewrite() {
  const input = document.getElementById("input-text");
  const errEl = document.getElementById("rewrite-error");
  const btn = document.getElementById("btn-rewrite");
  const spinner = document.getElementById("btn-rewrite-spinner");

  if (!input || !errEl || !btn || !spinner) return;

  errEl.hidden = true;
  errEl.textContent = "";

  const text = (input.value || "").trim();
  if (!text) {
    errEl.textContent = t("errNeedInput");
    errEl.hidden = false;
    return;
  }

  btn.disabled = true;
  spinner.hidden = false;

  try {
    const cats = getSelectedCategories();
    const tones = getSelectedTones();
    const honorific = !!document.getElementById("opt-honorific")?.checked;
    const opener = !!document.getElementById("opt-opener")?.checked;
    const emoji = !!document.getElementById("opt-emoji")?.checked;

    const ctx = getFullContext();

    const body = {
      input_text: text,
      selected_categories: cats,
      selected_tones: tones,
      honorific_checked: honorific,
      opener_checked: opener,
      emoji_checked: emoji,
      provider: "claude",
      context_source: ctx.source || "generic",
      context_label: ctx.label || t("ctxGenericLabel")
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
    let msg = t("errRequestFailed");
    if (e.data && e.data.error === "daily_limit_reached") {
      msg = t("errDailyLimit", [String(e.data.limit)]);
    } else if (e.data && e.data.error === "monthly_limit_reached") {
      msg = t("errMonthlyLimit", [String(e.data.limit)]);
    } else if (e.status === 401) {
      msg = t("errNeedLogin");
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
  if (!list || !note) return;

  list.innerHTML = "";

  if (!outputs || outputs.length === 0) {
    note.textContent = "";
    return;
  }

  const tier = STATE.tier || "guest";
  note.textContent = tier === "pro"
    ? t("noteCompareCount", [String(outputs.length)])
    : t("noteProUpTo3");

  outputs.forEach((text, idx) => {
    const card = document.createElement("div");
    card.className = "output-card";

    const header = document.createElement("div");
    header.className = "output-card-header";

    const title = document.createElement("div");
    title.className = "output-card-title";
    title.textContent = t("resultTitle", [String(idx + 1)]);

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn ghost small";
    copyBtn.textContent = t("btnCopy");
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
  baseOption.textContent = tier === "pro"
    ? t("templateSelectPlaceholderPro")
    : t("templateProOnlyInline");
  select.appendChild(baseOption);

  if (tier !== "pro") {
    select.disabled = true;
    return;
  }

  select.disabled = false;

  STATE.templates.forEach((tpl) => {
    const opt = document.createElement("option");
    opt.value = String(tpl.id);
    opt.textContent = tpl.title || `Template #${tpl.id}`;
    select.appendChild(opt);
  });

  // 중복 addEventListener 방지: 새로 그릴 때마다 핸들러를 재설정
  select.onchange = (e) => {
    const id = Number(e.target.value || 0);
    if (!id) return;

    const tpl = STATE.templates.find((t0) => t0.id === id);
    if (!tpl) return;

    applyTemplateToForm(tpl);
  };
}

function applyTemplateToForm(tpl) {
  const cat = tpl.category || "";
  const tone = tpl.tone || "";

  const catBox = document.getElementById("category-chips");
  const toneBox = document.getElementById("tone-chips");
  if (!catBox || !toneBox) return;

  catBox.innerHTML = "";
  toneBox.innerHTML = "";

  if (cat) addChip("category", cat);
  if (tone) addChip("tone", tone);

  const honor = document.getElementById("opt-honorific");
  const opener = document.getElementById("opt-opener");
  const emoji = document.getElementById("opt-emoji");
  if (honor) honor.checked = !!tpl.honorific;
  if (opener) opener.checked = !!tpl.opener;
  if (emoji) emoji.checked = !!tpl.emoji;
}

async function onClickSaveTemplateFromCurrent() {
  if (STATE.tier !== "pro") {
    alert(t("alertTemplateProOnly"));
    return;
  }

  const cats = getSelectedCategories();
  const tones = getSelectedTones();
  const honorific = !!document.getElementById("opt-honorific")?.checked;
  const opener = !!document.getElementById("opt-opener")?.checked;
  const emoji = !!document.getElementById("opt-emoji")?.checked;

  const ctx = getFullContext();
  const defaultName = `${ctx.label} · ${cats[0] ? mapCategoryLabel(cats[0]) : t("metaNoCategory")}`;

  const title = prompt(t("templateNameLabel"), defaultName);
  if (!title) return;

  const category = cats[0] || "";
  const tone = tones[0] || "";

  try {
    await apiFetch("/api/user_templates", {
      method: "POST",
      body: JSON.stringify({ title, category, tone, honorific, opener, emoji })
    });
    await refreshTemplatesInMemory();
    renderTemplateSelect();
    alert(t("alertTemplateSaved"));
  } catch (e) {
    alert(t("alertTemplateSaveError"));
  }
}

async function onClickTemplateSave() {
  if (STATE.tier !== "pro") {
    alert(t("alertTemplateProOnly"));
    return;
  }

  const title = (document.getElementById("tpl-title")?.value || "").trim();
  const category = document.getElementById("tpl-category")?.value || "";
  const tone = document.getElementById("tpl-tone")?.value || "";
  const honorific = !!document.getElementById("tpl-honorific")?.checked;
  const opener = !!document.getElementById("tpl-opener")?.checked;
  const emoji = !!document.getElementById("tpl-emoji")?.checked;

  if (!title) {
    alert(t("alertNeedTemplateName"));
    return;
  }

  try {
    await apiFetch("/api/user_templates", {
      method: "POST",
      body: JSON.stringify({ title, category, tone, honorific, opener, emoji })
    });
    const ttl = document.getElementById("tpl-title");
    if (ttl) ttl.value = "";
    await refreshTemplatesInMemory();
    renderTemplateSelect();
    refreshTemplatesView();
    alert(t("alertTemplateSaved"));
  } catch (e) {
    alert(t("alertTemplateSaveError"));
  }
}

async function refreshTemplatesView() {
  const info = document.getElementById("tpl-info");
  const warning = document.getElementById("tpl-warning");
  const editor = document.getElementById("tpl-editor");
  const list = document.getElementById("tpl-list");
  if (!info || !warning || !editor || !list) return;

  const tier = STATE.tier || "guest";

  // 1) Guest / Free
  if (tier !== "pro") {
    info.textContent = t("templatesProInfo");
    warning.hidden = true;
    editor.hidden = true;
    list.innerHTML = "";

    const { defaults } = await loadSelectionDefaultsForView();

    const item = document.createElement("div");
    item.className = "tpl-item";

    const header = document.createElement("div");
    header.className = "tpl-header";

    const headerTitle = document.createElement("div");
    headerTitle.textContent = t("selectionDefaultsTitle");

    const btns = document.createElement("div");

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn small";
    saveBtn.textContent = t("btnSaveWithThisSettings");

    btns.appendChild(saveBtn);
    header.appendChild(headerTitle);
    header.appendChild(btns);

    const formWrap = document.createElement("div");
    formWrap.style.marginTop = "8px";
    formWrap.style.display = "flex";
    formWrap.style.flexDirection = "column";
    formWrap.style.gap = "8px";

    // Category
    const catGroup = document.createElement("div");
    const catLabel = document.createElement("div");
    catLabel.className = "field-label";
    catLabel.textContent = t("fieldCategory");

    const catSelect = document.createElement("select");
    catSelect.className = "select";

    const categoryOptions = [
      { value: "", key: "noneOption" },
      { value: "general", key: "catGeneral" },
      { value: "work", key: "catWork" },
      { value: "support", key: "catSupport" },
      { value: "apology", key: "catApology" },
      { value: "inquiry", key: "catInquiry" },
      { value: "thanks", key: "catThanks" },
      { value: "request", key: "catRequest" },
      { value: "guidance", key: "catGuidance" },
      { value: "report/approval", key: "catReport" },
      { value: "feedback", key: "catFeedback" }
    ];

    categoryOptions.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = t(opt.key);
      catSelect.appendChild(o);
    });

    if (defaults?.selected_categories?.[0]) catSelect.value = defaults.selected_categories[0];

    catGroup.appendChild(catLabel);
    catGroup.appendChild(catSelect);

    // Tone
    const toneGroup = document.createElement("div");
    const toneLabel = document.createElement("div");
    toneLabel.className = "field-label";
    toneLabel.textContent = t("fieldTone");

    const toneSelect = document.createElement("select");
    toneSelect.className = "select";

    const toneOptions = [
      { value: "", key: "noneOption" },
      { value: "soft", key: "toneSoft" },
      { value: "polite", key: "tonePolite" },
      { value: "concise", key: "toneConcise" },
      { value: "report", key: "toneReport" },
      { value: "friendly", key: "toneFriendly" },
      { value: "warmly", key: "toneWarmly" },
      { value: "calmly", key: "toneCalmly" },
      { value: "formally", key: "toneFormally" },
      { value: "clearly", key: "toneClearly" },
      { value: "without_emotion", key: "toneNoEmotion" }
    ];

    toneOptions.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = t(opt.key);
      toneSelect.appendChild(o);
    });

    if (defaults?.selected_tones?.[0]) toneSelect.value = defaults.selected_tones[0];

    toneGroup.appendChild(toneLabel);
    toneGroup.appendChild(toneSelect);

    // Options
    const checkboxGroup = document.createElement("div");
    checkboxGroup.className = "checkbox-group";

    const honorificLabel = document.createElement("label");
    honorificLabel.className = "checkbox-item";
    const honorificInput = document.createElement("input");
    honorificInput.type = "checkbox";
    honorificInput.checked = !!defaults?.honorific_checked;
    const honorificSpan = document.createElement("span");
    honorificSpan.textContent = t("optHonorificShort");
    honorificLabel.appendChild(honorificInput);
    honorificLabel.appendChild(honorificSpan);

    const openerLabel = document.createElement("label");
    openerLabel.className = "checkbox-item";
    const openerInput = document.createElement("input");
    openerInput.type = "checkbox";
    openerInput.checked = !!defaults?.opener_checked;
    const openerSpan = document.createElement("span");
    openerSpan.textContent = t("optOpenerShort");
    openerLabel.appendChild(openerInput);
    openerLabel.appendChild(openerSpan);

    const emojiLabel = document.createElement("label");
    emojiLabel.className = "checkbox-item";
    const emojiInput = document.createElement("input");
    emojiInput.type = "checkbox";
    emojiInput.checked = !!defaults?.emoji_checked;
    const emojiSpan = document.createElement("span");
    emojiSpan.textContent = t("optEmojiShort");
    emojiLabel.appendChild(emojiInput);
    emojiLabel.appendChild(emojiSpan);

    checkboxGroup.appendChild(honorificLabel);
    checkboxGroup.appendChild(openerLabel);
    checkboxGroup.appendChild(emojiLabel);

    formWrap.appendChild(catGroup);
    formWrap.appendChild(toneGroup);
    formWrap.appendChild(checkboxGroup);

    const meta = document.createElement("div");
    meta.className = "tpl-meta";

    const catVal = defaults?.selected_categories?.[0] || "";
    const toneVal = defaults?.selected_tones?.[0] || "";

    const catLabelText = catVal ? mapCategoryLabel(catVal) : t("metaNoCategory");
    const toneLabelText = toneVal ? mapToneLabel(toneVal) : t("metaNoTone");

    const opts = [];
    if (defaults?.honorific_checked) opts.push(t("optHonorificShort"));
    if (defaults?.opener_checked) opts.push(t("optOpenerShort"));
    if (defaults?.emoji_checked) opts.push(t("optEmojiShort"));
    const optText = opts.length ? opts.join(", ") : t("metaNoOptions");

    meta.textContent = t("tplDefaultMetaFormat", [catLabelText, toneLabelText, optText]);

    saveBtn.addEventListener("click", () => {
      const newDefaults = {
        selected_categories: catSelect.value ? [catSelect.value] : [],
        selected_tones: toneSelect.value ? [toneSelect.value] : [],
        honorific_checked: honorificInput.checked,
        opener_checked: openerInput.checked,
        emoji_checked: emojiInput.checked
      };

      chrome.storage.sync.set(
        {
          lexinoaSelectionDefaults: newDefaults,
          lexinoaSelectionTemplateTitle: t("selectionDefaultsTitle"),
          lexinoaSelectionTemplateId: 0
        },
        () => {
          alert(t("alertTemplateSaved"));
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

  // 2) Pro
  info.textContent = t("templatesHelpText");
  warning.hidden = true;
  editor.hidden = false;

  await refreshTemplatesInMemory();
  const selectedTplId = await loadSelectionDefaultTemplateId();

  list.innerHTML = "";
  if (!STATE.templates || STATE.templates.length === 0) {
    const empty = document.createElement("div");
    empty.className = "info-text";
    empty.textContent = t("templatesEmpty");
    list.appendChild(empty);
    return;
  }

  const templatesSorted = [...STATE.templates].sort((a, b) => {
    const aSel = Number(a.id) === selectedTplId ? 0 : 1;
    const bSel = Number(b.id) === selectedTplId ? 0 : 1;
    if (aSel !== bSel) return aSel - bSel;
    return Number(b.id) - Number(a.id);
  });

  templatesSorted.forEach((tpl) => {
    const item = document.createElement("div");
    item.className = "tpl-item";
    if (Number(tpl.id) === selectedTplId) item.classList.add("is-selection-default");

    const header = document.createElement("div");
    header.className = "tpl-header";

    const title = document.createElement("div");
    title.textContent = tpl.title || `Template #${tpl.id}`;

    const btns = document.createElement("div");
    btns.className = "tpl-actions";

    const applyBtn = document.createElement("button");
    applyBtn.className = "btn ghost small";
    applyBtn.textContent = t("btnApply");
    applyBtn.addEventListener("click", () => {
      applyTemplateToForm(tpl);
      alert(t("alertTemplateApplied"));
    });

    const selectionBtn = document.createElement("button");
    selectionBtn.className = "btn small";
    selectionBtn.textContent =
      Number(tpl.id) === selectedTplId ? t("btnUseAsSelectionDefaultChecked") : t("btnUseAsSelectionDefault");

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
          alert(t("btnUseAsSelectionDefaultChecked"));
          refreshTemplatesView();
          renderTemplateSelect();
        }
      );
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger small";
    delBtn.textContent = t("btnDelete");
    
    delBtn.addEventListener("click", async () => {
      if (!confirm(t("confirmDeleteTemplate"))) return;
      try {
        await apiFetch(`/api/user_templates/${tpl.id}`, { method: "DELETE" });

        if (Number(tpl.id) === selectedTplId) {
          chrome.storage.sync.set(
            {
              lexinoaSelectionTemplateId: 0,
              lexinoaSelectionTemplateTitle: t("selectionDefaultsTitle")
            },
            () => {}
          );
        }

        await refreshTemplatesInMemory();
        renderTemplateSelect();
        refreshTemplatesView();
      } catch (e) {
        alert(t("alertDeleteError"));
      }
    });

    btns.appendChild(applyBtn);
    btns.appendChild(selectionBtn);
    btns.appendChild(delBtn);

    header.appendChild(title);
    header.appendChild(btns);

    const meta = document.createElement("div");
    meta.className = "tpl-meta";

    const catLabel = tpl.category ? mapCategoryLabel(tpl.category) : t("metaNoCategory");
    const toneLabel = tpl.tone ? mapToneLabel(tpl.tone) : t("metaNoTone");

    const opts = [];
    if (tpl.honorific) opts.push(t("optHonorificShort"));
    if (tpl.opener) opts.push(t("optOpenerShort"));
    if (tpl.emoji) opts.push(t("optEmojiShort"));
    const optText = opts.length ? opts.join(", ") : t("metaNoOptions");

    meta.textContent = t("tplMetaFormat", [catLabel, toneLabel, optText]);

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
  if (!info || !list) return;

  const tier = STATE.tier || "guest";
  if (tier !== "pro") {
    info.textContent = t("historyProInfo"); // 키 정정
    list.innerHTML = "";
    return;
  }

  info.textContent = t("historyHelpText");
  list.innerHTML = "";

  try {
    const data = await apiFetch("/api/history?limit=20", { method: "GET" });
    const items = data.items || [];
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "info-text";
      empty.textContent = t("historyEmpty");
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

      meta.appendChild(dt);

      const body = document.createElement("div");
      body.className = "history-body";
      body.textContent = r.input_text || "";

      const footer = document.createElement("div");
      footer.className = "history-meta";

      const btnApply = document.createElement("button");
      btnApply.className = "btn ghost small";
      btnApply.textContent = t("btnLoadSentence");
      btnApply.addEventListener("click", () => {
        const input = document.getElementById("input-text");
        if (input) input.value = r.input_text || "";
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
    err.textContent = t("errHistoryLoad");
    list.appendChild(err);
  }
}

function switchTab(targetId) {
  const buttons = document.querySelectorAll(".tab-button");
  const views = document.querySelectorAll(".view");
  buttons.forEach((b) => {
    const dt = b.getAttribute("data-target");
    b.classList.toggle("active", dt === targetId);
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
  if (!box) return;

  if (!a.logged_in) {
    box.textContent = t("authChecking"); // 최소한 i18n 키로 처리
    return;
  }

  const tier = a.tier || "free";
  const tierLabel = tier === "pro" ? t("tierPro") : tier === "free" ? t("tierFree") : t("tierGuest");
  const id = a.user_id || "";
  const verified = a.email_verified ? t("verifiedYes") : t("verifiedNo");

  box.textContent = `${id} · ${tierLabel} (${verified})`;
}

async function onClickSettingsReset() {
  const msgEl = document.getElementById("settings-reset-msg");
  if (!msgEl) return;

  if (!chrome.storage || !chrome.storage.session) {
    msgEl.textContent = t("errRequestFailed");
    return;
  }
  chrome.storage.session.clear(() => {
    msgEl.textContent = t("resetBtn");
  });
}

// ----------------------
// OAuth
// ----------------------
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

  const finalUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });

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

  await new Promise((resolve) => {
    chrome.storage.sync.remove(["lexinoaPkceVerifier", "lexinoaOauthState", "lexinoaRedirectUri"], () => resolve());
  });

  return true;
}

async function updateConnectionStatus() {
  const el = document.getElementById("connStatus");
  if (!el) return;

  const token = await getStoredAccessToken();
  el.textContent = token ? t("connConnected") : t("connDisconnected");
}

// 버튼 이벤트는 DOMContentLoaded 이후에만 붙여야 안전 (popup에서 null 방지)
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnConnect")?.addEventListener("click", async () => {
    try {
      await connectWithOAuth();
      await updateConnectionStatus();
      alert(t("alertAccountConnected"));
    } catch (e) {
      alert(String(e && e.message ? e.message : e));
    }
  });

  document.getElementById("btnDisconnect")?.addEventListener("click", async () => {
    await setStoredAccessToken("");
    await updateConnectionStatus();
    alert(t("alertDisconnected"));
  });
});
