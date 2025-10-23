(function(){
  const DEFAULT_API = "https://say-production.up.railway.app/api/polish";
  function escapeHtml(s=""){return s.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

  function ensureOverlay(){
    if (document.getElementById("nice-overlay")) return;
    const wrap = document.createElement("div");
    wrap.id = "nice-overlay";
    wrap.innerHTML = `
      <div class="nice-backdrop" data-close="1"></div>
      <div class="nice-modal" role="dialog" aria-modal="true" aria-label="착하게 말해요">
        <div class="nice-header">
          <div class="brand">
            <span class="brand-mark">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 5.5C4 4.12 5.34 3 7 3h10c1.66 0 3 1.12 3 2.5v7c0 1.38-1.34 2.5-3 2.5H11l-3.6 3.1c-.52.45-1.4.09-1.4-.55V15H7c-1.66 0-3-1.12-3-2.5v-7Z"></path>
              </svg>
            </span>
            <span class="brand-title">착하게 말해요</span>
          </div>
          <button class="nice-close" id="nice-close" aria-label="닫기">×</button>
        </div>
        <div class="nice-body">
          <div class="nice-block">
            <div class="cap">원문</div>
            <div id="nice-original-txt" class="nice-text"></div>
          </div>
          <div class="nice-block">
            <div class="cap">순화</div>
            <div id="nice-output-txt" class="nice-text">처리 중…</div>
          </div>
        </div>
        <div class="nice-actions">
          <button id="nice-copy" class="btn">복사</button>
          <button id="nice-close2" class="btn ghost">닫기</button>
        </div>
      </div>`;
    document.documentElement.appendChild(wrap);

    const close = ()=> wrap.remove();
    wrap.addEventListener("click",(e)=>{ if (e.target?.dataset?.close) close(); });
    document.getElementById("nice-close").onclick = close;
    document.getElementById("nice-close2").onclick = close;
    document.getElementById("nice-copy").onclick = async ()=>{
      const out = document.getElementById("nice-output-txt").textContent || "";
      try{
        await navigator.clipboard.writeText(out);
        document.getElementById("nice-copy").textContent = "복사됨";
      }catch{
        document.getElementById("nice-copy").textContent = "복사 실패";
      }
    };
  }

  async function callAPI(api, body){
    const res = await fetch(api || DEFAULT_API, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error("API error");
    return await res.json(); // { output_text }
  }

  async function polishByText(api, text, payloadFromPopup){
    ensureOverlay();
    const original = text || "";
    document.getElementById("nice-original-txt").innerHTML = escapeHtml(original);
    document.getElementById("nice-output-txt").textContent = "처리 중…";

    const body = payloadFromPopup || {
      input_text: original,
      selected_categories: ["general"],
      selected_tones: ["soft"],
      honorific_checked: true,
      opener_checked: false,
      emoji_checked: false
    };
    if (!body.input_text) body.input_text = original;

    try{
      const { output_text } = await callAPI(api, body);
      const out = output_text || "(결과 없음)";
      document.getElementById("nice-output-txt").textContent = out;
      // 팝업에 결과 전달(선택)
      chrome.runtime?.sendMessage?.({ type:"POLISH_RESULT", text: out });
    }catch(e){
      document.getElementById("nice-output-txt").textContent = "서버 요청 중 오류가 발생했어요.";
    }
  }

  // 메시지 진입점
  chrome.runtime.onMessage.addListener((msg)=>{
    if (msg?.type === "POLISH_SELECTION"){
      const sel = (msg.text || window.getSelection().toString() || "").trim();
      if (!sel){ alert("선택된 텍스트가 없습니다."); return; }
      polishByText(msg.api || DEFAULT_API, sel, null);
    }
    if (msg?.type === "POLISH_INPUT"){
      const t = (msg.payload?.input_text || "").trim();
      polishByText(msg.api || DEFAULT_API, t, msg.payload || null);
    }
  });
})();
