/* ------------------------------------------------------------------
   app.js — grabación por voz, guardado y avisos.
-------------------------------------------------------------------*/
(() => {
"use strict";

const $ = id => document.getElementById(id);
const DAY = 86400000;

/* ===================== ESTADO ===================== */
const LS_ITEMS = "recorda.items";
const LS_CFG   = "recorda.cfg";

const DEFAULT_CFG = {
  advance:   [7, 3, 1, 0],
  hour:      "09:00",
  lang:      "es-AR",
  keepAudio: false   // apagado: compite con el dictado por el micrófono
};

let items = load(LS_ITEMS, []);
let cfg   = Object.assign({}, DEFAULT_CFG, load(LS_CFG, {}));
let editingId = null;
let pendingAudio = null;          // Blob de la grabación en curso

function load(key, fallback){
  try{
    const v = JSON.parse(localStorage.getItem(key));
    return v === null || v === undefined ? fallback : v;
  }catch{ return fallback; }
}
const saveItems = () => localStorage.setItem(LS_ITEMS, JSON.stringify(items));
const saveCfg   = () => localStorage.setItem(LS_CFG,   JSON.stringify(cfg));

/* ===================== FECHAS ===================== */
const pad = n => String(n).padStart(2, "0");
const toKey = d => d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate());

function fromKey(k){
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function todayMidnight(){
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
function daysUntil(key){
  return Math.round((fromKey(key) - todayMidnight()) / DAY);
}

const FMT = new Intl.DateTimeFormat("es-AR", {
  weekday:"long", day:"numeric", month:"long", year:"numeric"
});

function prettyDate(item){
  let s = FMT.format(fromKey(item.date));
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return item.time ? s + " · " + item.time + " hs" : s;
}

function countdownLabel(n){
  if(n < 0)  return { n: Math.abs(n), l: n === -1 ? "día atrás" : "días atrás" };
  if(n === 0) return { n: "¡Hoy!", l: "" };
  if(n === 1) return { n: 1, l: "día" };
  return { n, l: "días" };
}

/* ===================== TOAST ===================== */
let toastT = null;
function toast(msg, isErr){
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast" + (isErr ? " err" : "");
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.add("hidden"), 3400);
}

/* ===================== GRABACIÓN ===================== */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null, recorder = null, stream = null;
let recording = false, finalText = "", chunks = [];
let lastError = null, gotAnyResult = false;

const ERRORES = {
  "no-speech":           "No se escuchó tu voz. Acercate al micrófono y hablá fuerte.",
  "audio-capture":       "No se pudo usar el micrófono. ¿Lo está usando otra app?",
  "not-allowed":         "El navegador bloqueó el micrófono. Habilitalo en los permisos del sitio.",
  "service-not-allowed": "El navegador bloqueó el dictado. Habilitá el micrófono en los permisos del sitio.",
  "network":             "El dictado necesita internet y no se pudo conectar.",
  "aborted":             "Se interrumpió el dictado.",
  "language-not-supported": "Ese idioma no está disponible. Probá cambiarlo en Ajustes."
};

function setRecUI(on){
  $("recBtn").classList.toggle("rec", on);
  $("recHint").classList.toggle("live", on);
  $("recHint").textContent = on
    ? "Escuchando… tocá de nuevo para terminar"
    : "Tocá el micrófono y dictá tu examen";
}

async function startRecording(){
  if(!window.isSecureContext){
    toast("Abrí la app por https para poder usar el micrófono.", true);
    return;
  }
  if(!SR){
    toast("Tu navegador no reconoce voz. Escribilo a mano.", true);
    openPreview(Parser.parse(""));
    return;
  }

  finalText = "";
  chunks = [];
  pendingAudio = null;
  lastError = null;
  gotAnyResult = false;
  $("transcript").textContent = "";
  $("transcriptBox").classList.remove("hidden");
  $("preview").classList.add("hidden");

  /* Pedimos el micrófono ANTES de arrancar el dictado. Así el cartel de
     permiso se resuelve primero (si no, el dictado arranca mientras el
     usuario todavía no aceptó y se pierde el principio de la frase). */
  let permisoOk = true;
  if(navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
    try{
      const s = await navigator.mediaDevices.getUserMedia({ audio:true });
      if(cfg.keepAudio && window.MediaRecorder){
        /* Guardar el audio y dictar al mismo tiempo pelean por el micrófono:
           en muchos celulares el grabador se lo queda en exclusiva y el
           dictado no escucha nada. Por eso viene apagado por defecto. */
        stream = s;
        recorder = new MediaRecorder(s);
        recorder.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
        recorder.onstop = () => {
          if(chunks.length) pendingAudio = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          if(stream) stream.getTracks().forEach(t => t.stop());
          stream = null;
        };
        recorder.start();
      }else{
        s.getTracks().forEach(t => t.stop());   // liberamos el micrófono para el dictado
      }
    }catch(err){
      permisoOk = false;
      lastError = err && err.name ? err.name : "getUserMedia";
    }
  }

  if(!permisoOk){
    setRecUI(false);
    $("transcriptBox").classList.add("hidden");
    toast("No hay permiso para el micrófono. Tocá el 🔒 de la barra y habilitalo.", true);
    return;
  }

  recog = new SR();
  recog.lang = cfg.lang;
  recog.continuous = true;
  recog.interimResults = true;

  recog.onresult = e => {
    gotAnyResult = true;
    lastError = null;
    let interim = "";
    for(let i = e.resultIndex; i < e.results.length; i++){
      const txt = e.results[i][0].transcript;
      if(e.results[i].isFinal) finalText += txt + " ";
      else interim += txt;
    }
    $("transcript").textContent = (finalText + interim).trim();
  };

  recog.onerror = e => {
    lastError = e.error;
    if(e.error === "no-speech") return;             // silencio: onend lo reanuda
    if(e.error === "not-allowed" || e.error === "service-not-allowed" ||
       e.error === "audio-capture" || e.error === "network"){
      toast(ERRORES[e.error] || ("Error de dictado: " + e.error), true);
      stopRecording();
    }
  };

  // Chrome corta tras unos segundos de silencio: lo reanudamos
  recog.onend = () => {
    if(recording){
      try{ recog.start(); }catch{ /* ya estaba arrancando */ }
    }
  };

  try{
    recog.start();
    recording = true;
    setRecUI(true);
  }catch(err){
    lastError = "start:" + (err && err.name);
    toast("No se pudo iniciar el dictado.", true);
    setRecUI(false);
  }
}

function stopRecording(){
  if(!recording && !recog) return;
  recording = false;
  setRecUI(false);
  if(recog){ try{ recog.stop(); }catch{} recog = null; }
  if(recorder && recorder.state !== "inactive"){ try{ recorder.stop(); }catch{} }

  // damos margen a que llegue el último resultado y cierre el grabador
  setTimeout(() => {
    const text = ($("transcript").textContent || finalText).trim();

    if(text){
      openPreview(Parser.parse(text));
      return;
    }

    // sin texto: explicamos el motivo y abrimos igual el formulario
    const motivo = lastError && ERRORES[lastError]
      ? ERRORES[lastError]
      : gotAnyResult
        ? "No se entendió lo que dijiste."
        : "No se escuchó nada.";

    toast(motivo + " Cargalo a mano y probamos de nuevo.", true);
    $("transcriptBox").classList.add("hidden");
    openPreview(Parser.parse(""));
    $("fSubject").focus();
  }, 800);
}

/* ===================== PREVIEW ===================== */
function openPreview(p){
  editingId = null;
  $("fSubject").value = p.subject === "Recordatorio" ? "" : (p.subject || "");
  $("fDate").value    = p.date ? toKey(p.date) : "";
  $("fTime").value    = p.time ? pad(p.time.h) + ":" + pad(p.time.min) : "";
  $("fTopics").value  = (p.topics || []).join(", ");
  $("fAdvance").value = (p.advance && p.advance.length ? p.advance : cfg.advance).join(", ");

  if(pendingAudio){
    $("audioEl").src = URL.createObjectURL(pendingAudio);
    $("audioPreview").classList.remove("hidden");
  }else{
    $("audioPreview").classList.add("hidden");
  }

  $("preview").classList.remove("hidden");
  if(!p.date && p.raw.trim()) toast("No entendí la fecha — completala abajo.");
  $("preview").scrollIntoView({ behavior:"smooth", block:"nearest" });
}

function closePreview(){
  $("preview").classList.add("hidden");
  $("transcriptBox").classList.add("hidden");
  pendingAudio = null;
  editingId = null;
}

function parseAdvanceField(v){
  const arr = String(v).split(/[,\s]+/)
    .map(s => parseInt(s, 10))
    .filter(n => Number.isFinite(n) && n >= 0 && n <= 365);
  return [...new Set(arr)].sort((a,b) => b - a);
}

async function saveFromForm(){
  const subject = $("fSubject").value.trim();
  const date    = $("fDate").value;

  if(!subject){ toast("Ponele un nombre al examen.", true); $("fSubject").focus(); return; }
  if(!date){    toast("Falta la fecha.", true); $("fDate").focus(); return; }

  const advance = parseAdvanceField($("fAdvance").value);
  const topics  = $("fTopics").value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);

  if(editingId){
    const it = items.find(i => i.id === editingId);
    if(it){
      const dateChanged = it.date !== date;
      Object.assign(it, { subject, date, time: $("fTime").value || null, topics, advance });
      if(dateChanged) it.fired = {};        // fecha nueva -> avisos de cero
    }
    toast("Actualizado");
  }else{
    const id = "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const item = {
      id, subject, date,
      time: $("fTime").value || null,
      topics,
      advance: advance.length ? advance : cfg.advance.slice(),
      raw: ($("transcript").textContent || "").trim(),
      hasAudio: false,
      fired: {},
      createdAt: Date.now()
    };
    if(pendingAudio){
      try{ await AudioDB.put(id, pendingAudio); item.hasAudio = true; }
      catch{ /* sin audio guardado, no es crítico */ }
    }
    items.push(item);
    toast("Guardado ✓");
  }

  saveItems();
  closePreview();
  render();
  checkReminders();
}

