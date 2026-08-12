/* ------------------------------------------------------------------
   parser.js — interpreta una frase dictada en español y extrae
   materia, fecha, hora, temas y días de aviso.

   Uso:  Parser.parse("examen de historia el 15 de marzo, temas ...")
   Todo el trabajo se hace sobre el texto NORMALIZADO (sin tildes,
   en minúsculas), pero los temas se recortan del texto original
   para conservar el formato que dictó el usuario.
-------------------------------------------------------------------*/
const Parser = (() => {

  const MONTHS = {
    enero:0, febrero:1, marzo:2, abril:3, mayo:4, junio:5, julio:6,
    agosto:7, septiembre:8, setiembre:8, octubre:9, noviembre:10, diciembre:11
  };

  // 0 = domingo, igual que Date.getDay()
  const WEEKDAYS = {
    domingo:0, lunes:1, martes:2, miercoles:3, jueves:4, viernes:5, sabado:6
  };

  const NUMWORDS = {
    un:1, uno:1, una:1, primero:1, primer:1, dos:2, tres:3, cuatro:4, cinco:5,
    seis:6, siete:7, ocho:8, nueve:9, diez:10, once:11, doce:12, trece:13,
    catorce:14, quince:15, dieciseis:16, diecisiete:17, dieciocho:18,
    diecinueve:19, veinte:20, veintiuno:21, veintiuna:21, veintidos:22,
    veintitres:23, veinticuatro:24, veinticinco:25, veintiseis:26,
    veintisiete:27, veintiocho:28, veintinueve:29, treinta:30
  };

  // diacríticos combinantes salteando U+0303 (la virgulilla de la ñ)
  const DIACRITICS = new RegExp("[\\u0300-\\u0302\\u0304-\\u036f]", "g");

  /** minúsculas + sin tildes, conservando la ñ */
  function norm(s){
    return String(s == null ? "" : s)
      .toLowerCase()
      .normalize("NFD")
      .replace(DIACRITICS, "")
      .normalize("NFC")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** "15" o "quince" -> 15 ; si no reconoce devuelve null */
  function num(token){
    if(token == null) return null;
    const t = String(token).trim();
    if(/^\d+$/.test(t)) return parseInt(t, 10);
    const n = NUMWORDS[norm(t)];
    return n === undefined ? null : n;
  }

  const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  function addDays(d, n){
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  const NUMWORD_ALT  = Object.keys(NUMWORDS).join("|");
  const MONTH_ALT    = Object.keys(MONTHS).join("|");
  const WEEKDAY_ALT  = Object.keys(WEEKDAYS).join("|");

  /* ------------------------- FECHA ------------------------- */
  function parseDate(t, now){
    const today = midnight(now || new Date());
    const Y = today.getFullYear();
    let m;

    // "en 3 semanas" / "dentro de 10 dias" / "en un mes"
    m = t.match(new RegExp(
      "\\b(?:en|dentro de)\\s+(\\d+|" + NUMWORD_ALT + ")\\s+(dias?|semanas?|meses|mes)\\b"
    ));
    if(m){
      const n = num(m[1]);
      if(n !== null){
        if(/^dia/.test(m[2]))    return addDays(today, n);
        if(/^semana/.test(m[2])) return addDays(today, n * 7);
        const d = new Date(today);
        d.setMonth(d.getMonth() + n);
        return d;
      }
    }

    // "15 de marzo [de 2027]" | "quince de marzo" | "15 marzo"
    m = t.match(new RegExp(
      "\\b(\\d{1,2}|" + NUMWORD_ALT + ")\\s+(?:de\\s+)?(" + MONTH_ALT + ")\\b" +
      "(?:\\s+(?:del?\\s+)?(\\d{4}))?"
    ));
    if(m){
      const day = num(m[1]);
      const mon = MONTHS[m[2]];
      if(day !== null && day >= 1 && day <= 31){
        if(m[3]) return new Date(parseInt(m[3], 10), mon, day);
        let d = new Date(Y, mon, day);
        if(d < today) d = new Date(Y + 1, mon, day);   // ya pasó -> año que viene
        return d;
      }
    }

    // "20/3" | "20/03/2027" | "20-3"
    m = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    if(m){
      const day = +m[1], mon = +m[2] - 1;
      if(day >= 1 && day <= 31 && mon >= 0 && mon <= 11){
        if(m[3]){
          let y = +m[3];
          if(y < 100) y += 2000;
          return new Date(y, mon, day);
        }
        let d = new Date(Y, mon, day);
        if(d < today) d = new Date(Y + 1, mon, day);
        return d;
      }
    }

    // relativos. Ojo: "a las 10 de la mañana" NO es el día de mañana,
    // así que sacamos esa construcción antes de mirar.
    const tRel = t.replace(/\b(?:de|por|a)\s+la\s+ma(ñ|n)ana\b/g, " ");
    if(/\bpasado\s+ma(ñ|n)ana\b/.test(tRel)) return addDays(today, 2);
    if(/\bma(ñ|n)ana\b/.test(tRel))          return addDays(today, 1);
    if(/\bhoy\b/.test(tRel))                 return today;

    // "el proximo martes" | "este viernes" | "el lunes"
    // siempre la próxima aparición del día (es lo que la gente quiere decir)
    m = t.match(new RegExp(
      "\\b(?:el\\s+|este\\s+|la\\s+)?(?:proximo\\s+|siguiente\\s+)?(" + WEEKDAY_ALT + ")\\b"
    ));
    if(m){
      const target = WEEKDAYS[m[1]];
      let delta = (target - today.getDay() + 7) % 7;
      if(delta === 0) delta = 7;                 // "el martes" dicho un martes = el que viene
      return addDays(today, delta);
    }

    // "el 15" a secas -> ese dia de este mes (o del que viene si ya pasó)
    m = t.match(/\bel\s+(\d{1,2})\b(?![:.\/\-]\d)/);
    if(m){
      const day = +m[1];
      if(day >= 1 && day <= 31){
        let d = new Date(Y, today.getMonth(), day);
        if(d < today) d = new Date(Y, today.getMonth() + 1, day);
        return d;
      }
    }

    return null;
  }

  /* -------------------------- HORA -------------------------- */
  function parseTime(t){
    // "a las 14:30" | "a las 10 de la mañana" | "a las 8 pm"
    let m = t.match(/\ba\s+las?\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:hs?|horas?)?\s*(de la ma(?:ñ|n)ana|de la tarde|de la noche|am|pm)?/);
    if(!m) m = t.match(/\b(\d{1,2})[:.](\d{2})\s*(?:hs?)\b/);
    if(!m) return null;

    let h = +m[1];
    const min = m[2] ? +m[2] : 0;
    const suf = m[3] || "";

    if(/tarde|noche|pm/.test(suf) && h < 12) h += 12;
    if(/(ñ|n)ana|am/.test(suf) && h === 12)  h = 0;
    if(h > 23 || min > 59) return null;
    return { h, min };
  }

  /* ------------------------ MATERIA ------------------------ */
  const KIND = "examen|prueba|parcial|final|test|evaluacion|entrega|trabajo practico|coloquio|recuperatorio|oral";

  const STOP = "el|la|los|las|este|esta|proximo|siguiente|dia|a las|para|que|es|va|entra|entran|incluye|tema|temas|sobre|estudiar|en|dentro|hoy|ma(?:ñ|n)ana|pasado|lunes|martes|miercoles|jueves|viernes|sabado|domingo|avisame|recordame";

  /* `t` es el texto normalizado y `base` el original con los espacios
     ya colapsados: tienen la MISMA longitud, así que los índices de un
     match sobre `t` sirven para recortar `base` y conservar tildes y
     mayúsculas tal como las dictó el usuario. */
  function parseSubject(t, base){
    let kind = null, name = null;

    // "examen de Historia", "parcial de analisis matematico"
    let m = t.match(new RegExp(
      "\\b(" + KIND + ")\\s+(?:de\\s+|sobre\\s+)?([a-z0-9ñ ]+?)" +
      "(?=\\s+(?:" + STOP + ")\\b|\\s+\\d|\\s*[,.;]|$)"
    ));

    if(m){
      kind = m[1];
      // el nombre es el final del match: lo recortamos del texto original
      const start = m.index + m[0].length - m[2].length;
      name = base.slice(start, m.index + m[0].length);
    }else{
      m = t.match(new RegExp("\\b(" + KIND + ")\\b"));
      if(m) kind = m[1];
    }

    name = (name || "").trim().replace(/\s+(?:de|del|la|el|y|que|es|a)$/i, "").trim();

    if(!name) return kind ? cap(kind) : (firstWords(base) || "Recordatorio");
    return cap(kind ? kind + " de " + name : name);
  }

  function cap(s){ return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function firstWords(raw){
    const w = String(raw).trim().split(/\s+/).slice(0, 4).join(" ");
    return w ? cap(w) : "";
  }

  /* -------------------------- TEMAS ------------------------- */
  // dispara con: "temas ...", "los temas son ...", "entra ...", "incluye ...", "sobre ..."
  const TOPIC_TRIGGER = /\b(?:los\s+)?temas?\s*(?:son|es|:)?\s+|\b(?:va\s+a\s+)?entrar?[an]?\s+|\bincluye\s+|\bestudiar\s+|\bsobre\s+/;

  function parseTopics(t, base){
    const trig = t.match(TOPIC_TRIGGER);
    if(!trig) return [];

    let chunk = base.slice(trig.index + trig[0].length);

    // corta en el punto final o al empezar la frase de aviso
    chunk = chunk.split(/\.(?:\s|$)|\b(?:avisame|avisa me|recordame|recuerdame|av[ií]same|recu[eé]rdame|record[aá]me)\b/i)[0] || "";

    return chunk
      .split(/,|\sy\s|\se\s|;|\n/i)
      .map(s => s.replace(/^[\s.;:-]+|[\s.;:]+$/g, ""))
      .filter(s => s.length > 1 && s.length < 60)
      .slice(0, 12);
  }

  /* --------------------- DÍAS DE AVISO --------------------- */
  function parseAdvance(t){
    const out = [];
    const re = new RegExp(
      "(\\d+|" + NUMWORD_ALT + ")\\s+(dias?|semanas?)\\s+antes", "g"
    );
    let m;
    while((m = re.exec(t)) !== null){
      const n = num(m[1]);
      if(n !== null) out.push(/^semana/.test(m[2]) ? n * 7 : n);
    }
    if(/\bel\s+mismo\s+dia\b/.test(t)) out.push(0);

    return [...new Set(out)].filter(n => n >= 0 && n <= 365).sort((a,b) => b - a);
  }

  /* --------------------------- API -------------------------- */
  function parse(raw, now){
    const text = String(raw == null ? "" : raw);
    // base y t tienen la misma longitud -> los índices son intercambiables
    const base = text.replace(/\s+/g, " ").trim();
    const t    = norm(base);

    return {
      raw:     text,
      subject: parseSubject(t, base),
      date:    parseDate(t, now || new Date()),
      time:    parseTime(t),
      topics:  parseTopics(t, base),
      advance: parseAdvance(t)
    };
  }

  return { parse, norm, num, parseDate, parseTime, parseSubject, parseTopics, parseAdvance };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Parser;
