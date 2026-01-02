// background.js (MV3 service worker)

// -----------------------------
// 유틸: URL로부터 컨텍스트 감지
// -----------------------------
function detectContextFromUrl(url) {
  const u = (url || "").toLowerCase();
  if (u.includes("mail.google.com")) return { source: "gmail", label: "Gmail 메일" };
  if (u.includes("slack.com")) return { source: "slack", label: "Slack 채팅" };
  if (u.includes("mail.naver.com") || (u.includes("naver.com") && u.includes("/mail"))) {
    return { source: "naver_mail", label: "네이버 메일" };
  }
  if (u.includes("outlook.live.com") || u.includes("outlook.office.com")) {
    return { source: "outlook", label: "Outlook 메일" };
  }
  if (u.includes("teams.microsoft.com")) return { source: "teams", label: "Microsoft Teams" };
  if (u.includes("kakao.com") || u.includes("kakaotalk")) return { source: "kakao", label: "카카오톡/카카오" };
  return { source: "generic", label: "일반 사이트" };
}



// -----------------------------
// 유틸: baseUrl 가져오기
// -----------------------------
function getBaseUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["lexinoaBaseUrl"], (data) => {
      if (data.lexinoaBaseUrl) {
        resolve(data.lexinoaBaseUrl);
      } else {
        resolve("https://www.lexinoa.com");
      }
    });
  });
}

// -----------------------------
// 드래그 영역 다듬기 기본값 가져오기
// -----------------------------
function getSelectionDefaults() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["lexinoaSelectionDefaults"], (data) => {
      resolve(data.lexinoaSelectionDefaults || null);
    });
  });
}