/* ===================== RENDER ===================== */
function render(){
  const list = $("list"), past = $("pastList");
  list.innerHTML = "";
  past.innerHTML = "";

  const sorted = items.slice().sort((a,b) => a.date.localeCompare(b.date));
  const upcoming = sorted.filter(i => daysUntil(i.date) >= 0);
  const old      = sorted.filter(i => daysUntil(i.date) <  0).reverse();

  upcoming.forEach(i => list.appendChild(card(i)));
  old.forEach(i => past.appendChild(card(i, true)));

  $("count").textContent = upcoming.length;
  $("empty").classList.toggle("hidden", upcoming.length > 0);
  $("pastCount").textContent = old.length;
  $("pastWrap").classList.toggle("hidden", old.length === 0);
}

function card(item, isPast){
  const n = daysUntil(item.date);
  const cd = countdownLabel(n);

  const el = document.createElement("div");
  el.className = "item" + (isPast ? " done" : n <= 2 ? " urgent" : n <= 7 ? " soon" : "");

  const topics = item.topics.length
    ? '<div class="topics">' + item.topics.map(t => '<span class="topic"></span>').join("") + "</div>"
    : "";

  el.innerHTML =
    '<div class="cd"><span class="cd-n"></span><span class="cd-l"></span></div>' +
    '<div class="item-body">' +
      '<p class="item-title"></p>' +
      '<p class="item-date"></p>' +
      topics +
      '<p class="alerts"></p>' +
      '<div class="item-audio hidden"></div>' +
    '</div>' +
    '<div class="item-actions">' +
      (isPast ? "" : '<button class="icon-btn" data-act="gcal" title="Agendar en Google Calendar">📅</button>') +
      '<button class="icon-btn" data-act="edit" title="Editar">✏️</button>' +
      '<button class="icon-btn" data-act="del" title="Borrar">🗑️</button>' +
    "</div>";

  // texto por nodo (nada de innerHTML con datos del usuario)
  el.querySelector(".cd-n").textContent = cd.n;
  el.querySelector(".cd-l").textContent = cd.l;
  el.querySelector(".item-title").textContent = item.subject;
  el.querySelector(".item-date").textContent = prettyDate(item);
  el.querySelectorAll(".topic").forEach((sp, k) => { sp.textContent = item.topics[k]; });

  const al = el.querySelector(".alerts");
  if(!isPast && item.advance.length){
    al.textContent = "🔔 Aviso: " + item.advance
      .map(d => d === 0 ? "el mismo día" : d + (d === 1 ? " día antes" : " días antes"))
      .join(" · ");
  }else{
    al.remove();
  }

  if(item.hasAudio){
    const box = el.querySelector(".item-audio");
    box.classList.remove("hidden");
    const btn = document.createElement("button");
    btn.className = "link-btn";
    btn.textContent = "▶ escuchar la grabación";
    btn.onclick = async () => {
      try{
        const blob = await AudioDB.get(item.id);
        if(!blob) return toast("El audio ya no está disponible.", true);
        const a = document.createElement("audio");
        a.controls = true;
        a.src = URL.createObjectURL(blob);
        box.innerHTML = "";
        box.appendChild(a);
        a.play();
      }catch{ toast("No se pudo abrir el audio.", true); }
    };
    box.appendChild(btn);
  }

  const gcal = el.querySelector('[data-act="gcal"]');
  if(gcal) gcal.onclick = () => openInGoogleCalendar(item);

  el.querySelector('[data-act="edit"]').onclick = () => startEdit(item);
  el.querySelector('[data-act="del"]').onclick  = () => removeItem(item);
  return el;
}

