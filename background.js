// 설치 시 컨텍스트 메뉴 생성
chrome.runtime.onInstalled.addListener(()=>{
  chrome.contextMenus.create({
    id: "nice-say",
    title: "착하게 말해요: 선택 문장 순화",
    contexts: ["selection"]
  });
});

function forbidden(url=""){
  return (
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("about:") ||
    url.startsWith("devtools://") ||
    url.startsWith("view-source:") ||
    url.startsWith("https://chrome.google.com/webstore/") ||
    url.startsWith("https://chromewebstore.google.com/")
  );
}

chrome.contextMenus.onClicked.addListener(async (info, tab)=>{
  if (info.menuItemId !== "nice-say" || !tab?.id) return;
  const url = tab.url || "";
  if (forbidden(url)){
    // 조용히 무시하거나 알림을 띄우세요.
    return;
  }

  const { API_ENDPOINT } = await chrome.storage.sync.get({
    API_ENDPOINT: "https://say-production.up.railway.app/api/polish"
  });

  // 오버레이 주입
  await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["overlay.css"] });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content_injector.js"] });

  // 선택문장 전달
  chrome.tabs.sendMessage(tab.id, {
    type: "POLISH_SELECTION",
    text: info.selectionText || "",
    api: API_ENDPOINT
  });
});