// -----------------------------
// 선택 문장 결과를 탭에 직접 팝업으로 렌더링
// -----------------------------
function showSelectionPopup(tabId, payload) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (payload) => {
      // 여기부터는 페이지 안에서 실행되는 코드

      let popupEl = document.getElementById("lexinoa-selection-popup");

      function ensurePopup() {
        if (popupEl && document.body.contains(popupEl)) return popupEl;

        popupEl = document.createElement("div");
        popupEl.id = "lexinoa-selection-popup";

        const style = popupEl.style;
        style.position = "fixed";
        style.right = "20px";
        style.bottom = "20px";
        style.zIndex = "2147483647";
        style.maxWidth = "360px";
        style.minWidth = "260px";
        style.background = "rgba(15, 23, 42, 0.98)";
        style.color = "#e5e7eb";
        style.borderRadius = "12px";
        style.boxShadow = "0 12px 30px rgba(0,0,0,0.45)";
        style.padding = "10px 12px";
        style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui";
        style.fontSize = "12px";
        style.lineHeight = "1.5";
        style.display = "flex";
        style.flexDirection = "column";
        style.gap = "6px";

        popupEl.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <div style="display:flex; align-items:center; gap:6px;">
              <div style="width:18px; height:18px; border-radius:6px; background:linear-gradient(135deg,#4f46e5,#06b6d4); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700;">L</div>
              <div style="font-weight:600; font-size:12px;">Lexinoa · 문장 순화</div>
            </div>
            <button id="lexinoa-popup-close" style="border:none; background:transparent; color:#9ca3af; cursor:pointer; font-size:14px; padding:0;">✕</button>
          </div>
          <div id="lexinoa-popup-status" style="font-size:11px; color:#9ca3af;"></div>
          <div id="lexinoa-popup-original-wrap" style="display:none;">
            <div style="font-size:11px; color:#9ca3af; margin-bottom:2px;">원문</div>
            <div id="lexinoa-popup-original" style="max-height:60px; overflow:auto; white-space:pre-wrap; background:rgba(15,23,42,0.9); border-radius:8px; padding:6px; border:1px solid rgba(148,163,184,0.4);"></div>
          </div>
          <div id="lexinoa-popup-refined-wrap" style="display:none;">
            <div style="font-size:11px; color:#9ca3af; margin-bottom:2px;">순화된 문장</div>
            <div id="lexinoa-popup-refined" style="max-height:90px; overflow:auto; white-space:pre-wrap; background:#020617; border-radius:8px; padding:6px; border:1px solid rgba(129,140,248,0.8);"></div>
          </div>
          <div id="lexinoa-popup-error" style="display:none; font-size:11px; color:#fecaca;"></div>
          <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:4px;">
            <button id="lexinoa-popup-login" style="display:none; border:none; border-radius:8px; padding:4px 9px; font-size:11px; cursor:pointer; background:#4f46e5; color:#e5e7eb;">로그인</button>
            <button id="lexinoa-popup-upgrade" style="display:none; border:none; border-radius:8px; padding:4px 9px; font-size:11px; cursor:pointer; background:#16a34a; color:#e5e7eb;">플랜 보기</button>
            <button id="lexinoa-popup-copy" style="border:none; border-radius:8px; padding:4px 9px; font-size:11px; cursor:pointer; background:#111827; color:#e5e7eb;">복사</button>
          </div>
        `;

        document.body.appendChild(popupEl);

        const closeBtn = popupEl.querySelector("#lexinoa-popup-close");
        const copyBtn = popupEl.querySelector("#lexinoa-popup-copy");
        const loginBtn = popupEl.querySelector("#lexinoa-popup-login");
        const upgradeBtn = popupEl.querySelector("#lexinoa-popup-upgrade");

        closeBtn.addEventListener("click", () => {
          if (popupEl && popupEl.parentNode) {
            popupEl.parentNode.removeChild(popupEl);
          }
          popupEl = null;
          if (window.__lexinoaPopupHideTimer) {
            clearTimeout(window.__lexinoaPopupHideTimer);
            window.__lexinoaPopupHideTimer = null;
          }
        });

        copyBtn.addEventListener("click", () => {
          const refinedEl = popupEl.querySelector("#lexinoa-popup-refined");
          const text = refinedEl?.textContent || "";
          if (!text) return;
          navigator.clipboard?.writeText(text).catch(() => {});
        });

        // 로그인 / 플랜 보기 버튼 동작
        loginBtn.addEventListener("click", () => {
          if (payload.baseUrl) {
            const base = payload.baseUrl.replace(/\/+$/, "");
            window.open(base + "/login", "_blank");
          }
        });

        upgradeBtn.addEventListener("click", () => {
          if (payload.baseUrl) {
            const base = payload.baseUrl.replace(/\/+$/, "");
            window.open(base + "/pricing", "_blank");
          }
        });

        return popupEl;
      }

      function render(payload) {
        const el = ensurePopup();
        const statusEl = el.querySelector("#lexinoa-popup-status");
        const origWrap = el.querySelector("#lexinoa-popup-original-wrap");
        const origEl = el.querySelector("#lexinoa-popup-original");
        const refinedWrap = el.querySelector("#lexinoa-popup-refined-wrap");
        const refinedEl = el.querySelector("#lexinoa-popup-refined");
        const errEl = el.querySelector("#lexinoa-popup-error");
        const loginBtn = el.querySelector("#lexinoa-popup-login");
        const upgradeBtn = el.querySelector("#lexinoa-popup-upgrade");

        const { status, originalText, refinedText, errorMessage, needLogin, limitKind } = payload;

        origWrap.style.display = "none";
        refinedWrap.style.display = "none";
        errEl.style.display = "none";
        statusEl.textContent = "";

        loginBtn.style.display = "none";
        upgradeBtn.style.display = "none";

        if (window.__lexinoaPopupHideTimer) {
          clearTimeout(window.__lexinoaPopupHideTimer);
          window.__lexinoaPopupHideTimer = null;
        }

        if (status === "loading") {
          statusEl.textContent = "선택한 문장을 순화하는 중입니다...";
          origWrap.style.display = "block";
          origEl.textContent = originalText || "";
        } else if (status === "success") {
          statusEl.textContent = "문장 순화가 완료되었습니다.";
          origWrap.style.display = "block";
          refinedWrap.style.display = "block";
          origEl.textContent = originalText || "";
          refinedEl.textContent = refinedText || "";

          window.__lexinoaPopupHideTimer = setTimeout(() => {
            const p = document.getElementById("lexinoa-selection-popup");
            if (p && p.parentNode) p.parentNode.removeChild(p);
            window.__lexinoaPopupHideTimer = null;
          }, 25000);
        } else if (status === "error") {
          statusEl.textContent = "문장 순화에 실패했습니다.";
          errEl.style.display = "block";
          errEl.textContent = errorMessage || "알 수 없는 오류가 발생했습니다.";

          if (needLogin) {
            loginBtn.style.display = "inline-block";
          } else if (limitKind === "daily" || limitKind === "monthly") {
            upgradeBtn.style.display = "inline-block";
          }
        }
      }

      render(payload);
    },
    args: [payload]
  });
}

// -----------------------------
// 컨텍스트 메뉴 생성 함수
// -----------------------------
function createContextMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "lexinoa_selection_polish",
        title: "Lexinoa로 문장 순화하기",
        contexts: ["selection"]
      });
      console.log("[Lexinoa][bg] context menu created");
    });
  } catch (e) {
    console.error("[Lexinoa][bg] context menu create error", e);
  }
}

// -----------------------------
// 설치 시 기본 baseUrl 설정 + 컨텍스트 메뉴 생성
// -----------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["lexinoaBaseUrl"], (data) => {
    if (!data.lexinoaBaseUrl) {
      chrome.storage.sync.set({
        lexinoaBaseUrl: "https://www.lexinoa.com"
      });
    }
  });

  createContextMenus();
});

// 브라우저 시작/확장 재시작 시에도 메뉴 보장
chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
});

// -----------------------------
// LEX_PING (기존) 핸들러
// -----------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "LEX_PING") {
    sendResponse({ ok: true });
    return true;
  }
});

// -----------------------------
// Lexinoa /api/polish 호출 함수
// -----------------------------
async function callLexinoaPolish(baseUrl, inputText, selectionDefaults) {
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/polish`;

  const body = {
    input_text: inputText,
    selected_categories: [],
    selected_tones: [],
    honorific_checked: false,
    opener_checked: false,
    emoji_checked: false,
    provider: "claude"
  };

  // popup에서 저장한 드래그 기본값 반영
  if (selectionDefaults) {
    body.selected_categories = selectionDefaults.selected_categories || [];
    body.selected_tones = selectionDefaults.selected_tones || [];
    body.honorific_checked = !!selectionDefaults.honorific_checked;
    body.opener_checked = !!selectionDefaults.opener_checked;
    body.emoji_checked = !!selectionDefaults.emoji_checked;

    // 존댓말 ON이면 톤에 polite 확실히 포함시키기
    if (body.honorific_checked) {
      if (!body.selected_tones || body.selected_tones.length === 0) {
        body.selected_tones = ["polite"];
      } else {
        body.selected_tones = body.selected_tones
          .map((t) => (t === "friendly" ? "polite" : t))
          .filter((t, idx, arr) => arr.indexOf(t) === idx);

        if (!body.selected_tones.includes("polite")) {
          body.selected_tones.push("polite");
        }
      }
    }
  }

  async function getStoredAccessToken() {
    const data = await chrome.storage.sync.get(["lexinoaAccessToken"]);
    return data.lexinoaAccessToken || "";
  }

  const token = await getStoredAccessToken();
  const headers = {
    "Content-Type": "application/json",
    "X-Lex-Client": "chrome-ext-v1"
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, {
    method: "POST",
    credentials: token ? "omit" : "include",
    headers,
    body: JSON.stringify(body)
  });


  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error("Lexinoa API error");
    err.status = res.status;
    err.data = data;
    throw err;
  }

  // 디버그: 서버가 몇 개를 주는지 확인
  console.log("[Lexinoa] /api/polish outputs =", data.outputs, "output_text =", data.output_text);

  // 이제 '첫 번째만' 말고 배열 전체를 넘겨줌
  const outputs = data.outputs || (data.output_text ? [data.output_text] : []);
  return outputs;
}





