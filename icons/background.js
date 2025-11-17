// background.js (MV3 service worker)

// 설치 시 기본 baseUrl 설정 (없을 때만)
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["lexinoaBaseUrl"], (data) => {
    if (!data.lexinoaBaseUrl) {
      chrome.storage.sync.set({
        lexinoaBaseUrl: "https://www.lexinoa.com"
      });
    }
  });
});

// 혹시 나중에 메시지로 확장하고 싶을 때를 대비한 기본 핸들러
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "LEX_PING") {
    sendResponse({ ok: true });
    return true;
  }
});
