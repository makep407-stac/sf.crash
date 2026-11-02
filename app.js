(()=>{"use strict";
const $=id=>document.getElementById(id);let rounds=[];
function network(){const on=navigator.onLine;const el=$("network-status");el.classList.toggle("offline",!on);el.innerHTML='<i></i> '+(on?"ONLINE":"OFFLINE");$("connect-button").disabled=!on}
function verify(){const token=$("session-token").value.trim();const msg=$("session-result");if(!navigator.onLine){msg.textContent="OFFLINE";return}if(!token){msg.textContent="ENTER KEY";return}msg.textContent="SERVER NOT CONNECTED";$("session-token").value=""}
$("connect-button").addEventListener("click",verify);
$("session-token").addEventListener("keydown",e=>{if(e.key==="Enter")verify()});
$("menu-button").addEventListener("click",()=>$("drawer").classList.toggle("hidden"));
$("close-menu").addEventListener("click",()=>$("drawer").classList.add("hidden"));
$("close-panel").addEventListener("click",()=>$("panel").classList.add("hidden"));
$("drawer").addEventListener("click",e=>{const b=e.target.closest("[data-panel]");if(!b)return;$("drawer").classList.add("hidden");$("panel").classList.remove("hidden");if(b.dataset.panel==="session"){$("panel-title").textContent="رمز الجلسة";$("panel-content").innerHTML="<p>لا يوجد خادم تحقق مربوط حالياً.</p>"}else{$("panel-title").textContent="السجل";$("panel-content").innerHTML=rounds.length?'<div class="panel-list">'+rounds.map(x=>'<div class="panel-item"><span>'+x.time+'</span><strong>'+x.value+'</strong></div>').join("")+'</div>':'<p>—</p>'}});
function refresh(){network()}
window.addEventListener("online",refresh);window.addEventListener("offline",refresh);refresh();
})();