// -----------------------------
// 선택된 문장 순화 처리
// -----------------------------
async function handleSelectionPolish(info, tab) {
  const selectedText = (info.selectionText || "").trim();
  if (!selectedText || !tab || tab.id == null) return;

  const tabId = tab.id;
  const baseUrl = await getBaseUrl();

  // 1) 로딩 상태 먼저 보여주기
  showSelectionPopup(tabId, {
    status: "loading",
    originalText: selectedText,
    refinedText: "",
    errorMessage: "",
    needLogin: false,
    limitKind: null,
    baseUrl
  });

  try {
    // popup 기본값 불러오기
    const selectionDefaults = await getSelectionDefaults();

    // 이제 여기서 outputs = ['문장1', '문장2', ...] 을 받음
    const outputs = await callLexinoaPolish(baseUrl, selectedText, selectionDefaults);
    console.log("[Lexinoa] refined outputs from API =", outputs);

    let refinedForPopup = "";

    if (Array.isArray(outputs)) {
      if (outputs.length <= 1) {
        // guest / free : 한 개만
        refinedForPopup = (outputs[0] || "").trim();
      } else {
        // pro : 여러 개 → 1) 2) 3) 형태로 줄바꿈해서 보여주기
        refinedForPopup = outputs
          .map((txt, idx) => `${idx + 1}) ${(txt || "").trim()}`)
          .join("\n\n");
      }
    } else {
      // 방어 코드: 혹시 문자열로 들어오면 그대로
      refinedForPopup = (outputs || "").toString();
    }

    // 2) 성공
    showSelectionPopup(tabId, {
      status: "success",
      originalText: selectedText,
      refinedText: refinedForPopup,
      errorMessage: "",
      needLogin: false,
      limitKind: null,
      baseUrl
    });
  } catch (e) {
    console.error("[Lexinoa] selection polish error", e);

    let msg = "순화 중 오류가 발생했습니다.";
    let needLogin = false;
    let limitKind = null;

    // e.data가 존재하는지 안전하게 확인하여 예상치 못한 에러를 방지합니다.
    const errorData = e.data || {};

    if (errorData.error === "daily_limit_reached") {
      msg = `오늘 사용 한도를 초과했습니다.`;
      limitKind = "daily";
    } else if (errorData.error === "monthly_limit_reached") {
      msg = `이번 달 사용 한도를 초과했습니다.`;
      limitKind = "monthly";
    } else if (e.status === 401) {
      msg = "로그인이 필요합니다. Lexinoa 웹에서 로그인 후 다시 시도해 주세요.";
      needLogin = true;
    }

    showSelectionPopup(tabId, {
      status: "error",
      originalText: selectedText,
      refinedText: "",
      errorMessage: msg,
      needLogin,
      limitKind,
      baseUrl
    });
  }
}



// -----------------------------
// 컨텍스트 메뉴 클릭 핸들러
// -----------------------------
chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log("[Lexinoa] contextMenus.onClicked", info, tab);

  if (info.menuItemId === "lexinoa_selection_polish") {
    console.log("[Lexinoa] lexinoa_selection_polish clicked");
    handleSelectionPolish(info, tab);
  }
});


// 탭별 컨텍스트 저장 (content script -> background)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "LEXINOA_CONTEXT_UPDATE") return;

  const tabId = sender?.tab?.id;
  if (!tabId) {
    sendResponse({ ok: false, error: "no_tab_id" });
    return;
  }

  const ctx = msg.ctx || null;

  chrome.storage.session.get(["lexinoaContextByTab"], (data) => {
    const map = (data && data.lexinoaContextByTab) ? data.lexinoaContextByTab : {};
    map[String(tabId)] = ctx;

    chrome.storage.session.set({ lexinoaContextByTab: map }, () => {
      sendResponse({ ok: true });
    });
  });

  return true; // async response
});