function startEdit(item){
  $("fSubject").value = item.subject;
  $("fDate").value    = item.date;
  $("fTime").value    = item.time || "";
  $("fTopics").value  = item.topics.join(", ");
  $("fAdvance").value = item.advance.join(", ");
  $("audioPreview").classList.add("hidden");
  pendingAudio = null;
  editingId = item.id;
  $("preview").classList.remove("hidden");
  $("preview").scrollIntoView({ behavior:"smooth", block:"center" });
}

function removeItem(item){
  if(!confirm("¿Borrar «" + item.subject + "»?")) return;
  items = items.filter(i => i.id !== item.id);
  saveItems();
  if(item.hasAudio) AudioDB.del(item.id).catch(() => {});
  render();
  toast("Borrado");
}

/* ===================== AVISOS ===================== */
function notify(title, body){
  const opts = {
    body,
    tag: title,
    icon: "data:image/svg+xml," + encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📚</text></svg>"),
    requireInteraction: true
  };
  if(navigator.serviceWorker && navigator.serviceWorker.ready){
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(title, opts))
      .catch(() => { try{ new Notification(title, opts); }catch{} });
  }else{
    try{ new Notification(title, opts); }catch{}
  }
}

/* Devuelve el hito de aviso que corresponde disparar ahora, o null.
   `left` = días que faltan. Se elige el hito más grande que ya venció y
   todavía no se avisó, así un aviso perdido (app cerrada ese día) se
   recupera la próxima vez que se abra en lugar de saltearse. */
