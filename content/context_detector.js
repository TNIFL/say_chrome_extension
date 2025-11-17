// content/context_detector.js

(function () {
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

    if (lcHost.includes("mail.google.com") || lcHost.endsWith("gmail.com")) {
      ctx = {
        source: "gmail",
        label: "Gmail 메일",
        suggestedCategory: "work",
        suggestedTone: "polite"
      };
    } else if (lcHost.includes("slack.com")) {
      ctx = {
        source: "slack",
        label: "Slack 채팅",
        suggestedCategory: "work",
        suggestedTone: "friendly"
      };
    } else if (lcHost.includes("mail.naver.com") || lcHost.includes("naver.com")) {
      ctx = {
        source: "naver_mail",
        label: "네이버 메일",
        suggestedCategory: "work",
        suggestedTone: "polite"
      };
    } else if (lcHost.includes("outlook.office.com") || lcHost.includes("outlook.live.com")) {
      ctx = {
        source: "outlook",
        label: "Outlook 메일",
        suggestedCategory: "work",
        suggestedTone: "polite"
      };
    } else if (lcHost.includes("teams.microsoft.com")) {
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

  // 페이지 로드 후 컨텍스트 저장
  function saveContext() {
    const ctx = detectContext();
    if (!chrome.storage || !chrome.storage.session) return;

    chrome.storage.session.set({ lexinoaContext: ctx }, () => {
      // 필요하면 나중에 debug용 log
      // console.log("Lexinoa context stored", ctx);
    });
  }

  // DOM 로드 이후 실행
  if (document.readyState === "complete" || document.readyState === "interactive") {
    saveContext();
  } else {
    window.addEventListener("DOMContentLoaded", saveContext);
  }
})();
