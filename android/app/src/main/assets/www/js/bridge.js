/* ============================================================
   Legal Jarvis — bridge between the WebView console and Android
   Falls back gracefully so the same UI runs in a browser preview.
   ============================================================ */
(function () {
  'use strict';
  const U = LJ.Utils;

  const Native = {
    api: window.NativeBridge || null,
    available: !!(window.NativeBridge && window.NativeBridge.call),
    pending: new Map(),
    listeners: {},
    seq: 0,
    info: null,

    on(evt, fn) {
      (Native.listeners[evt] = Native.listeners[evt] || []).push(fn);
      return () => { Native.listeners[evt] = (Native.listeners[evt] || []).filter(f => f !== fn); };
    },
    emit(evt, payload) {
      (Native.listeners[evt] || []).forEach(fn => {
        try { fn(payload); } catch (e) { console.warn('listener', evt, e); }
      });
    },

    call(method, params = {}, timeout = 20000) {
      if (!Native.available) return Promise.reject(new Error('native-unavailable'));
      return new Promise((resolve, reject) => {
        const id = 'r' + (++Native.seq);
        const timer = setTimeout(() => {
          Native.pending.delete(id);
          reject(new Error('Timeout: ' + method));
        }, timeout);
        Native.pending.set(id, { resolve, reject, timer, method });
        try {
          const ret = Native.api.call(method, JSON.stringify(Object.assign({ id }, params)));
          if (ret && typeof ret === 'string' && ret.trim().startsWith('{')) {
            let j = null;
            try { j = JSON.parse(ret); } catch (e) { j = null; }
            if (j && j.ok === false) {
              clearTimeout(timer);
              Native.pending.delete(id);
              reject(new Error(j.error || 'Native error'));
            }
          }
        } catch (e) {
          clearTimeout(timer);
          Native.pending.delete(id);
          reject(e);
        }
      });
    },

    handle(payload) {
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch (e) { return; }
      }
      if (!payload) return;
      if (payload.event) { Native.emit(payload.event, payload.data || payload); return; }
      if (payload.id && Native.pending.has(payload.id)) {
        const p = Native.pending.get(payload.id);
        Native.pending.delete(payload.id);
        clearTimeout(p.timer);
        if (payload.ok === false) p.reject(new Error(payload.error || 'Native error'));
        else p.resolve(payload.data != null ? payload.data : payload);
        return;
      }
      if (payload.method) Native.emit(payload.method, payload.data || payload);
    },

    async init() {
      if (!Native.available) {
        Native.info = { platform: 'web', hasTts: 'speechSynthesis' in window, hasRecognizer: !!(window.SpeechRecognition || window.webkitSpeechRecognition) };
        return Native.info;
      }
      try {
        Native.info = await Native.call('info', {}, 8000);
      } catch (e) {
        Native.info = { platform: 'native', hasTts: true, hasRecognizer: true, error: String(e.message || e) };
      }
      return Native.info;
    },

    /* ---------- speech out ---------- */
    voices() {
      if (Native.available) {
        return Native.call('voices', {}, 8000).then(r => (r && r.voices) || []).catch(() => []);
      }
      return new Promise(resolve => {
        const pick = () => (window.speechSynthesis ? speechSynthesis.getVoices() : []).map(v => ({
          name: v.name, locale: v.lang, local: v.localService, quality: v.default ? 'default' : ''
        })).filter(v => /^en|^hi/i.test(v.locale));
        let list = pick();
        if (list.length) return resolve(list);
        if (!window.speechSynthesis) return resolve([]);
        const t = setTimeout(() => resolve(pick()), 900);
        speechSynthesis.onvoiceschanged = () => { clearTimeout(t); resolve(pick()); };
      });
    },

    _webSpeaker: null,
    _webQueue: Promise.resolve(),

    speak(text, opts = {}) {
      const lang = opts.lang || 'en-GB';
      const clean = String(text || '').replace(/\s+/g, ' ').trim();
      if (!clean) return Promise.resolve();
      if (Native.available) {
        return Native.call('speak', {
          text: clean, lang,
          rate: opts.rate != null ? opts.rate : LJ.Settings.get('speechRate'),
          pitch: opts.pitch != null ? opts.pitch : LJ.Settings.get('speechPitch'),
          volume: opts.volume != null ? opts.volume : LJ.Settings.get('speechVolume'),
          voice: opts.voice != null ? opts.voice : LJ.Settings.get('voiceName')
        }, 120000).catch(err => { console.warn('tts', err); });
      }
      if (!window.speechSynthesis) return new Promise(r => setTimeout(r, Math.min(9000, clean.length * 55)));
      return new Promise(resolve => {
        let settled = false;
        const finish = () => { if (settled) return; settled = true; Native.emit('ttsEnd', {}); resolve(); };
        const utter = new SpeechSynthesisUtterance(clean);
        utter.lang = lang;
        utter.rate = opts.rate != null ? opts.rate : LJ.Settings.get('speechRate');
        utter.pitch = opts.pitch != null ? opts.pitch : LJ.Settings.get('speechPitch');
        utter.volume = opts.volume != null ? opts.volume : LJ.Settings.get('speechVolume');
        const voices = speechSynthesis.getVoices();
        const wanted = opts.voice || LJ.Settings.get('voiceName');
        let v = voices.find(x => x.name === wanted);
        if (!v && wanted) v = voices.find(x => x.name.toLowerCase().includes(String(wanted).toLowerCase()));
        if (!v && /^en/i.test(lang)) {
          v = voices.find(x => /en[-_]GB/i.test(x.lang) && /male|daniel|arthur|george|oliver|ryan/i.test(x.name)) ||
            voices.find(x => /en[-_]GB/i.test(x.lang)) ||
            voices.find(x => /Google UK English Male/i.test(x.name)) ||
            voices.find(x => /^en/i.test(x.lang));
        }
        if (!v && /^hi/i.test(lang)) v = voices.find(x => /^hi/i.test(x.lang));
        if (v) utter.voice = v;
        utter.onstart = () => Native.emit('ttsStart', { text: clean });
        utter.onend = finish;
        utter.onerror = finish;
        Native.emit('ttsStart', { text: clean });
        speechSynthesis.cancel();
        setTimeout(() => speechSynthesis.speak(utter), 60);
        const maxMs = Math.max(6000, clean.length * 95);
        setTimeout(finish, maxMs);
      });
    },

    stopSpeaking() {
      if (Native.available) { Native.call('stopSpeak', {}, 5000).catch(() => {}); return; }
      if (window.speechSynthesis) speechSynthesis.cancel();
      Native.emit('ttsEnd', {});
    },

    /* ---------- speech in ---------- */
    listen(opts = {}) {
      const lang = opts.lang || 'en-IN';
      if (Native.available) {
        Native.call('listen', { lang, continuous: !!opts.continuous }, 15000).catch(e => {
          Native.emit('speech', { type: 'error', error: String(e.message || e), lang });
        });
        return;
      }
      const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Rec) {
        Native.emit('speech', { type: 'error', error: 'no-recognizer', lang });
        return;
      }
      try {
        if (Native._webRec) { try { Native._webRec.abort(); } catch (e) {} }
        const r = new Rec();
        Native._webRec = r;
        r.lang = lang;
        r.interimResults = true;
        r.continuous = !!opts.continuous;
        r.maxAlternatives = 1;
        r.onresult = ev => {
          let interim = '', final = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const t = ev.results[i][0].transcript;
            if (ev.results[i].isFinal) final += t; else interim += t;
          }
          if (interim) Native.emit('speech', { type: 'partial', text: interim, lang });
          if (final) Native.emit('speech', { type: 'final', text: final, lang });
        };
        r.onerror = ev => {
          Native.emit('speech', { type: 'error', error: ev.error || 'recognizer-error', lang });
        };
        r.onend = () => { Native.emit('speech', { type: 'end', lang }); Native._webRec = null; };
        r.start();
      } catch (e) {
        Native.emit('speech', { type: 'error', error: String(e.message || e), lang });
      }
    },

    stopListening() {
      if (Native.available) { Native.call('stopListen', {}, 5000).catch(() => {}); return; }
      if (Native._webRec) { try { Native._webRec.stop(); } catch (e) {} }
    },

    micPermission(request) {
      if (Native.available) return Native.call('micPermission', { request: !!request }, 60000).then(r => !!(r && r.granted)).catch(() => false);
      return Promise.resolve(true);
    },

    /* ---------- files ---------- */
    pickFiles(multiple = true) {
      if (Native.available) return Native.call('pickFiles', { multiple }, 300000);
      return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = multiple;
        input.accept = '.pdf,.doc,.docx,.txt,.rtf,.png,.jpg,.jpeg,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/*';
        input.style.display = 'none';
        document.body.appendChild(input);
        let settled = false;
        input.onchange = () => {
          settled = true;
          resolve({ files: Array.from(input.files || []), web: true, picked: true });
          input.remove();
        };
        input.oncancel = () => { if (!settled) { resolve({ files: [], cancelled: true }); input.remove(); } };
        input.click();
      });
    },

    pickFolder() {
      if (Native.available) return Native.call('pickFolder', {}, 600000);
      return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.webkitdirectory = true;
        input.style.display = 'none';
        document.body.appendChild(input);
        input.onchange = () => resolve({ files: Array.from(input.files || []), web: true, picked: true });
        input.oncancel = () => resolve({ files: [], cancelled: true });
        input.click();
      });
    },

    scanDevice() {
      if (Native.available) return Native.call('scanDevice', {}, 300000).then(r => r || { files: [] }).catch(e => ({ files: [], error: String(e.message || e) }));
      return Promise.resolve({ files: [], unavailable: true });
    },

    exactAlarmPermission() {
      if (Native.available) return Native.call('setExactAlarmPermission', {}, 30000).then(r => r || {}).catch(() => ({}));
      return Promise.resolve({});
    },

    storagePermission() {
      if (Native.available) return Native.call('storagePermission', {}, 120000).then(r => r || { granted: false }).catch(() => ({ granted: false }));
      return Promise.resolve({ granted: false, unavailable: true });
    },

    scanFolder(treeUri) {
      if (Native.available) return Native.call('scanFolder', { treeUri }, 600000);
      return Promise.resolve({ files: [] });
    },

    extractText(fileOrUri) {
      if (Native.available) {
        const uri = typeof fileOrUri === 'string' ? fileOrUri : fileOrUri.uri;
        return Native.call('extractText', { uri }, 180000).then(r => r || {});
      }
      return Promise.resolve({ text: '', unresolved: true });
    },

    importFile(uri, relPath) {
      if (Native.available) return Native.call('importFile', { uri, relPath }, 300000).then(r => r || {});
      return Promise.resolve({ relPath, web: true });
    },

    openFile(rec) {
      if (Native.available && rec && rec.relPath) {
        return Native.call('openFile', { relPath: rec.relPath, mime: LJ.Docs.mimeOf(rec.ext) }, 30000);
      }
      return Promise.reject(new Error('preview-only'));
    },
    shareFile(rec) {
      if (Native.available && rec && rec.relPath) {
        return Native.call('shareFile', { relPath: rec.relPath, mime: LJ.Docs.mimeOf(rec.ext) }, 30000);
      }
      if (navigator.share) return navigator.share({ title: rec.name, text: rec.name }).catch(() => {});
      return Promise.reject(new Error('sharing-unavailable'));
    },
    moveFile(from, to) {
      if (Native.available) return Native.call('moveFile', { from, to }, 60000);
      return Promise.resolve(true);
    },
    deleteArchiveFile(rec) {
      if (Native.available && rec && rec.relPath) return Native.call('deleteFile', { relPath: rec.relPath }, 20000).catch(() => {});
      return Promise.resolve();
    },
    renderPdf(rec, page = 1, width = 1100) {
      if (Native.available && rec && rec.relPath) {
        return Native.call('renderPdf', { relPath: rec.relPath, page, width }, 60000).then(r => (r && r.dataUrl) || null);
      }
      return Promise.resolve(null);
    },
    readFileBase64(rec) {
      if (Native.available && rec && rec.relPath) return Native.call('readFile', { relPath: rec.relPath }, 120000).then(r => (r && r.base64) || null);
      return Promise.resolve(null);
    },

    /* ---------- notifications & alarms ---------- */
    async requestNotifications() {
      if (Native.available) return Native.call('notifyPermission', { request: true }, 30000).then(r => !!(r && r.granted)).catch(() => false);
      if (!('Notification' in window)) return false;
      if (Notification.permission === 'granted') return true;
      try { return (await Notification.requestPermission()) === 'granted'; } catch (e) { return false; }
    },
    scheduleAlarm(rem) {
      if (!rem || !rem.date) return Promise.resolve(false);
      const at = new Date(rem.date + 'T' + (rem.time || '09:00') + ':00').getTime();
      if (isNaN(at) || at < Date.now()) return Promise.resolve(false);
      if (Native.available) {
        return Native.call('scheduleAlarm', {
          id: rem.id, at, title: rem.title,
          body: rem.matterId && LJ.Repo.matter(rem.matterId) ? LJ.Repo.matter(rem.matterId).title : 'Legal Jarvis',
          kind: rem.kind || 'reminder'
        }, 15000).then(r => !!(r && r.ok !== false)).catch(() => false);
      }
      const wait = at - Date.now();
      if (wait < 86400000) setTimeout(() => Bridge.notifyNow(rem.title, 'Chamber reminder'), wait);
      return Promise.resolve(true);
    },
    cancelAlarm(id) {
      if (Native.available) return Native.call('cancelAlarm', { id }, 10000).catch(() => {});
      return Promise.resolve();
    },
    setDailyBrief(morning, evening, enabled, morningText, eveningText) {
      if (Native.available) return Native.call('setDailyBrief', {
        morning, evening, enabled: !!enabled,
        morningText: morningText || '', eveningText: eveningText || ''
      }, 15000).catch(() => {});
      return Promise.resolve();
    },
    notifyNow(title, body) {
      if (Native.available) return Native.call('notifyNow', { title, body }, 10000).catch(() => {});
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification(title, { body, icon: 'img/icon.svg' }); } catch (e) {}
      }
      return Promise.resolve();
    },

    /* ---------- app utility ---------- */
    saveBackup(filename, text) {
      if (Native.available) return Native.call('saveBackup', { filename, text }, 60000);
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return Promise.resolve({ ok: true });
    },
    pickBackup(opts = {}) {
      if (Native.available) return Native.call('pickBackup', { mime: opts.mime || '.json,application/json' }, 300000);
      return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = opts.mime || '.json,application/json';
        input.onchange = async () => {
          const f = input.files && input.files[0];
          if (!f) return resolve({ cancelled: true });
          resolve({ name: f.name, text: await f.text() });
        };
        input.oncancel = () => resolve({ cancelled: true });
        input.click();
      });
    },
    exportArchive() {
      if (Native.available) return Native.call('exportArchive', {}, 300000);
      return Promise.reject(new Error('native-only'));
    },
    openArchiveFolder() {
      if (Native.available) return Native.call('openArchiveFolder', {}, 15000);
      return Promise.reject(new Error('native-only'));
    },
    rescanPending() {
      if (Native.available) return Native.call('pendingImports', {}, 15000).catch(() => ({ files: [] }));
      return Promise.resolve({ files: [] });
    },

    chime(kind) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = Native._audio || (Native._audio = new Ctx());
        const now = ctx.currentTime;
        [660, 880].forEach((f, i) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = kind === 'off' ? f / 2 : f;
          g.gain.setValueAtTime(0, now + i * 0.09);
          g.gain.linearRampToValueAtTime(0.06, now + i * 0.09 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.34);
          o.connect(g); g.connect(ctx.destination);
          o.start(now + i * 0.09); o.stop(now + i * 0.09 + 0.4);
        });
      } catch (e) {}
    }
  };

  window.JarvisNative = {
    dispatch(payload) { Native.handle(payload); }
  };

  window.LJ.Bridge = Native;
})();