function dueMilestone(item, left){
  if(left < 0) return null;
  const fired = item.fired || {};
  const cand = (item.advance || [])
    .filter(m => left <= m && !fired[m])
    .sort((a, b) => b - a);
  return cand.length ? cand[0] : null;
}

function checkReminders(){
  if(!("Notification" in window) || Notification.permission !== "granted") return;

  const now = new Date();
  const [hh, mm] = (cfg.hour || "09:00").split(":").map(Number);
  const afterHour = now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm);

  let changed = false;

  items.forEach(item => {
    const left = daysUntil(item.date);
    if(dueMilestone(item, left) === null) return;
    if(left > 0 && !afterHour) return;          // esperamos a la hora configurada

    const cuando = left === 0 ? "es HOY" : left === 1 ? "es MAÑANA" : "es en " + left + " días";
    let body = "Tu " + item.subject.toLowerCase() + " " + cuando + ".";
    if(item.topics.length) body += "\nTemas: " + item.topics.join(", ");

    notify("📚 " + item.subject, body);

    // marcamos este hito y todos los mayores, para no repetir el mismo aviso
    item.fired = item.fired || {};
    item.advance.forEach(m => { if(m >= left) item.fired[m] = true; });
    changed = true;
  });

  if(changed) saveItems();
}

