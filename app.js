(()=>{"use strict";
const $=id=>document.getElementById(id);
const screens=["splash","login","dashboard"];
const show=id=>screens.forEach(s=>$(s).classList.toggle("hidden",s!==id));
const KEY="sfcrash.rounds.v1";
let rounds=loadRounds();
function loadRounds(){try{const v=JSON.parse(localStorage.getItem(KEY)||"[]");return Array.isArray(v)?v:[]}catch{return[]}}
function saveRounds(){localStorage.setItem(KEY,JSON.stringify(rounds))}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function splash(){setTimeout(()=>show("login"),5000)}
$("login-button").addEventListener("click",()=>{
 const id=$("account-id").value.trim(),pass=$("app-password").value;
 if(!id){$("login-message").textContent="أدخل معرّف الحساب أولاً.";return}
 if(pass!=="sf.2027"){$("login-message").textContent="كلمة مرور التطبيق غير صحيحة.";return}
 $("login-message").textContent="";
 // This is only a local demo gate, not secure account authentication.
 sessionStorage.setItem("sfcrash.demo.signedin","1");
 show("dashboard");$("app-password").value="";
});
$("menu-button").addEventListener("click",()=>$("drawer").classList.remove("hidden"));
$("close-menu").addEventListener("click",()=>$("drawer").classList.add("hidden"));
$("drawer").addEventListener("click",e=>{const b=e.target.closest("[data-panel]");if(b)openPanel(b.dataset.panel)});
$("close-panel").addEventListener("click",()=>$("panel").classList.add("hidden"));
function openPanel(which){
 $("drawer").classList.add("hidden");$("panel").classList.remove("hidden");
 const title=$("panel-title"),body=$("panel-content");
 if(which==="sessions"){
  title.textContent="ربط الجلسة";
  body.innerHTML='<div class="session-lock">حماية حسابك أولاً: لا تلصق هنا ملفات تعريف الارتباط أو رموز الجلسة الحقيقية. لا يوجد حالياً خادم موثّق أو تكامل رسمي مع 1xBet لحفظها والتحقق منها.</div><p class="hint">هذه الشاشة جاهزة كواجهة فقط. عند توفير تكامل رسمي وآمن يمكن ربطها بخادم يحفظ الأسرار بعيداً عن المتصفح.</p><button class="secondary" id="session-info">فهم حالة الربط</button>';
  $("session-info").onclick=()=>alert("حالة الربط: غير مفعّل. لم يتم إرسال أو حفظ أي رمز.");
 }else if(which==="history"){
  title.textContent="الجولات المسجلة";
  body.innerHTML=roundStats()+roundForm()+roundList();
  $("save-round").onclick=addRound;
  $("clear-rounds").onclick=()=>{if(confirm("حذف سجل الجولات من هذا الجهاز؟")){rounds=[];saveRounds();openPanel("history")}};
 }else{
  title.textContent="مقارنة التنبؤات بالنتائج";
  body.innerHTML=roundStats()+comparisonList();
 }
}
function roundStats(){
 const count=rounds.length,matched=rounds.filter(r=>r.hit).length,rate=count?(matched/count*100).toFixed(1):"—";
 return '<div class="stat-grid"><div class="stat"><small>الجولات المسجلة</small><strong>'+count+'</strong></div><div class="stat"><small>تطابق التوقعات</small><strong>'+rate+(count?"%":"")+'</strong></div></div><p class="hint">النسبة محسوبة من الإدخالات التي سجلتها يدوياً فقط، وليست دليلاً على دقة مستقبلية.</p>';
}
function roundForm(){
 return '<h3>تسجيل جولة للمقارنة</h3><div class="field-row"><div><label for="predicted">التوقع (x)</label><input id="predicted" type="number" min="1" step="0.01" placeholder="مثال 1.80"></div><div><label for="actual">النتيجة الفعلية (x)</label><input id="actual" type="number" min="1" step="0.01" placeholder="مثال 2.10"></div></div><button class="primary" id="save-round">حفظ الجولة</button><p class="hint">يُعد التوقع مطابقاً إذا كان أقل من أو يساوي النتيجة الفعلية. هذا مقياس مبسط للمقارنة وليس توصية للمراهنة.</p>';
}
function addRound(){
 const p=Number($("predicted").value),a=Number($("actual").value);
 if(!Number.isFinite(p)||!Number.isFinite(a)||p<1||a<1){alert("أدخل قيمتين صحيحتين أكبر من أو تساوي 1.");return}
 rounds.unshift({id:Date.now(),predicted:p,actual:a,hit:p<=a,at:new Date().toISOString()});
 rounds=rounds.slice(0,500);saveRounds();openPanel("history");
}
function roundList(){
 if(!rounds.length)return '<div class="empty">لا توجد جولات مسجلة بعد. أضف أول جولة للمقارنة.</div>';
 return '<h3>آخر الجولات</h3><div class="round-list">'+rounds.slice(0,30).map(r=>'<div class="round-item"><span>توقع '+r.predicted.toFixed(2)+'x<br>نتيجة '+r.actual.toFixed(2)+'x</span><strong class="'+(r.hit?"good":"bad")+'">'+(r.hit?"مطابق":"غير مطابق")+'</strong></div>').join("")+'</div><button class="secondary" id="clear-rounds">مسح السجل</button>';
}
function comparisonList(){
 if(!rounds.length)return '<div class="empty">لا توجد بيانات للمقارنة. سجّل جولات من قسم «الجولات المسجلة» أولاً.</div>';
 return '<p>تُعرض هنا مقارنة كل توقع أدخلته مع النتيجة الفعلية التي سجلتها.</p>'+roundList();
}
function makeAsh(){const host=document.querySelector(".ash");if(!host)return;for(let i=0;i<34;i++){const d=document.createElement("i");d.style.left=(Math.random()*100)+"%";d.style.animationDuration=(7+Math.random()*13)+"s";d.style.animationDelay=(-Math.random()*18)+"s";d.style.opacity=String(.25+Math.random()*.65);host.appendChild(d)}}
show("splash");splash();makeAsh();
})();