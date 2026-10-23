/* ============================================================
   Legal Jarvis — document intelligence
   Reads PDF / Word / text, recognises court, case, client and
   document type, files it into a clean chamber tree, and makes
   the whole archive retrievable in plain language.
   ============================================================ */
(function () {
  'use strict';
  const U = LJ.Utils;
  const I = LJ.I18N;
  const Bridge = LJ.Bridge;
  const Repo = LJ.Repo;
  const Settings = LJ.Settings;

  const MIME = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    rtf: 'application/rtf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp'
  };

  const HI_MONTHS = {
    'जनवरी': 0, 'फरवरी': 1, 'फ़रवरी': 1, 'मार्च': 2, 'अप्रैल': 3, 'मई': 4, 'जून': 5,
    'जुलाई': 6, 'अगस्त': 7, 'सितंबर': 8, 'सितम्बर': 8, 'अक्टूबर': 9, 'अक्तूबर': 9,
    'नवंबर': 10, 'नवम्बर': 10, 'दिसंबर': 11, 'दिसम्बर': 11
  };
  const EN_MONTHS = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
    jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
    oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
  };

  function readBlob(blob) {
    if (!blob) return Promise.resolve(new ArrayBuffer(0));
    if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(blob);
    });
  }

  const Docs = {
    onProgress: null,
    MIME,
    mimeOf(ext) { return MIME[String(ext || '').toLowerCase()] || 'application/octet-stream'; },

    extensionOf(name) {
      const m = String(name || '').match(/\.([a-z0-9]{2,5})$/i);
      return m ? m[1].toLowerCase() : '';
    },

    isHindi(rec) { return I.hasHindiContent(rec); },

    /* ---------------- text extraction ---------------- */
    async extractTextClient(file) {
      const ext = Docs.extensionOf(file.name);
      try {
        if (ext === 'txt' || ext === 'rtf') {
          return { text: (await file.text()).slice(0, 300000) };
        }
        if (ext === 'docx' && window.mammoth) {
          const buf = await readBlob(file);
          const res = await window.mammoth.extractRawText({ arrayBuffer: buf });
          return { text: String(res.value || '').slice(0, 300000) };
        }
        if (ext === 'pdf' && window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
          const buf = await readBlob(file);
          const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
          const pages = Math.min(pdf.numPages, 60);
          let out = '';
          for (let p = 1; p <= pages; p++) {
            const page = await pdf.getPage(p);
            const tc = await page.getTextContent();
            out += tc.items.map(i => i.str).join(' ') + '\n';
            if (out.length > 260000) break;
          }
          return { text: out.slice(0, 300000), pages: pdf.numPages };
        }
        if (/^(png|jpg|jpeg|webp)$/.test(ext)) {
          return { text: '', image: true };
        }
        if (ext === 'doc') {
          const txt = (await file.text()).replace(/[^\x20-\x7E\u0900-\u097F\n]+/g, ' ');
          return { text: txt.slice(0, 120000) };
        }
      } catch (e) {
        console.warn('extract failed', file.name, e);
        return { text: '', error: String(e.message || e) };
      }
      return { text: '' };
    },

    async extractTextNative(uri) {
      try {
        const r = await Bridge.extractText(uri);
        return { text: String(r.text || '').slice(0, 300000), pages: r.pages, error: r.error };
      } catch (e) {
        return { text: '', error: String(e.message || e) };
      }
    },

    /* ---------------- date recognition ---------------- */
    findDate(text) {
      const t = ' ' + String(text || '') + ' ';
      let m = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
      if (m) {
        let d = +m[1], mo = +m[2];
        if (mo > 12) { const tmp = d; d = mo; mo = tmp; }
        if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return U.isoOf(new Date(+m[3], mo - 1, d));
      }
      const enNames = Object.keys(EN_MONTHS).join('|');
      m = t.match(new RegExp('\\b(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s+(' + enNames + ')[,.]?\\s+(\\d{4})\\b', 'i'));
      if (m) return U.isoOf(new Date(+m[3], EN_MONTHS[m[2].toLowerCase()], +m[1]));
      const hiNames = Object.keys(HI_MONTHS).join('|');
      m = t.match(new RegExp('(\\d{1,2})\\s*(' + hiNames + ')\\s*(\\d{4})'));
      if (m) return U.isoOf(new Date(+m[3], HI_MONTHS[m[2]], +m[1]));
      m = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
      if (m) return m[0];
      return '';
    },

    /* ---------------- classification ---------------- */
    detectType(name, text) {
      const hay = ' ' + String(name || '').toLowerCase() + ' ' + String(text || '').slice(0, 12000).toLowerCase() + ' ';
      let best = { type: 'Other', score: 0 };
      I.TYPE_RULES.forEach(rule => {
        let score = 0;
        rule.words.forEach(w => {
          const word = w.toLowerCase();
          if (!hay.includes(word)) return;
          score += 1;
          if (String(name || '').toLowerCase().includes(word)) score += 2.5;
          if (word.length > 6) score += 0.5;
        });
        if (rule.type === 'Reply' && /rejoinder|प्रतिकर/.test(hay)) score -= 2;
        if (rule.type === 'Draft' && best.type !== 'Draft') score -= 1.5;
        if (score > best.score) best = { type: rule.type, score };
      });
      return best.score > 0 ? best.type : 'Other';
    },

    detectCourt(name, text) {
      const hay = (' ' + String(name || '') + ' ' + String(text || '').slice(0, 20000) + ' ').toLowerCase();
      let best = null;
      I.COURT_RULES.forEach(rule => {
        let hits = 0;
        rule.match.forEach(m => {
          if (hay.includes(m.toLowerCase())) hits += m.length > 5 ? 2 : 1;
        });
        if (hits > 0 && (!best || hits > best.hits)) best = Object.assign({ hits }, rule);
      });
      if (!best) return null;
      return { court: best.court, courtHi: best.courtHi, courtType: best.type };
    },

    detectStatus(name) {
      const n = String(name || '').toLowerCase();
      if (/draft|प्रारूप|wip|pen/ .test(n)) return 'in-progress';
      if (/final|ready|print|signed|sig(ned)?/.test(n)) return 'ready';
      if (/filed|stamp|दाखिल|vakalat|accepted/.test(n)) return 'filed';
      return 'ready';
    },

    guessCaseFromName(name) {
      let s = String(name || '').replace(/\.[a-z0-9]+$/i, '');
      s = s.replace(/\b(draft|final|copy|signed|scan(ned)?|pdf|docx?|dtd|dated)\b/gi, ' ');
      s = s.replace(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g, ' ');
      s = s.replace(/[_]+/g, ' ');
      s = s.replace(/\s*[-–—]+\s*/g, ' – ');
      const parts = s.split('–').map(x => U.clean(x)).filter(Boolean);
      if (parts.length > 1) s = parts[parts.length - 1];
      const drop = /\b(petition|reply|rejoinder|application|notice|order|judgment|plaint|written\s+statement|affidavit|evidence|vakalatnama|draft|list|exhibits?|document|legal)\b/gi;
      s = U.clean(s.replace(drop, ' ').replace(/\s+/g, ' '));
      s = s.replace(/^[\s\-–—,:]+|[\s\-–—,:]+$/g, '');
      return U.titleCase(s.slice(0, 80));
    },

    classify(input) {
      const name = input.name || '';
      const text = input.text || '';
      const type = Docs.detectType(name, text);
      const courtHit = Docs.detectCourt(name, text);
      const matter = LJ.matchMatter(name + ' ' + text.slice(0, 6000), Repo.data.matters) ||
        LJ.matchMatter(name.replace(/[-_.]/g, ' '), Repo.data.matters);
      const dateOnDoc = Docs.findDate((name + ' ' + text.slice(0, 6000)));
      const guessed = Docs.guessCaseFromName(name);
      const meta = {
        type,
        typeHi: I.typeHi(type),
        matterId: matter ? matter.id : null,
        caseTitle: matter ? matter.title : (guessed || 'Unsorted'),
        caseTitleHi: matter ? (matter.titleHi || '') : '',
        client: matter ? (matter.client || '') : (guessed || ''),
        clientHi: matter ? (matter.clientHi || '') : '',
        court: matter ? matter.court : (courtHit ? courtHit.court : 'Unsorted'),
        courtHi: matter ? (matter.courtHi || '') : (courtHit ? courtHit.courtHi : ''),
        courtType: matter ? (matter.courtType || '') : (courtHit ? courtHit.courtType : ''),
        confidence: matter ? 'high' : (courtHit ? 'medium' : 'low'),
        dateOnDoc,
        status: Docs.detectStatus(name),
        lang: /[\u0900-\u097F]/.test(text.slice(0, 3000)) ? 'hi' : 'en'
      };
      meta.folder = Docs.folderFor(meta);
      return meta;
    },

    folderFor(meta) {
      const court = U.sanitizePath(meta.court || 'Unsorted', 'Unsorted');
      let casePart = U.sanitizePath(meta.caseTitle || 'Unsorted', 'Unsorted');
      if (meta.client && !casePart.toLowerCase().includes(String(meta.client).toLowerCase().slice(0, 12))) {
        casePart += ' - ' + U.sanitizePath(meta.client, 'Client');
      }
      const type = U.sanitizePath(meta.type || 'Other', 'Other');
      return court + '/' + casePart + '/' + type;
    },

    /* ---------------- import ---------------- */
    async importFiles(items, opts = {}) {
      const total = items.length;
      let done = 0, added = 0, skipped = 0, failed = 0;
      const results = [];
      for (const item of items) {
        done++;
        const name = item.name || item.displayName || 'Untitled';
        try {
          if (Docs.onProgress) Docs.onProgress({ done, total, name, stage: 'reading' });
          if (Docs.isDuplicate(item)) { skipped++; results.push({ skipped: true, name }); continue; }

          let text = '', pages = null, blob = null, uri = null, size = item.size || 0, lastModified = item.lastModified || Date.now();
          if (item instanceof File) {
            blob = item;
            size = item.size;
            lastModified = item.lastModified || Date.now();
            const ex = await Docs.extractTextClient(item);
            text = ex.text || ''; pages = ex.pages;
          } else if (item.uri) {
            uri = item.uri;
            const ex = await Docs.extractTextNative(uri);
            text = ex.text || ''; pages = ex.pages;
          }
          if (Docs.onProgress) Docs.onProgress({ done, total, name, stage: 'filing' });

          const meta = Docs.classify({ name, text, size, lastModified });
          const ext = Docs.extensionOf(name) || 'file';
          let relPath = meta.folder + '/' + U.sanitizePath(name, 'Document');
          let stored = null;
          if (uri) {
            try { stored = await Bridge.importFile(uri, relPath); relPath = stored.relPath || relPath; }
            catch (e) { console.warn('archive copy failed', e); relPath = ''; }
          }
          const doc = {
            id: U.uid('doc'),
            name,
            nameHi: I.isHindiText(name) ? name : '',
            ext,
            size: stored && stored.size ? stored.size : size,
            pages,
            lastModified: U.isoOf(new Date(lastModified)),
            addedAt: new Date().toISOString(),
            text,
            excerpt: U.clean(text).slice(0, 280),
            blob: uri ? null : blob,
            uri: uri || null,
            relPath: relPath || null,
            storage: uri ? (relPath ? 'archive' : 'linked') : 'tablet',
            folder: meta.folder,
            sourceFolder: item.relativePath || item.webkitRelativePath || '',
            source: opts.source || (uri ? 'import' : 'tablet'),
            sample: false,
            hiContent: meta.lang === 'hi',
            matterId: meta.matterId,
            caseTitle: meta.caseTitle,
            caseTitleHi: meta.caseTitleHi,
            client: meta.client,
            clientHi: meta.clientHi,
            court: meta.court,
            courtHi: meta.courtHi,
            courtType: meta.courtType,
            type: meta.type,
            typeHi: meta.typeHi,
            confidence: meta.confidence,
            dateOnDoc: meta.dateOnDoc,
            status: meta.status,
            lang: meta.lang
          };
          if (meta.matterId) {
            const m = Repo.matter(meta.matterId);
            if (m && m.court) { doc.court = m.court; doc.courtHi = m.courtHi || doc.courtHi; }
          }
          await Repo.saveDocument(doc);
          added++;
          results.push({ added: true, name, doc });
        } catch (e) {
          console.error('import error', name, e);
          failed++;
          results.push({ error: true, name, message: String(e.message || e) });
        }
        if (Docs.onProgress) Docs.onProgress({ done, total, name, stage: 'done' });
      }
      return { total, added, skipped, failed, results };
    },

    isDuplicate(item) {
      const name = item.name || item.displayName || '';
      const size = item.size;
      const lastModified = item.lastModified;
      return Repo.data.documents.some(d => {
        if (d.sample) return false;
        if (d.name !== name) return false;
        if (size != null && d.size != null && Math.abs((d.size || 0) - size) > 1024) return false;
        if (lastModified && d.lastModified) {
          const diff = Math.abs(new Date(d.lastModified).getTime() - lastModified);
          if (diff > 86400000 * 2) return false;
        }
        return true;
      });
    },

    /* ---------------- search ---------------- */
    interpretQuery(q) {
      const query = String(q || '');
      let type = null;
      const low = ' ' + query.toLowerCase() + ' ';
      let bestScore = 0;
      I.TYPE_RULES.forEach(rule => {
        rule.words.forEach(w => {
          if (low.includes(w.toLowerCase()) && w.length > bestScore) { bestScore = w.length; type = rule.type; }
        });
      });
      const matter = RevMatter(query);
      let since = null;
      if (/yesterday|कल\s*का|बीता|kal\s*/i.test(query)) since = 'yesterday';
      if (/today|आज|aaj/i.test(query)) since = 'today';
      if (/last week|पिछले सप्ताह|pichhle hafte/i.test(query)) since = 'week';
      if (/this week|इस सप्ताह|is hafte/i.test(query)) since = 'thisweek';
      return { type, matter, since, newest: /latest|newest|last|recent|नवीनतम|ताज़ा|आखिरी|aakhri|latest/i.test(query) };
    },

    search(q, opts = {}) {
      const query = String(q || '');
      const nq = query.trim();
      const it = Docs.interpretQuery(nq);
      let docs = Repo.data.documents.slice();
      if (opts.matterId) docs = docs.filter(d => d.matterId === opts.matterId);
      if (opts.court) docs = docs.filter(d => d.court === opts.court);
      if (opts.type) docs = docs.filter(d => d.type === opts.type);

      const today = U.todayISO();
      if (it.since) {
        const lim = it.since === 'today' ? today :
          it.since === 'yesterday' ? U.isoOf(U.addDays(today, -1)) :
            it.since === 'week' ? U.isoOf(U.addDays(today, -7)) : U.isoOf(U.addDays(today, 0));
        docs = docs.filter(d => {
          const day = (d.lastModified || (d.addedAt || '').slice(0, 10));
          if (it.since === 'yesterday') return day === lim;
          return day >= lim && day <= today;
        });
      }
      if (it.type) docs = docs.filter(d => d.type === it.type || (it.type === 'Reply' && d.type === 'Rejoinder'));
      if (it.matter) docs = docs.filter(d => d.matterId === it.matter.id);

      const scored = docs.map(d => {
        let s = 0;
        if (!nq) s = 1;
        s += LJ.scoreText(nq, d.name || '') * 2.2;
        s += LJ.scoreText(nq, d.nameHi || '') * 2.2;
        s += LJ.scoreText(nq, d.caseTitle || '') * 1.6;
        s += LJ.scoreText(nq, d.caseTitleHi || '') * 1.6;
        s += LJ.scoreText(nq, d.client || '') * 1.5;
        s += LJ.scoreText(nq, d.clientHi || '') * 1.5;
        s += LJ.scoreText(nq, d.court || '') * 0.8;
        s += LJ.scoreText(nq, d.type || '') * 1.2;
        s += LJ.scoreText(nq, (d.text || '').slice(0, 8000)) * 0.7;
        s += LJ.scoreText(nq, d.excerpt || '') * 0.9;
        if (it.type && d.type === it.type) s += 14;
        if (it.type && d.type === 'Rejoinder' && it.type === 'Reply') s += 8;
        if (it.matter && d.matterId === it.matter.id) s += 24;
        if (/latest|newest|recent|नवीनतम|ताज़ा/i.test(nq)) {
          const day = d.lastModified || '';
          const ago = U.daysBetween(day, today);
          s += Math.max(0, 12 - ago) * 1.6;
        }
        return { doc: d, score: s };
      }).filter(x => (nq ? x.score > 0.8 : true));

      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(b.doc.lastModified || '').localeCompare(String(a.doc.lastModified || ''));
      });
      return scored.map(x => x.doc);
    },

    bestMatch(q) {
      const all = Docs.search(q);
      return all.length ? all[0] : null;
    },

    /* ---------------- housekeeping ---------------- */
    async linkToMatter(docId, matterId) {
      const d = Repo.document(docId);
      const m = Repo.matter(matterId);
      if (!d || !m) return null;
      const old = d.relPath;
      d.matterId = m.id;
      d.caseTitle = m.title;
      d.caseTitleHi = m.titleHi || '';
      d.client = m.client || '';
      d.clientHi = m.clientHi || '';
      d.court = m.court;
      d.courtHi = m.courtHi || '';
      d.folder = Docs.folderFor(d);
      if (old) {
        const newPath = d.folder + '/' + U.sanitizePath(d.name, 'Document');
        try {
          if (Bridge.available && Bridge.moveFile) await Bridge.moveFile(old, newPath);
          d.relPath = newPath;
        } catch (e) { /* keep original path if move unavailable */ }
      }
      await Repo.saveDocument(d);
      return d;
    },

    stats() {
      const docs = Repo.data.documents;
      const byType = {};
      const byCourt = {};
      docs.forEach(d => {
        byType[d.type || 'Other'] = (byType[d.type || 'Other'] || 0) + 1;
        byCourt[d.court || 'Unsorted'] = (byCourt[d.court || 'Unsorted'] || 0) + 1;
      });
      return {
        total: docs.length,
        linked: docs.filter(d => d.matterId).length,
        unlinked: docs.filter(d => !d.matterId).length,
        drafts: docs.filter(d => d.status === 'in-progress').length,
        byType, byCourt
      };
    },

    docAge(d) { return d.lastModified || (d.addedAt || '').slice(0, 10); }
  };

  function RevMatter(q) {
    const direct = LJ.matchMatter(q, Repo.data.matters);
    if (direct) return direct;
    // "Sharma case" → try progressively shorter windows
    const words = String(q || '').split(/\s+/).filter(Boolean);
    for (let span = Math.min(5, words.length); span >= 2; span--) {
      for (let i = 0; i + span <= words.length; i++) {
        const m = LJ.matchMatter(words.slice(i, i + span).join(' '), Repo.data.matters);
        if (m) return m;
      }
    }
    return null;
  }

  Docs.revMatter = RevMatter;
  Docs.readBlob = readBlob;
  window.LJ.Docs = Docs;
})();