/* ================= GOOGLE CALENDAR ================= */
const ymd = d => toKey(d).replace(/-/g, "");

function avisosTexto(item){
  return item.advance
    .map(d => d === 0 ? "el mismo día" : d === 1 ? "1 día antes" : d + " días antes")
    .join(", ");
}

/* Link "TEMPLATE" de Google Calendar: abre el evento ya cargado.
   Ojo: este formato NO permite mandar recordatorios propios — el evento
   queda con el aviso por defecto de tu calendario. Los días exactos van
   escritos en la descripción, y el .ics sí los lleva como alarmas. */
function gcalUrl(item){
  const d = fromKey(item.date);
  let dates;

  if(item.time){
    const [h, m] = item.time.split(":").map(Number);
    const start = new Date(d); start.setHours(h, m, 0, 0);
    const end   = new Date(start); end.setHours(end.getHours() + 1);
    const f = x => ymd(x) + "T" + pad(x.getHours()) + pad(x.getMinutes()) + "00";
    dates = f(start) + "/" + f(end);
  }else{
    const next = new Date(d); next.setDate(next.getDate() + 1);
    dates = ymd(d) + "/" + ymd(next);
  }

  const det = [];
  if(item.topics.length)  det.push("Temas: " + item.topics.join(", "));
  if(item.advance.length) det.push("Avisos que pediste: " + avisosTexto(item));
  det.push("Cargado desde Recordá 🎙️");

  const p = new URLSearchParams({
    action:  "TEMPLATE",
    text:    item.subject,
    dates:   dates,
    details: det.join("\n"),
    ctz:     Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Argentina/Buenos_Aires"
  });
  return "https://calendar.google.com/calendar/render?" + p.toString();
}

function openInGoogleCalendar(item){
  window.open(gcalUrl(item), "_blank", "noopener");
  toast("Revisá el aviso en Google Calendar: usa el que tengas por defecto.");
}

