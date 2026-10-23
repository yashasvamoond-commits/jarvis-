/* ============================================================
   Legal Jarvis — bilingual layer
   Rule of the chamber: English is the working language.
   Hindi is used when a document, name or matter is written in Hindi.
   ============================================================ */
(function () {
  'use strict';
  const U = LJ.Utils;
  const S = LJ.Settings;

  const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const HI_MONTHS = ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितम्बर', 'अक्टूबर', 'नवम्बर', 'दिसम्बर'];
  const EN_DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const HI_DOW = ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];

  const DOC_TYPES = [
    { key: 'Petition', hi: 'याचिका' },
    { key: 'Plaint', hi: 'वादपत्र' },
    { key: 'Written Statement', hi: 'लिखित कथन' },
    { key: 'Reply', hi: 'जवाब' },
    { key: 'Rejoinder', hi: 'प्रतिकर' },
    { key: 'Application', hi: 'आवेदन' },
    { key: 'Affidavit', hi: 'शपथ पत्र' },
    { key: 'Evidence', hi: 'साक्ष्य' },
    { key: 'Order', hi: 'आदेश' },
    { key: 'Judgment', hi: 'निर्णय' },
    { key: 'Notice', hi: 'नोटिस' },
    { key: 'Vakalatnama', hi: 'वकालतनामा' },
    { key: 'Draft', hi: 'प्रारूप' },
    { key: 'Agreement', hi: 'अनुबंध' },
    { key: 'FIR', hi: 'प्राथमिकी' },
    { key: 'Other', hi: 'अन्य' }
  ];

  const TYPE_HI = {};
  DOC_TYPES.forEach(t => { TYPE_HI[t.key] = t.hi; });

  /* type recognition keywords, both scripts and romanised Hindi */
  const TYPE_RULES = [
    { type: 'Rejoinder', words: ['rejoinder', 'प्रतिकर', 'pratikar', 'replication reply', 'par rejoinder'] },
    { type: 'Written Statement', words: ['written statement', 'written-statement', 'ws ', 'लिखित कथन', 'likhit kathan', 'जवाबदावा', 'jawabdawa'] },
    { type: 'Reply', words: ['reply', 'counter affidavit', 'counter-affidavit', 'जवाब', 'jawab', 'उत्तर', 'uttar', 'response to'] },
    { type: 'Plaint', words: ['plaint', 'वादपत्र', 'vad patra', 'वाद पत्र', 'suit for', 'वाद'] },
    { type: 'Petition', words: ['petition', 'writ', 'याचिका', 'yachika', 'prarthana patra', 'प्रार्थना पत्र', 'misc. petition', 'misc petition'] },
    { type: 'Application', words: ['application', 'interim application', ' i.a.', 'ia no', 'आवेदन', 'aavedan', 'प्रार्थना पत्र', 'misc. application'] },
    { type: 'Affidavit', words: ['affidavit', 'शपथ पत्र', 'shapath patra', 'शपथपत्र'] },
    { type: 'Evidence', words: ['evidence', 'exhibit', 'deposition', 'साक्ष्य', 'sakshya', 'examination in chief', 'site plan', 'document list'] },
    { type: 'Order', words: ['order', 'आदेश', 'aadesh', 'order sheet', 'proceedings'] },
    { type: 'Judgment', words: ['judgment', 'judgement', 'decree', 'निर्णय', 'nirnay', 'फैसला', 'faisla', 'डिक्री'] },
    { type: 'Notice', words: ['notice', 'नोटिस', 'legal notice', 'सूचना', 'suchna', 'summons', 'समन'] },
    { type: 'Vakalatnama', words: ['vakalatnama', 'vakalat nama', 'power of attorney', 'वकालतनामा', 'vakalatnama', 'मुख्तारनामा'] },
    { type: 'Draft', words: ['draft', 'प्रारूप', 'prarup'] },
    { type: 'Agreement', words: ['agreement', 'deed', 'lease', 'अनुबंध', 'anubandh', 'विलेख', 'registry', 'बैनामा'] },
    { type: 'FIR', words: ['fir', 'first information', 'प्राथमिकी', 'prathamiki', 'police complaint'] }
  ];

  const COURT_RULES = [
    { match: ['high court', 'hcf', 'hc ', 'rajasthan high court', 'उच्च न्यायालय', 'ucc nyayalay', 's.b. civil', 's.b. criminal', 'd.b.'],
      court: 'Rajasthan High Court, Jaipur Bench', courtHi: 'राजस्थान उच्च न्यायालय, जयपुर पीठ', type: 'High Court' },
    { match: ['sessions', 'additional sessions', 'district & sessions', 'district and sessions', 'सत्र', 'जिला एवं सत्र', 'adsj', 'asj'],
      court: 'District & Sessions Court, Jaipur Metropolitan', courtHi: 'जिला एवं सत्र न्यायालय, जयपुर महानगर', type: 'District Court' },
    { match: ['civil judge', 'सिविल जज', 'junior division', 'jr. division', 'j.d.'],
      court: 'Civil Judge (Jr. Division), Jaipur Metropolitan', courtHi: 'सिविल जज (जूनियर डिवीजन), जयपुर महानगर', type: 'Civil Court' },
    { match: ['family court', 'परिवार न्यायालय'],
      court: 'Family Court, Jaipur', courtHi: 'परिवार न्यायालय, जयपुर', type: 'Family Court' },
    { match: ['tehsildar', 'तहसीलदार', 'revenue', 'राजस्व', 'collector', 'mutation'],
      court: 'Revenue Court / Tehsil', courtHi: 'राजस्व न्यायालय / तहसील', type: 'Revenue Court' },
    { match: ['sdm', 'sub divisional', 'एसडीएम', 'उपखंड'],
      court: 'SDM Court', courtHi: 'एसडीएम न्यायालय', type: 'Revenue Court' },
    { match: ['cat', 'central administrative tribunal', 'केंद्रीय प्रशासनिक अधिकरण'],
      court: 'Central Administrative Tribunal, Jaipur', courtHi: 'केंद्रीय प्रशासनिक अधिकरण, जयपुर', type: 'Tribunal' },
    { match: ['nclt', 'drt', 'debt recovery', 'ऋण वसूली'],
      court: 'Debt Recovery Tribunal / NCLT', courtHi: 'ऋण वसूली अधिकरण / एनसीएलटी', type: 'Tribunal' },
    { match: ['consumer', 'उपभोक्ता', 'district consumer'],
      court: 'District Consumer Commission, Jaipur', courtHi: 'जिला उपभोक्ता आयोग, जयपुर', type: 'Consumer Forum' },
    { match: ['labour court', 'श्रम न्यायालय', 'industrial tribunal'],
      court: 'Labour Court, Jaipur', courtHi: 'श्रम न्यायालय, जयपुर', type: 'Labour Court' },
    { match: ['police station', 'थाना', 'ps ', 'fir'],
      court: 'Police Station (pre-litigation)', courtHi: 'थाना (पूर्व-वाद)', type: 'Police' }
  ];

  const I18N = {
    EN_MONTHS, HI_MONTHS, EN_DOW, HI_DOW, DOC_TYPES, TYPE_HI, TYPE_RULES, COURT_RULES,

    mode() { return S.get('langMode') || 'auto'; },
    _autoHi: false,
    fullHindi() { return I18N.mode() === 'hi' || (I18N.mode() === 'auto' && I18N._autoHi === true); },
    isHindiText(s) { return /[\u0900-\u097F]/.test(String(s || '')); },
    hasHindiContent(rec) {
      if (!rec) return false;
      return I18N.isHindiText(rec.hiContent ? rec.name || '' : '') ||
        (rec.hiContent === true) ||
        /[\u0900-\u097F]/.test((rec.text || '').slice(0, 4000)) ||
        (rec.lang === 'hi');
    },
    /** Language actually used for a reply about an entity. */
    speakLangFor(rec) {
      if (I18N.fullHindi()) return 'hi';
      if (I18N.mode() === 'auto' && I18N.hasHindiContent(rec)) return 'hi';
      return 'en';
    },
    bilingualName(name, hiName) {
      if (!hiName || hiName === name) return name;
      const auto = I18N.mode() === 'auto';
      if (auto && (I18N.isHindiText(name) || I18N.isHindiText(hiName))) return name + ' (' + hiName + ')';
      if (I18N.fullHindi()) return hiName;
      return name;
    },
    typeHi(type) { return TYPE_HI[type] || 'अन्य'; },
    typeLabel(type, hi) {
      if (hi) return TYPE_HI[type] || type;
      return type || 'Document';
    },

    date(iso, opts = {}) {
      const d = U.parseISO(iso);
      if (!d) return opts.fallback || '—';
      const hi = opts.hi != null ? opts.hi : I18N.fullHindi();
      const dow = opts.weekday !== false;
      const year = opts.year !== false;
      if (hi) {
        return (dow ? HI_DOW[d.getDay()] + ', ' : '') + d.getDate() + ' ' + HI_MONTHS[d.getMonth()] + (year ? ' ' + d.getFullYear() : '');
      }
      return (dow ? EN_DOW[d.getDay()] + ', ' : '') + d.getDate() + ' ' + EN_MONTHS[d.getMonth()] + (year ? ' ' + d.getFullYear() : '');
    },
    shortDate(iso, hi) {
      const d = U.parseISO(iso);
      if (!d) return '—';
      if (hi) return d.getDate() + ' ' + HI_MONTHS[d.getMonth()];
      return d.getDate() + ' ' + EN_MONTHS[d.getMonth()].slice(0, 3);
    },
    monthYear(y, m, hi) {
      return (hi ? HI_MONTHS : EN_MONTHS)[m] + ' ' + y;
    },
    time(t) {
      if (!t) return '';
      const [h, m] = String(t).split(':').map(Number);
      if (isNaN(h)) return t;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hh = h % 12 === 0 ? 12 : h % 12;
      return hh + ':' + String(m || 0).padStart(2, '0') + ' ' + ampm;
    },
    timeHi(t) {
      if (!t) return '';
      const [h, m] = String(t).split(':').map(Number);
      if (isNaN(h)) return t;
      const part = h < 12 ? 'सुबह' : h < 16 ? 'दोपहर' : h < 19 ? 'शाम' : 'रात';
      const hh = h % 12 === 0 ? 12 : h % 12;
      return part + ' ' + hh + ':' + String(m || 0).padStart(2, '0');
    },
    spokenDate(iso, hi) {
      const d = U.parseISO(iso);
      if (!d) return '';
      if (hi) return d.getDate() + ' ' + HI_MONTHS[d.getMonth()];
      const n = d.getDate();
      const suf = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
      return n + suf + ' of ' + EN_MONTHS[d.getMonth()];
    },
    rel(iso, hi) {
      const n = U.daysBetween(U.todayISO(), iso);
      if (hi) {
        if (n === 0) return 'आज';
        if (n === 1) return 'कल';
        if (n === -1) return 'बीता कल';
        if (n > 1) return n + ' दिन में';
        return n * -1 + ' दिन पहले';
      }
      if (n === 0) return 'today';
      if (n === 1) return 'tomorrow';
      if (n === -1) return 'yesterday';
      if (n > 1 && n <= 14) return 'in ' + n + ' days';
      if (n < -1 && n >= -14) return Math.abs(n) + ' days ago';
      return '';
    },
    relUpper(iso) { const r = I18N.rel(iso); return r ? r.toUpperCase() : ''; },
    greeting(h) {
      const hour = (h == null ? new Date() : h).getHours();
      if (I18N.fullHindi()) {
        if (hour < 12) return 'सुप्रभात, सर।';
        if (hour < 17) return 'नमस्कार, सर।';
        return 'शुभ संध्या, सर।';
      }
      if (hour < 12) return 'Good morning, Sir.';
      if (hour < 17) return 'Good afternoon, Sir.';
      return 'Good evening, Sir.';
    },
    countWord(n, singular, plural) {
      if (I18N.fullHindi()) return n + ' ' + (singular || '');
      return n + ' ' + (n === 1 ? singular : (plural || singular + 's'));
    },
    today(hi) {
      return I18N.date(U.todayISO(), { hi, weekday: true });
    },
    ord(n) {
      const s = ['th', 'st', 'nd', 'rd'];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    },
    esc: U.esc
  };

  window.LJ.I18N = I18N;
})();
