const API_ENDPOINT = "https://say-production.up.railway.app/api/polish";

async function polishSelectedText() {
  const sel = window.getSelection().toString().trim();
  if (!sel) return showOverlay("선택된 텍스트가 없습니다.");

  // 기본 프리셋(원하면 storage에서 사용자 선호 불러오기)
  const body = {
    input_text: sel,
    selected_categories: ["general"],
    selected_tones: ["soft"],
    honorific_checked: true,
    opener_checked: false,
    emoji_checked: false
  };

  try {
    const res = await fetch(API_ENDPOINT, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const data = await res.json();
    showOverlay(data.output_text || "(결과 없음)", sel);
  } catch (e) {
    showOverlay("서버 요청 중 오류가 발생했어요.");
  }
}

function showOverlay(text, original){
  // 이미 있으면 제거
  document.getElementById("nice-overlay")?.remove();

  const wrap = document.createElement("div");
  wrap.id = "nice-overlay";
  wrap.innerHTML = `
    <div class="nice-modal">
      <div class="nice-title">착하게 말해요</div>
      <div class="nice-original"><div class="cap">원문</div>${escapeHtml(original||"")}</div>
      <div class="nice-output"><div class="cap">순화</div>${escapeHtml(text||"")}</div>
      <div class="nice-actions">
        <button id="nice-copy">복사</button>
        <button id="nice-close">닫기</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  document.getElementById("nice-copy").onclick = async () => {
    await navigator.clipboard.writeText(text||"");
    document.getElementById("nice-copy").textContent = "복사됨";
  };
  document.getElementById("nice-close").onclick = () => wrap.remove();
}

function escapeHtml(s){ return (s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "REQUEST_POLISH") polishSelectedText();
});
