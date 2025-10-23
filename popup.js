// 저장된 API 엔드포인트 로드(기본은 운영)
const DEFAULT_ENDPOINT = "https://say-production.up.railway.app/api/polish";

function escapeHtml(s=""){return s.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
const $ = (id)=>document.getElementById(id);

async function getEndpoint(){
  const { API_ENDPOINT } = await chrome.storage.sync.get({ API_ENDPOINT: DEFAULT_ENDPOINT });
  return API_ENDPOINT;
}
function payloadFromUI(){
  return {
    input_text: $("input_text").value || "",
    selected_categories: [ $("category").value ],
    selected_tones: [ $("tone").value ],
    honorific_checked: !!$("honorific").checked,
    opener_checked: !!$("opener").checked,
    emoji_checked: !!$("emoji").checked
  };
}

function isForbiddenUrl(url=""){
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

async function init(){
  // 테마 토글 (간단)
  const savedTheme = localStorage.getItem("theme") || "dark";
  if (savedTheme === "light") document.body.classList.add("light");
  $("themeToggle")?.addEventListener("click", ()=>{
    document.body.classList.toggle("light");
    localStorage.setItem("theme", document.body.classList.contains("light") ? "light" : "dark");
  });

  // 엔드포인트 input 초기값
  $("api").value = await getEndpoint();

  $("save").addEventListener("click", async ()=>{
    const url = $("api").value.trim();
    await chrome.storage.sync.set({ API_ENDPOINT: url || DEFAULT_ENDPOINT });
    $("status").textContent = "저장 완료";
  });

  $("test").addEventListener("click", async ()=>{
    const API_ENDPOINT = await getEndpoint();
    $("status").textContent = "테스트 중…";
    $("output").textContent = "";
    try{
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          input_text: "연결 테스트 문장입니다.",
          selected_categories: ["general"],
          selected_tones: ["soft"],
          honorific_checked: true,
          opener_checked: false,
          emoji_checked: false
        })
      });
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      $("status").textContent = "OK";
      $("output").textContent = data.output_text || "(결과 없음)";
    }catch(e){
      $("status").textContent = "실패: " + e.message;
    }
  });

  $("run").addEventListener("click", async ()=>{
    if (!$("consent").checked){
      alert("전송 동의가 필요합니다."); return;
    }
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id){ alert("활성 탭을 찾을 수 없어요."); return; }
    if (isForbiddenUrl(tab.url)){ alert("chrome://, 웹스토어 등에는 주입할 수 없어요. 일반 웹사이트에서 사용해 주세요."); return; }

    const API_ENDPOINT = await getEndpoint();

    try{
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["overlay.css"] });
    }catch(e){
      console.error("insertCSS 실패", e);
      alert("CSS 주입 실패. 다른 페이지에서 다시 시도해 주세요."); return;
    }
    try{
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content_injector.js"] });
    }catch(e){
      console.error("executeScript 실패", e);
      alert("스크립트 주입 실패. 권한/경로를 확인해 주세요."); return;
    }
    try{
      const body = payloadFromUI();
      // 페이지에 실행 요청
      await chrome.tabs.sendMessage(tab.id, { type: "POLISH_INPUT", payload: body, api: API_ENDPOINT });
    }catch(e){
      console.error("sendMessage 실패", e);
      alert("페이지와 연결 실패.");
    }
  });

  $("copy").addEventListener("click", async ()=>{
    const text = $("output").textContent.trim();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    alert("복사했어요!");
  });

  // 페이지 결과를 팝업에 반영 (선택)
  chrome.runtime.onMessage.addListener((msg)=>{
    if (msg?.type === "POLISH_RESULT"){
      $("output").textContent = msg.text || "(결과 없음)";
    }
  });
}

init();