/* ===================== EXPORTAR .ICS ===================== */
function icsEscape(s){
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;")
                  .replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function fold(line){
  if(line.length <= 74) return line;
  const out = [];
  let rest = line;
  while(rest.length > 74){
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

function buildICS(){
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Recorda//ES", "CALSCALE:GREGORIAN"];

  items.filter(i => daysUntil(i.date) >= 0).forEach(item => {
    const d = fromKey(item.date);
    L.push("BEGIN:VEVENT", "UID:" + item.id + "@recorda", "DTSTAMP:" + stamp);

    if(item.time){
      const [h, m] = item.time.split(":").map(Number);
      const end = new Date(d); end.setHours(h + 1, m);
      L.push("DTSTART:" + ymd(d)   + "T" + pad(h) + pad(m) + "00");
      L.push("DTEND:"   + ymd(end) + "T" + pad(end.getHours()) + pad(end.getMinutes()) + "00");
    }else{
      const next = new Date(d); next.setDate(next.getDate() + 1);
      L.push("DTSTART;VALUE=DATE:" + ymd(d));
      L.push("DTEND;VALUE=DATE:"   + ymd(next));
    }

    L.push("SUMMARY:" + icsEscape(item.subject));
    if(item.topics.length) L.push("DESCRIPTION:" + icsEscape("Temas: " + item.topics.join(", ")));

    item.advance.forEach(dd => {
      L.push("BEGIN:VALARM", "ACTION:DISPLAY",
             "TRIGGER:" + (dd === 0 ? "PT0S" : "-P" + dd + "D"),
             "DESCRIPTION:" + icsEscape(item.subject +
               (dd === 0 ? " es hoy" : dd === 1 ? " es mañana" : " en " + dd + " días")),
             "END:VALARM");
    });

    L.push("END:VEVENT");
  });

  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n");
}

function exportICS(){
  if(!items.some(i => daysUntil(i.date) >= 0)) return toast("No hay exámenes próximos para exportar.", true);
  const blob = new Blob([buildICS()], { type:"text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "examenes.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Archivo listo — importalo en tu calendario");
}

/* ===================== PERMISOS ===================== */
function refreshPermBanner(){
  const banner = $("permBanner");
  if(!("Notification" in window) || sessionStorage.getItem("permOff")){
    banner.classList.add("hidden");
    return;
  }
  const p = Notification.permission;
  if(p === "granted"){ banner.classList.add("hidden"); return; }

  if(p === "denied"){
    banner.querySelector("span").textContent =
      "Bloqueaste las notificaciones. Habilitalas desde el candado 🔒 de la barra de direcciones, o exportá al calendario.";
    $("permBtn").classList.add("hidden");
  }else{
    banner.querySelector("span").textContent =
      "Activá las notificaciones para que te avise cerca de la fecha.";
    $("permBtn").classList.remove("hidden");
  }
  banner.classList.remove("hidden");
}

async function askPermission(){
  if(!("Notification" in window)) return toast("Tu navegador no soporta notificaciones.", true);
  const r = await Notification.requestPermission();
  refreshPermBanner();
  if(r === "granted"){ toast("Listo, te voy a avisar 🔔"); checkReminders(); }
  else toast("Sin permiso no puedo avisarte.", true);
}

/* ===================== AJUSTES ===================== */
function openSettings(){
  $("sAdvance").value   = cfg.advance.join(", ");
  $("sHour").value      = cfg.hour;
  $("sLang").value      = cfg.lang;
  $("sKeepAudio").checked = cfg.keepAudio;
  $("settingsModal").classList.remove("hidden");
}
function applySettings(){
  const adv = parseAdvanceField($("sAdvance").value);
  cfg.advance   = adv.length ? adv : DEFAULT_CFG.advance.slice();
  cfg.hour      = $("sHour").value || "09:00";
  cfg.lang      = $("sLang").value;
  cfg.keepAudio = $("sKeepAudio").checked;
  saveCfg();
}

/* ===================== EVENTOS ===================== */
$("recBtn").onclick = () => recording ? stopRecording() : startRecording();
$("manualBtn").onclick = () => { pendingAudio = null; openPreview(Parser.parse("")); $("fSubject").focus(); };
$("saveBtn").onclick   = saveFromForm;
$("cancelBtn").onclick = closePreview;

$("permBtn").onclick = askPermission;
$("permDismiss").onclick = () => { sessionStorage.setItem("permOff", "1"); refreshPermBanner(); };

$("icsBtn").onclick  = exportICS;
$("icsBtn2").onclick = () => { $("settingsModal").classList.add("hidden"); exportICS(); };

$("settingsBtn").onclick = openSettings;
$("settingsClose").onclick = () => { applySettings(); $("settingsModal").classList.add("hidden"); toast("Ajustes guardados"); };
$("settingsModal").onclick = e => {
  if(e.target === $("settingsModal")){ applySettings(); $("settingsModal").classList.add("hidden"); }
};

$("testNotifBtn").onclick = async () => {
  if(Notification.permission !== "granted") await askPermission();
  if(Notification.permission === "granted") notify("📚 Prueba", "Así te voy a avisar cuando se acerque la fecha.");
};

/* Junta todo lo que hace falta para entender por qué no anda el dictado.
   El resultado se copia al portapapeles para poder pasarlo por mensaje. */
$("diagBtn").onclick = async () => {
  const out = $("diagOut");
  out.classList.remove("hidden");
  out.textContent = "Probando…";

  const L = [];
  const add = (k, v) => L.push(k + ": " + v);

  add("navegador", navigator.userAgent);
  add("https", window.isSecureContext ? "sí" : "NO (el micrófono no va a andar)");
  add("instalada", matchMedia("(display-mode: standalone)").matches ? "sí" : "no, abierta en el navegador");
  add("reconoce voz", SR ? "sí" : "NO");
  add("idioma", cfg.lang);
  add("guardar audio", cfg.keepAudio ? "SÍ (puede tapar el dictado)" : "no");
  add("notificaciones", ("Notification" in window) ? Notification.permission : "no soportadas");
  add("último error", lastError || "ninguno");

  try{
    const p = await navigator.permissions.query({ name:"microphone" });
    add("permiso micrófono", p.state);
  }catch{ add("permiso micrófono", "no se pudo consultar"); }

  try{
    const s = await navigator.mediaDevices.getUserMedia({ audio:true });
    const t = s.getAudioTracks()[0];
    add("micrófono", "OK — " + (t ? t.label || "sin nombre" : "sin pista"));

    // medimos el nivel de entrada 1,5 s para ver si realmente entra sonido
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const an = ctx.createAnalyser();
    ctx.createMediaStreamSource(s).connect(an);
    const buf = new Uint8Array(an.fftSize);
    let pico = 0;
    out.textContent = L.join("\n") + "\n\n🔴 Hablá ahora, 2 segundos…";
    await new Promise(res => {
      const t0 = Date.now();
      (function loop(){
        an.getByteTimeDomainData(buf);
        for(const v of buf) pico = Math.max(pico, Math.abs(v - 128));
        if(Date.now() - t0 < 2000) requestAnimationFrame(loop); else res();
      })();
    });
    ctx.close();
    s.getTracks().forEach(x => x.stop());
    add("nivel de entrada", pico + "/128 " + (pico > 6 ? "→ entra sonido ✓" : "→ NO entra sonido ✗"));
  }catch(err){
    add("micrófono", "FALLA — " + (err && err.name));
  }

  const txt = L.join("\n");
  out.textContent = txt;
  try{ await navigator.clipboard.writeText(txt); toast("Diagnóstico copiado"); }
  catch{ toast("Sacale una captura a esto"); }
};

$("wipeBtn").onclick = () => {
  if(!confirm("Esto borra todos los exámenes y audios guardados. ¿Seguro?")) return;
  items = [];
  saveItems();
  AudioDB.clear().catch(() => {});
  render();
  $("settingsModal").classList.add("hidden");
  toast("Todo borrado");
};

document.addEventListener("keydown", e => {
  if(e.key === "Escape"){ $("settingsModal").classList.add("hidden"); }
});

/* ===================== INSTALAR ===================== */
let installEvent = null;

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  installEvent = e;
  $("installBtn").classList.remove("hidden");
});

$("installBtn").onclick = async () => {
  if(!installEvent) return;
  installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  $("installBtn").classList.add("hidden");
  if(outcome === "accepted") toast("Instalada 🎉 buscala entre tus apps");
};

window.addEventListener("appinstalled", () => {
  installEvent = null;
  $("installBtn").classList.add("hidden");
});

/* ===================== ARRANQUE ===================== */
if("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// atajo del manifest: abrir grabando
if(new URLSearchParams(location.search).get("grabar")){
  setTimeout(() => { if(!recording) startRecording(); }, 400);
}
if(!SR){
  $("recHint").textContent = "Tu navegador no reconoce voz — usá Chrome o Edge";
}

render();
refreshPermBanner();
checkReminders();

// expuesto sólo para depurar desde la consola
window.Recorda = {
  get items(){ return items; },
  get cfg(){ return cfg; },
  buildICS, checkReminders, render, daysUntil, dueMilestone
};

setInterval(checkReminders, 60000);                       // mientras la pestaña esté abierta
setInterval(render, 60 * 60000);                          // refresca la cuenta regresiva
document.addEventListener("visibilitychange", () => {
  if(!document.hidden){ render(); checkReminders(); }
});

})();
