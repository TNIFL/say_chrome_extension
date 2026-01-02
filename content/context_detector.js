// content/context_detector.js
(() => {
  function detectContext() {
    const host = window.location.hostname || "";
    const href = window.location.href || "";
    const lcHost = host.toLowerCase();
    const lcHref = href.toLowerCase();

    let ctx = {
      source: "generic",
      label: "일반 사이트",
      suggestedCategory: "general",
      suggestedTone: "polite"
    };

    if (lcHost === "mail.google.com" || lcHost.endsWith(".gmail.com")) {
      ctx = {
        source: "gmail",
        label: "Gmail 메일",
        suggestedCategory: "work",
        suggestedTone: "polite"
      };
    } else if (lcHost.endsWith(".slack.com") || lcHost === "slack.com") {
      ctx = {
        source: "slack",
        label: "Slack 채팅",
        suggestedCategory: "work",
        suggestedTone: "friendly"
      };
    } else if (lcHost === "mail.naver.com") {
      ctx = {
        source: "naver_mail",
        label: "네이버 메일",
        suggestedCategory: "work",
        suggestedTone: "polite"
      };
    } else if (lcHost === "outlook.office.com" || lcHost === "outlook.live.com") {
      ctx = {
        source: "outlook",
        label: "Outlook 메일",
        suggestedCategory: "work",
        suggestedTone: "polite"
      };
    } else if (lcHost === "teams.microsoft.com") {
      ctx = {
        source: "teams",
        label: "Microsoft Teams",
        suggestedCategory: "work",
        suggestedTone: "friendly"
      };
    } else if (lcHost.includes("kakao.com") || lcHref.includes("talk")) {
      ctx = {
        source: "kakao",
        label: "카카오톡 / 카카오 서비스",
        suggestedCategory: "general",
        suggestedTone: "friendly"
      };
    }

    return ctx;
  }

  // 너무 자주 호출되지 않게 throttle
  let lastSent = 0;
  let lastKey = "";
  function sendContext(reason) {
    const now = Date.now();
    if (now - lastSent < 500) return; // 0.5s throttle

    const ctx = detectContext();
    const key = `${ctx.source}|${location.hostname}|${location.pathname}`;

    // 바뀐 경우만 전송
    if (key === lastKey) return;

    lastKey = key;
    lastSent = now;

    try {
      chrome.runtime.sendMessage(
        { type: "LEXINOA_CONTEXT_UPDATE", ctx, reason },
        () => {
          // 응답 필요 없음
        }
      );
    } catch (e) {
      // content script 환경에서 런타임 문제가 나도 전체 기능을 죽이지 않음
      // console.warn("[Lexinoa][content] sendContext failed", e);
    }
  }

  // 최초 1회
  if (document.readyState === "complete" || document.readyState === "interactive") {
    sendContext("init");
  } else {
    window.addEventListener("DOMContentLoaded", () => sendContext("DOMContentLoaded"));
  }

  // SPA 네비게이션 대응: history API hook + popstate/hashchange
  const _pushState = history.pushState;
  history.pushState = function () {
    const ret = _pushState.apply(this, arguments);
    setTimeout(() => sendContext("pushState"), 0);
    return ret;
  };

  const _replaceState = history.replaceState;
  history.replaceState = function () {
    const ret = _replaceState.apply(this, arguments);
    setTimeout(() => sendContext("replaceState"), 0);
    return ret;
  };

  window.addEventListener("popstate", () => sendContext("popstate"));
  window.addEventListener("hashchange", () => sendContext("hashchange"));

  // DOM 변화가 큰 앱(Gmail/Slack 등)에서 URL이 안 바뀌더라도 화면 상태가 바뀌는 경우가 있어
  // document 변화를 약하게 감지해서 재시도
  const mo = new MutationObserver(() => sendContext("mutation"));
  mo.observe(document.documentElement, { childList: true, subtree: true });

    // ===== popup/background가 현재 컨텍스트를 요청하면 즉시 응답 =====
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;

    if (msg.type === "LEXINOA_GET_CONTEXT") {
      try {
        const ctx = detectContext();
        sendResponse({ ok: true, ctx });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true; // async 가능
    }
  });
})();

