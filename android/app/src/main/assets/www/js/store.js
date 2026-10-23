/* ============================================================
   Legal Jarvis — local-first storage, data repository, demo chamber
   Everything lives on the tablet. No account. No cloud required.
   ============================================================ */
(function () {
  'use strict';

  const DB_NAME = 'legal-jarvis';
  const DB_VERSION = 1;
  const STORES = {
    matters: 'id',
    hearings: 'id',
    tasks: 'id',
    reminders: 'id',
    documents: 'id',
    folders: 'id',
    events: 'id'
  };

  const Utils = {
    uid(prefix = 'id') {
      return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    },
    todayISO() {
      const d = new Date();
      return Utils.isoOf(d);
    },
    isoOf(d) {
      const p = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    },
    parseISO(s) {
      if (!s) return null;
      if (s instanceof Date) return s;
      const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
      const d = new Date(s);
      return isNaN(d) ? null : d;
    },
    addDays(date, n) {
      const d = date instanceof Date ? new Date(date.getTime()) : Utils.parseISO(date) || new Date();
      d.setDate(d.getDate() + n);
      return d;
    },
    startOfDay(d) {
      const x = d instanceof Date ? new Date(d.getTime()) : new Date();
      x.setHours(0, 0, 0, 0);
      return x;
    },
    daysBetween(a, b) {
      const x = Utils.startOfDay(Utils.parseISO(a) || new Date());
      const y = Utils.startOfDay(Utils.parseISO(b) || new Date());
      return Math.round((y - x) / 86400000);
    },
    relDay(iso) {
      const n = Utils.daysBetween(Utils.todayISO(), iso);
      if (n === 0) return 'today';
      if (n === 1) return 'tomorrow';
      if (n === -1) return 'yesterday';
      if (n > 1 && n < 7) return 'in ' + n + ' days';
      if (n < -1 && n > -7) return n + ' days ago';
      return '';
    },
    clean(s) {
      return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    },
    normalize(s) {
      return Utils.clean(s).toLowerCase()
        .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
        .replace(/[^a-z0-9\u0900-\u097F/.\- ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },
    titleCase(s) {
      return String(s || '').replace(/\w\S*/g, w => {
        if (/^(of|and|the|v|vs|in|to|for|under|by)$/i.test(w)) return w.toLowerCase();
        return w.charAt(0).toUpperCase() + w.slice(1);
      });
    },
    esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    },
    bytes(n) {
      if (!n && n !== 0) return '—';
      if (n < 1024) return n + ' B';
      if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
      return (n / 1048576).toFixed(1) + ' MB';
    },
    sanitizePath(s, fallback = 'Unfiled') {
      const t = Utils.clean(s || '').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\.+$/, '').trim();
      return (t || fallback).slice(0, 80);
    },
    unique(arr) {
      return [...new Set(arr.filter(Boolean))];
    },
    debounce(fn, ms) {
      let t;
      return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
    },
    sortBy(arr, key, dir = 1) {
      return arr.slice().sort((a, b) => {
        const x = typeof key === 'function' ? key(a) : a[key];
        const y = typeof key === 'function' ? key(b) : b[key];
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x > y ? 1 : x < y ? -1 : 0) * dir;
      });
    }
  };

  /* ---------------- IndexedDB ---------------- */
  const DB = {
    _db: null,
    open() {
      if (DB._db) return Promise.resolve(DB._db);
      return new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          Object.keys(STORES).forEach(name => {
            if (!db.objectStoreNames.contains(name)) {
              const s = db.createObjectStore(name, { keyPath: STORES[name] });
              if (name === 'documents') {
                s.createIndex('matterId', 'matterId', { unique: false });
                s.createIndex('type', 'type', { unique: false });
                s.createIndex('addedAt', 'addedAt', { unique: false });
              }
              if (name === 'hearings') s.createIndex('date', 'date', { unique: false });
              if (name === 'tasks') s.createIndex('matterId', 'matterId', { unique: false });
            }
          });
        };
        req.onsuccess = () => { DB._db = req.result; resolve(DB._db); };
        req.onerror = () => reject(req.error);
      });
    },
    async tx(store, mode = 'readonly') {
      const db = await DB.open();
      return db.transaction(store, mode).objectStore(store);
    },
    async all(store) {
      const s = await DB.tx(store);
      return new Promise((resolve, reject) => {
        const r = s.getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
      });
    },
    async put(store, obj) {
      const s = await DB.tx(store, 'readwrite');
      return new Promise((resolve, reject) => {
        const r = s.put(obj);
        r.onsuccess = () => resolve(obj);
        r.onerror = () => reject(r.error);
      });
    },
    async bulkPut(store, arr) {
      if (!arr.length) return arr;
      const db = await DB.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        arr.forEach(o => os.put(o));
        tx.oncomplete = () => resolve(arr);
        tx.onerror = () => reject(tx.error);
      });
    },
    async get(store, id) {
      const s = await DB.tx(store);
      return new Promise((resolve, reject) => {
        const r = s.get(id);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    },
    async del(store, id) {
      const s = await DB.tx(store, 'readwrite');
      return new Promise((resolve, reject) => {
        const r = s.delete(id);
        r.onsuccess = () => resolve(true);
        r.onerror = () => reject(r.error);
      });
    },
    async clear(store) {
      const s = await DB.tx(store, 'readwrite');
      return new Promise((resolve, reject) => {
        const r = s.clear();
        r.onsuccess = () => resolve(true);
        r.onerror = () => reject(r.error);
      });
    }
  };

  /* ---------------- Settings ---------------- */
  const Settings = {
    KEY: 'lj.settings.v1',
    defaults: {
      ownerName: 'Sir',
      langMode: 'auto',           // en | hi | auto
      recogLang: 'en-IN',
      voiceName: '',
      speechRate: 0.94,
      speechPitch: 0.88,
      speechVolume: 1,
      autoSpeak: true,
      greetOnOpen: true,
      autoBrief: true,
      handsFree: false,
      wakeChime: true,
      briefMorning: '08:30',
      briefEvening: '19:30',
      notifications: true,
      autoClassify: true,
      rescanOnResume: true,
      folders: [],
      onboarded: false,
      seeded: false,
      lastBriefDate: '',
      lastEveningBriefDate: '',
      nativeTts: true
    },
    _data: null,
    all() {
      if (!Settings._data) {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(Settings.KEY) || '{}'); } catch (e) { saved = {}; }
        Settings._data = Object.assign({}, Settings.defaults, saved);
      }
      return Settings._data;
    },
    get(k) { return Settings.all()[k]; },
    set(k, v) {
      const d = Settings.all();
      d[k] = v;
      try { localStorage.setItem(Settings.KEY, JSON.stringify(d)); } catch (e) { /* quota */ }
      if (window.App && App.onSettingChanged) App.onSettingChanged(k, v);
      return v;
    },
    patch(obj) {
      Object.keys(obj).forEach(k => { Settings.all()[k] = obj[k]; });
      try { localStorage.setItem(Settings.KEY, JSON.stringify(Settings.all())); } catch (e) {}
    },
    reset() {
      Settings._data = Object.assign({}, Settings.defaults);
      try { localStorage.setItem(Settings.KEY, JSON.stringify(Settings._data)); } catch (e) {}
    }
  };

  /* ---------------- Repository ---------------- */
  const Repo = {
    ready: false,
    data: { matters: [], hearings: [], tasks: [], reminders: [], documents: [], folders: [] },

    async load() {
      await DB.open();
      const names = Object.keys(Repo.data);
      for (const n of names) {
        Repo.data[n] = await DB.all(n);
      }
      Repo.ready = true;
      return Repo;
    },

    matter(id) { return Repo.data.matters.find(m => m.id === id) || null; },
    document(id) { return Repo.data.documents.find(d => d.id === id) || null; },
    hearing(id) { return Repo.data.hearings.find(h => h.id === id) || null; },

    matterName(m) {
      if (!m) return 'Unlinked';
      return m.title || m.client || 'Matter';
    },

    async saveMatter(m) {
      m.updatedAt = new Date().toISOString();
      if (!m.createdAt) m.createdAt = m.updatedAt;
      if (!m.id) m.id = Utils.uid('mat');
      const i = Repo.data.matters.findIndex(x => x.id === m.id);
      if (i >= 0) Repo.data.matters[i] = m; else Repo.data.matters.push(m);
      await DB.put('matters', m);
      return m;
    },
    async deleteMatter(id) {
      const docs = Repo.data.documents.filter(d => d.matterId === id);
      docs.forEach(d => { d.matterId = null; d.folder = d.folder || ''; });
      await DB.bulkPut('documents', docs);
      Repo.data.hearings.filter(h => h.matterId === id).forEach(h => Repo.remove('hearings', h.id));
      Repo.data.tasks.filter(t => t.matterId === id).forEach(t => Repo.remove('tasks', t.id));
      Repo.data.reminders.filter(r => r.matterId === id).forEach(r => Repo.remove('reminders', r.id));
      Repo.data.matters = Repo.data.matters.filter(m => m.id !== id);
      Repo.data.hearings = Repo.data.hearings.filter(h => h.matterId !== id);
      Repo.data.tasks = Repo.data.tasks.filter(t => t.matterId !== id);
      Repo.data.reminders = Repo.data.reminders.filter(r => r.matterId !== id);
      await DB.del('matters', id);
    },

    async saveHearing(h) {
      if (!h.id) h.id = Utils.uid('hrg');
      h.createdAt = h.createdAt || new Date().toISOString();
      const i = Repo.data.hearings.findIndex(x => x.id === h.id);
      if (i >= 0) Repo.data.hearings[i] = h; else Repo.data.hearings.push(h);
      await DB.put('hearings', h);
      // next hearing drives the matter card
      if (h.matterId && h.date) {
        const m = Repo.matter(h.matterId);
        if (m) {
          const upcoming = Repo.data.hearings
            .filter(x => x.matterId === m.id && x.date >= Utils.todayISO())
            .sort((a, b) => a.date.localeCompare(b.date))[0];
          m.nextHearing = upcoming ? upcoming.date : null;
          m.nextCourt = upcoming ? (upcoming.court || m.court) : m.court;
          m.nextTime = upcoming ? upcoming.time || '' : '';
          m.nextPurpose = upcoming ? upcoming.purpose || '' : '';
          await Repo.saveMatter(m);
        }
      }
      if (window.App && App.onHearingSaved) App.onHearingSaved(h);
      return h;
    },
    async deleteHearing(id) {
      const h = Repo.hearing(id);
      Repo.data.hearings = Repo.data.hearings.filter(x => x.id !== id);
      await DB.del('hearings', id);
      if (h && h.matterId) {
        const m = Repo.matter(h.matterId);
        if (m) {
          const upcoming = Repo.data.hearings
            .filter(x => x.matterId === m.id && x.date >= Utils.todayISO())
            .sort((a, b) => a.date.localeCompare(b.date))[0];
          m.nextHearing = upcoming ? upcoming.date : null;
          await Repo.saveMatter(m);
        }
      }
    },
    hearingsFor(id) {
      return Utils.sortBy(Repo.data.hearings.filter(h => h.matterId === id), 'date', -1);
    },
    hearingsOn(date) {
      return Utils.sortBy(Repo.data.hearings.filter(h => h.date === date), h => (h.time || '00:00'));
    },
    upcomingHearings(days = 7, from) {
      const start = from || Utils.todayISO();
      const end = Utils.isoOf(Utils.addDays(start, days));
      return Utils.sortBy(Repo.data.hearings.filter(h => h.date >= start && h.date <= end), h => h.date + ' ' + (h.time || ''));
    },

    async saveTask(t) {
      if (!t.id) t.id = Utils.uid('tsk');
      t.createdAt = t.createdAt || new Date().toISOString();
      const i = Repo.data.tasks.findIndex(x => x.id === t.id);
      if (i >= 0) Repo.data.tasks[i] = t; else Repo.data.tasks.push(t);
      await DB.put('tasks', t);
      return t;
    },
    async toggleTask(id, done) {
      const t = Repo.data.tasks.find(x => x.id === id);
      if (!t) return;
      t.done = done == null ? !t.done : !!done;
      t.doneAt = t.done ? new Date().toISOString() : '';
      await DB.put('tasks', t);
      return t;
    },
    async remove(store, id) {
      Repo.data[store] = Repo.data[store].filter(x => x.id !== id);
      await DB.del(store, id);
    },
    tasksFor(id) { return Utils.sortBy(Repo.data.tasks.filter(t => t.matterId === id), t => (t.due || '9999')); },
    openTasks() { return Repo.data.tasks.filter(t => !t.done); },
    overdueTasks() {
      const today = Utils.todayISO();
      return Repo.openTasks().filter(t => t.due && t.due < today);
    },

    async saveReminder(r) {
      if (!r.id) r.id = Utils.uid('rem');
      r.createdAt = r.createdAt || new Date().toISOString();
      const i = Repo.data.reminders.findIndex(x => x.id === r.id);
      if (i >= 0) Repo.data.reminders[i] = r; else Repo.data.reminders.push(r);
      await DB.put('reminders', r);
      return r;
    },
    upcomingReminders(days = 30, from) {
      const start = from || Utils.todayISO();
      const end = Utils.isoOf(Utils.addDays(start, days));
      return Utils.sortBy(Repo.data.reminders.filter(r => r.date >= start && r.date <= end && !r.dismissed), r => r.date + ' ' + (r.time || ''));
    },

    docsFor(id) {
      return Utils.sortBy(Repo.data.documents.filter(d => d.matterId === id), 'lastModified', -1);
    },
    unlinkedDocs() { return Repo.data.documents.filter(d => !d.matterId); },
    async saveDocument(docObj) {
      docObj.updatedAt = new Date().toISOString();
      if (!docObj.id) docObj.id = Utils.uid('doc');
      if (!docObj.addedAt) docObj.addedAt = docObj.updatedAt;
      const i = Repo.data.documents.findIndex(x => x.id === docObj.id);
      if (i >= 0) Repo.data.documents[i] = docObj; else Repo.data.documents.push(docObj);
      await DB.put('documents', docObj);
      return docObj;
    },
    async deleteDocument(id) {
      Repo.data.documents = Repo.data.documents.filter(d => d.id !== id);
      await DB.del('documents', id);
    },

    courts() {
      return Utils.unique(Repo.data.matters.map(m => m.court).concat(Repo.data.documents.map(d => d.court)))
        .sort((a, b) => a.localeCompare(b));
    },
    matterTitles() { return Repo.data.matters.map(m => m.title); },
    findMatter(query) {
      return matchMatter(query, Repo.data.matters);
    }
  };

  /* ---------------- Fuzzy matter matching ---------------- */
  function latinize(str) {
    const map = {
      'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
      'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
      'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
      'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
      'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l', 'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f', 'य़': 'y',
      'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
      'ं': 'n', 'ँ': 'n', 'ः': 'h', '्': '', '़': '', 'ऽ': '', 'ॐ': 'om',
      '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
      'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f'
    };
    return String(str || '').replace(/[\u0900-\u097F]/g, ch => {
      if (map[ch] !== undefined) return map[ch];
      return '';
    });
  }

  function phonetic(s) {
    return latinize(Utils.normalize(s))
      .replace(/chh/g, 'c').replace(/ch/g, 'c').replace(/sh/g, 's').replace(/ph/g, 'f')
      .replace(/th/g, 't').replace(/dh/g, 'd').replace(/bh/g, 'b').replace(/gh/g, 'g')
      .replace(/kh/g, 'k').replace(/jh/g, 'j').replace(/([a-z])\1+/g, '$1')
      .replace(/[aeiou]/g, '').replace(/[^a-z0-9 ]/g, '');
  }

  const STOP = new Set(['the', 'of', 'and', 'vs', 'v', 'versus', 'case', 'matter', 'file', 'files', 'document', 'documents',
    'latest', 'new', 'old', 'draft', 'show', 'me', 'pull', 'up', 'open', 'please', 'jarvis', 'ka', 'ki', 'ke', 'mein', 'me',
    'karo', 'kar', 'do', 'dikhao', 'dikha', 'batao', 'wala', 'wali', 'for', 'in', 'on', 'a', 'an', 'my', 'with', 'from']);

  function tokens(s) {
    return Utils.normalize(latinize(s) + ' ' + s).split(' ').filter(w => w && w.length > 1 && !STOP.has(w));
  }

  function scoreText(query, text) {
    if (!query || !text) return 0;
    const qRaw = Utils.normalize(query);
    if (!qRaw) return 0;
    const q = phonetic(query).replace(/\s+/g, '');
    const t = phonetic(text);
    if (!q) return 0;
    let score = 0;
    if (q.length >= 3 && t.includes(q)) score += 12;
    const qt = tokens(query).filter(w => w.length >= 3);
    const tt = new Set(tokens(text));
    const tPhon = new Set(tokens(text).map(x => phonetic(x)).filter(Boolean));
    qt.forEach(w => {
      const p = phonetic(w).replace(/\s+/g, '');
      if (!p || p.length < 3) return;
      if (tt.has(w)) score += 6;
      else if (tPhon.has(p)) score += 6;
      else {
        for (const x of tt) {
          if (x.length >= 5 && w.length >= 5 && (x.includes(w) || w.includes(x))) { score += 2; break; }
        }
      }
    });
    return score;
  }

  const MATTER_IGNORE = new Set(['rejoinder', 'reply', 'petition', 'plaint', 'application', 'order', 'judgment', 'judgement',
    'notice', 'draft', 'evidence', 'affidavit', 'vakalatnama', 'written', 'statement', 'document', 'documents', 'paper', 'papers',
    'hearing', 'hearingdate', 'date', 'court', 'legal', 'latest', 'recent', 'newest', 'yesterday', 'tomorrow', 'today',
    'jodDo', 'wala', 'wali', 'batao', 'dikhao', 'kholo', 'chahiye', 'karna', 'kaun', 'kya', 'kab', 'kitne', 'जोड़ो', 'तारीख',
    'petitioner', 'respondent', 'applicant', 'defendant', 'complainant', 'accused', 'appellant', 'plaintiff',
    'filed', 'filing', 'copy', 'signed', 'final', 'dated', 'page', 'pages', 'versus']);

  /* Words that appear in half the register and therefore identify nothing. */
  const MATTER_GENERIC = new Set(['state', 'india', 'indian', 'rajasthan', 'jaipur', 'court', 'courts', 'high', 'district',
    'sessions', 'session', 'civil', 'criminal', 'family', 'revenue', 'police', 'station', 'government', 'govt', 'union',
    'department', 'officer', 'matter', 'matters', 'case', 'cases', 'advocate', 'client', 'through', 'about', 'shall']);

  function matchMatter(query, matters) {
    if (!query) return null;
    const sig = tokens(query).filter(w => w.length >= 3 && !MATTER_IGNORE.has(w) && !MATTER_GENERIC.has(w));
    if (!sig.length) return null;
    /* A single three-letter fragment is too weak to bind a whole matter. */
    if (sig.length === 1 && sig[0].length < 4) return null;
    const q = sig.join(' ');
    let best = null, bestScore = 0, bestHits = 0;
    matters.forEach(m => {
      const fields = [m.title || '', m.titleHi || '', m.client || '', m.clientHi || '',
        m.cnr || '', (m.caseNo || '') + ' ' + (m.year || '')].join(' ');
      let s = 0;
      s += scoreText(q, m.title || '') * 1.4;
      s += scoreText(q, m.titleHi || '') * 1.4;
      s += scoreText(q, m.client || '') * 1.6;
      s += scoreText(q, m.clientHi || '') * 1.6;
      s += scoreText(q, (m.caseNo || '') + ' ' + (m.year || ''));
      s += scoreText(q, m.cnr || '') * 2;
      s += scoreText(q, m.court || '') * 0.5;
      const hits = sig.filter(w => scoreText(w, fields) >= 6).length;
      if (s > bestScore || (s === bestScore && hits > bestHits)) { bestScore = s; bestHits = hits; best = m; }
    });
    return (bestScore >= 8 && bestHits > 0) ? best : null;
  }

  /* ---------------- Demo PDF generator (valid, tiny, searchable) ---------------- */
  function makeDemoPdf(title, lines) {
    const esc = s => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const wrap = s => {
      const words = String(s).split(' ');
      const out = [];
      let line = '';
      words.forEach(w => {
        if ((line + ' ' + w).trim().length > 82) { out.push(line.trim()); line = w; }
        else line += ' ' + w;
      });
      if (line.trim()) out.push(line.trim());
      return out;
    };
    const body = [];
    body.push('BT', '/F1 16 Tf', '60 760 Td', '(' + esc(title) + ') Tj', '/F1 10 Tf', '0 -26 Td');
    lines.forEach(l => {
      if (!l) { body.push('0 -12 Td'); return; }
      wrap(l).forEach(ln => { body.push('(' + esc(ln) + ') Tj', '0 -15 Td'); });
      body.push('0 -6 Td');
    });
    body.push('ET');
    const content = body.join('\n');
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objs.forEach((o, i) => {
      offsets.push(pdf.length);
      pdf += (i + 1) + ' 0 obj\n' + o + '\nendobj\n';
    });
    const xref = pdf.length;
    pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    for (let i = 1; i <= objs.length; i++) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    pdf += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  /* ---------------- Seed demo chamber ---------------- */
  const DEMO = {
    matters: [
      {
        title: 'State of Rajasthan v. Mahesh Sharma', titleHi: 'राज्य बनाम महेश शर्मा',
        client: 'Mahesh Sharma', clientHi: 'महेश शर्मा',
        court: 'District & Sessions Court, Jaipur Metropolitan', courtHi: 'जिला एवं सत्र न्यायालय, जयपुर महानगर',
        courtType: 'District Court', caseNo: '42', year: '2023', cnr: 'RJJP010012342023',
        side: 'Accused', opposite: 'State of Rajasthan', status: 'active', stage: 'Prosecution evidence — PW-3 cross-examination pending',
        stageHi: 'अभियोजन साक्ष्य — पी.डब्ल्यू.-3 का प्रति-परीक्षण लंबित',
        nextHearing: 1, tag: 'Criminal', notes: 'Bail granted. Original FIR and site plan in file. Witness summons for PW-3 awaited.'
      },
      {
        title: 'Smt. Kamla Devi v. State of Rajasthan', titleHi: 'श्रीमती कमला देवी बनाम राज्य राजस्थान',
        client: 'Kamla Devi', clientHi: 'श्रीमती कमला देवी',
        court: 'Rajasthan High Court, Jaipur Bench', courtHi: 'राजस्थान उच्च न्यायालय, जयपुर पीठ',
        courtType: 'High Court', caseNo: '5432', year: '2025', cnr: 'RJHC010054322025',
        side: 'Petitioner', opposite: 'State of Rajasthan', status: 'active',
        stage: 'Notice issued to State; reply affidavit awaited', stageHi: 'राज्य को नोटिस जारी; जवाब हलफनामा प्रतीक्षित',
        nextHearing: 3, tag: 'Criminal Misc.', notes: 'Quashing petition under Section 528 BNSS. Need to prepare rejoinder after State reply.'
      },
      {
        title: 'M/s Shree Balaji Traders v. Rajendra Kumar', titleHi: 'मेसर्स श्री बालाजी ट्रेडर्स बनाम राजेन्द्र कुमार',
        client: 'Shree Balaji Traders', clientHi: 'मेसर्स श्री बालाजी ट्रेडर्स',
        court: 'Civil Judge (Jr. Division), Jaipur Metropolitan', courtHi: 'सिविल जज (जूनियर डिवीजन), जयपुर महानगर',
        courtType: 'Civil Court', caseNo: '118', year: '2024', cnr: 'RJJP02001182024',
        side: 'Plaintiff', opposite: 'Rajendra Kumar', status: 'active',
        stage: 'Written statement filed; replication under preparation', stageHi: 'लिखित कथन दाखिल; प्रतिकर तैयार हो रहा है',
        nextHearing: 6, tag: 'Civil Suit', notes: 'Recovery of ₹8,45,000 with interest. Ledger and invoices to be produced.'
      },
      {
        title: 'Smt. Rehana Bano v. Tehsildar, Sanganer', titleHi: 'श्रीमती रेहाना बानो बनाम तहसीलदार, सांगानेर',
        client: 'Rehana Bano', clientHi: 'श्रीमती रेहाना बानो',
        court: 'Revenue Appellate Authority, Jaipur', courtHi: 'राजस्व अपीलीय प्राधिकरण, जयपुर',
        courtType: 'Revenue Court', caseNo: '27', year: '2024', cnr: '',
        side: 'Appellant', opposite: 'Tehsildar, Sanganer', status: 'active',
        stage: 'Revenue record summoned from Tehsil', stageHi: 'तहसील से राजस्व अभिलेख तलब',
        nextHearing: 9, tag: 'Revenue', notes: 'Mutation dispute over agricultural land. Manual matter — not on e-Courts.'
      },
      {
        title: 'Ajay Meena v. Jaipur Development Authority', titleHi: 'अजय मीना बनाम जयपुर विकास प्राधिकरण',
        client: 'Ajay Meena', clientHi: 'अजय मीना',
        court: 'Rajasthan High Court, Jaipur Bench', courtHi: 'राजस्थान उच्च न्यायालय, जयपुर पीठ',
        courtType: 'High Court', caseNo: '8841', year: '2026', cnr: 'RJHC010088412026',
        side: 'Petitioner', opposite: 'JDA', status: 'active',
        stage: 'Fresh writ — defect objections to be removed', stageHi: 'नई रिट — दोष आपत्तियाँ दूर करनी हैं',
        nextHearing: 14, tag: 'Writ', notes: 'Challenge to sealing order. Need legible copy of lease deed and site plan.'
      },
      {
        title: 'Suresh Chand Gupta v. Union of India', titleHi: 'सुरेश चंद गुप्ता बनाम भारत संघ',
        client: 'Suresh Chand Gupta', clientHi: 'सुरेश चंद गुप्ता',
        court: 'Central Administrative Tribunal, Jaipur', courtHi: 'केंद्रीय प्रशासनिक अधिकरण, जयपुर',
        courtType: 'Tribunal', caseNo: 'OA 310', year: '2022', cnr: 'RJCA010003102022',
        side: 'Applicant', opposite: 'Union of India', status: 'disposed',
        stage: 'Allowed — pension revision implemented', stageHi: 'अनुमति — पेंशन पुनरीक्षण लागू',
        nextHearing: null, tag: 'Service', notes: 'Disposed. Certified copy received and filed.'
      }
    ],
    tasks: [
      { m: 0, title: 'Prepare rejoinder in the Sharma matter', titleHi: 'शर्मा मामले में प्रतिकर तैयार करें', kind: 'chamber', due: -1, priority: 'high' },
      { m: 0, title: 'File process fee for PW-3 summons', titleHi: 'पी.डब्ल्यू.-3 समन हेतु प्रक्रिया शुल्क जमा करें', kind: 'process', due: 0, priority: 'high' },
      { m: 1, title: 'Brief the State counsel before listing', titleHi: 'सूचीबद्धता से पहले राज्य अधिवक्ता को ब्रीफ करें', kind: 'chamber', due: 2, priority: 'medium' },
      { m: 2, title: 'Draft replication in Balaji Traders suit', titleHi: 'बालाजी ट्रेडर्स वाद में प्रतिकर का प्रारूप तैयार करें', kind: 'chamber', due: 3, priority: 'medium' },
      { m: 4, title: 'Removal of objections and legible annexures', titleHi: 'आपत्तियाँ दूर करें एवं स्पष्ट अनुलग्नक लगाएँ', kind: 'process', due: 5, priority: 'high' },
      { m: 3, title: 'Collect certified revenue record from Tehsil', titleHi: 'तहसील से प्रमाणित राजस्व अभिलेख प्राप्त करें', kind: 'chamber', due: 6, priority: 'medium' }
    ],
    reminders: [
      { title: 'Limitation date — appeal in Sharma matter', titleHi: 'शर्मा मामले में अपील की परिसीमा तिथि', days: 2, kind: 'limitation', m: 0 },
      { title: 'Filed copy of replication to be collected', titleHi: 'प्रतिकर की दाखिल प्रति प्राप्त करें', days: 3, kind: 'filing', m: 2 },
      { title: 'Inspect original record, High Court', titleHi: 'उच्च न्यायालय में मूल अभिलेख का निरीक्षण', days: 5, kind: 'inspection', m: 1 }
    ],
    docs: [
      {
        name: 'Reply to application under Section 528 BNSS.pdf', type: 'Reply', typeHi: 'जवाब',
        m: 0, status: 'ready', days: 1,
        lines: [
          'IN THE COURT OF THE ADDITIONAL SESSIONS JUDGE (9), JAIPUR METROPOLITAN',
          'Session Case No. 42/2023 — State of Rajasthan v. Mahesh Sharma',
          '',
          'REPLY ON BEHALF OF THE ACCUSED TO THE APPLICATION UNDER SECTION 528 BNSS',
          '',
          'The accused respectfully submits that the present application is misconceived and deserves to be dismissed.',
          'The applicant has suppressed material facts concerning the seizure memo dated 14.05.2023.',
          'The photographs placed on record clearly demonstrate that the alleged recovery was not made from the accused.',
          'It is therefore prayed that the application may kindly be dismissed with costs.',
          '',
          'Place: Jaipur                                   Counsel for the Accused'
        ]
      },
      {
        name: 'Legal notice to Rajendra Kumar.txt', type: 'Notice', typeHi: 'नोटिस',
        m: 2, status: 'ready', days: 2,
        lines: [
          'Regd. A.D. — LEGAL NOTICE',
          'Under Section 138 of the Negotiable Instruments Act',
          '',
          'To, Rajendra Kumar, S/o Shri Ram Kumar, Civil Lines, Jaipur',
          'You are hereby called upon to pay Rs. 2,45,000 together with interest within fifteen days of receipt.',
          'Failing which civil and criminal proceedings shall be instituted without further notice.'
        ]
      },
      {
        name: 'दावा पत्र - बालाजी ट्रेडर्स.txt', type: 'Plaint', typeHi: 'वादपत्र',
        m: 2, status: 'filed', days: 8,
        hiContent: true,
        lines: [
          'सिविल जज (जूनियर डिवीजन) जयपुर महानगर के समक्ष',
          'वाद संख्या 118/2024',
          'मेसर्स श्री बालाजी ट्रेडर्स बनाम राजेन्द्र कुमार',
          '',
          'वाद पत्र',
          'यह वाद प्रतिवादी द्वारा बकाया राशि रुपये 8,45,000 की वसूली हेतु प्रस्तुत किया जा रहा है।',
          'वादी ने प्रतिवादी को माल की आपूर्ति की तथा बिल प्रस्तुत किए गए।',
          'प्रतिवादी ने बार-बार मांग के बावजूद भुगतान नहीं किया।',
          'अतः प्रार्थना है कि बकाया राशि ब्याज सहित वसूल की जाए।'
        ]
      },
      {
        name: 'Rejoinder draft - Kamla Devi.pdf', type: 'Reply', typeHi: 'जवाब',
        m: 1, status: 'in-progress', days: 0,
        lines: [
          'IN THE HIGH COURT OF JUDICATURE FOR RAJASTHAN AT JAIPUR BENCH, JAIPUR',
          'S.B. Criminal Miscellaneous Petition No. 5432/2025',
          'Smt. Kamla Devi v. State of Rajasthan',
          '',
          'REJOINDER ON BEHALF OF THE PETITIONER — DRAFT',
          '',
          'The petitioner submits that the reply filed by the State does not dispute the fact that the FIR was registered in 2019.',
          'The delay in investigation has caused grave prejudice to the petitioner.',
          'The petitioner therefore seeks quashing of the proceedings with costs.',
          '',
          '[PENDING FINAL REVIEW — DO NOT FILE]'
        ]
      },
      {
        name: 'Evidence list and exhibits - Sharma.pdf', type: 'Evidence', typeHi: 'साक्ष्य',
        m: 0, status: 'ready', days: 4,
        lines: [
          'LIST OF DOCUMENTS / EXHIBITS',
          'State of Rajasthan v. Mahesh Sharma — Session Case No. 42/2023',
          '',
          'Exhibit P-1: FIR No. 214/2019, Police Station Jyoti Nagar',
          'Exhibit P-2: Site plan prepared by the investigating officer',
          'Exhibit P-3: Seizure memo dated 14.05.2023',
          'Exhibit P-4: FSL report',
          'Exhibit D-1: Employment certificate of the accused'
        ]
      }
    ]
  };

  async function seedDemoIfNeeded() {
    if (Settings.get('seeded')) return false;
    const today = new Date();
    const stamp = new Date().toISOString();
    const matterIds = [];
    for (let i = 0; i < DEMO.matters.length; i++) {
      const d = DEMO.matters[i];
      const m = Object.assign({}, d);
      m.id = Utils.uid('mat');
      m.source = 'sample';
      m.sample = true;
      m.createdAt = stamp;
      m.updatedAt = stamp;
      m.nextHearing = d.nextHearing == null ? null : Utils.isoOf(Utils.addDays(today, d.nextHearing));
      delete m.nextHearingOffset;
      delete m.tag;
      m.tags = d.tag ? [d.tag] : [];
      matterIds.push(m.id);
      Repo.data.matters.push(m);
      await DB.put('matters', m);

      if (d.nextHearing != null) {
        const h = {
          id: Utils.uid('hrg'), matterId: m.id, date: m.nextHearing,
          time: i % 2 === 0 ? '10:30' : '12:15',
          court: d.court, purpose: d.stage, purposeHi: d.stageHi,
          itemNo: String(12 + i * 7), source: 'manual', sample: true, createdAt: stamp
        };
        Repo.data.hearings.push(h);
        await DB.put('hearings', h);
      }
      if (i === 0) {
        const h2 = {
          id: Utils.uid('hrg'), matterId: m.id, date: Utils.isoOf(Utils.addDays(today, 21)),
          time: '10:30', court: d.court, purpose: 'Final arguments', purposeHi: 'अंतिम तर्क',
          source: 'manual', sample: true, createdAt: stamp
        };
        Repo.data.hearings.push(h2);
        await DB.put('hearings', h2);
      }
    }

    for (const t of DEMO.tasks) {
      const rec = {
        id: Utils.uid('tsk'), matterId: matterIds[t.m], title: t.title, titleHi: t.titleHi,
        kind: t.kind, due: Utils.isoOf(Utils.addDays(today, t.due)), done: false,
        priority: t.priority, sample: true, createdAt: stamp
      };
      Repo.data.tasks.push(rec);
      await DB.put('tasks', rec);
    }
    for (const r of DEMO.reminders) {
      const rec = {
        id: Utils.uid('rem'), matterId: matterIds[r.m], title: r.title, titleHi: r.titleHi,
        date: Utils.isoOf(Utils.addDays(today, r.days)), time: '09:00', kind: r.kind,
        dismissed: false, sample: true, createdAt: stamp
      };
      Repo.data.reminders.push(rec);
      await DB.put('reminders', rec);
    }
    // demo documents (real PDFs / plain text, stored in IndexedDB)
    for (const d of DEMO.docs) {
      const m = Repo.matter(matterIds[d.m]);
      const isPdf = /\.pdf$/i.test(d.name);
      const content = d.lines.join('\n');
      let blob, size = content.length;
      if (isPdf) { blob = makeDemoPdf(d.name.replace(/\.pdf$/i, ''), d.lines); size = blob.size; }
      else blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const rec = {
        id: Utils.uid('doc'), name: d.name, nameHi: d.hiContent ? d.name : '',
        ext: isPdf ? 'pdf' : 'txt', size, lastModified: Utils.isoOf(Utils.addDays(today, -d.days)),
        addedAt: stamp, court: m ? m.court : 'Unsorted', courtHi: m ? m.courtHi : '',
        caseTitle: m ? m.title : 'Unsorted', caseTitleHi: m ? m.titleHi : '',
        client: m ? m.client : '', clientHi: m ? m.clientHi : '',
        type: d.type, typeHi: d.typeHi, matterId: sampleMatterId(m), status: d.status || 'ready',
        source: 'sample', sample: true, text: content, blob, folder: ''
      };
      rec.matterId = m ? m.id : null;
      if (!rec.nameHi && rec.type) rec.nameHi = '';
      Repo.data.documents.push(rec);
      await DB.put('documents', rec);
    }
    Settings.set('seeded', true);
    return true;
  }
  function sampleMatterId(m) { return m ? m.id : null; }

  async function clearSampleData() {
    const all = ['matters', 'hearings', 'tasks', 'reminders', 'documents'];
    for (const s of all) {
      const gone = Repo.data[s].filter(x => x.sample);
      Repo.data[s] = Repo.data[s].filter(x => !x.sample);
      for (const g of gone) await DB.del(s, g.id);
    }
    Settings.set('seeded', true);
    return true;
  }

  async function resetEverything() {
    for (const s of Object.keys(STORES)) {
      await DB.clear(s);
      if (Repo.data[s]) Repo.data[s] = [];
    }
    Settings.reset();
  }

  async function backupJSON() {
    const payload = {
      app: 'Legal Jarvis', version: 1, exportedAt: new Date().toISOString(),
      settings: Settings.all(), data: {
        matters: Repo.data.matters,
        hearings: Repo.data.hearings,
        tasks: Repo.data.tasks,
        reminders: Repo.data.reminders,
        documents: Repo.data.documents.map(d => Object.assign({}, d, { blob: null }))
      }
    };
    return JSON.stringify(payload, null, 2);
  }

  async function restoreJSON(text) {
    const p = JSON.parse(text);
    if (!p || p.app !== 'Legal Jarvis' || !p.data) throw new Error('Not a Legal Jarvis backup');
    for (const s of ['matters', 'hearings', 'tasks', 'reminders', 'documents']) {
      const arr = (p.data[s] || []).map(x => Object.assign({}, x, { blob: null }));
      Repo.data[s] = arr;
      await DB.clear(s);
      await DB.bulkPut(s, arr);
    }
    if (p.settings) Settings.patch(p.settings);
    return true;
  }

  window.LJ = window.LJ || {};
  Object.assign(window.LJ, {
    Utils, DB, Settings, Repo, seedDemoIfNeeded, clearSampleData, resetEverything,
    backupJSON, restoreJSON, makeDemoPdf, latinize, phonetic, matchMatter, scoreText, tokens
  });
})();
