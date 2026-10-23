/* ============================================================
   Legal Jarvis — app shell, conversation, voice interaction
   ============================================================ */
(function () {
  'use strict';
  const U = LJ.Utils;
  const S = LJ.Settings;
  const Repo = LJ.Repo;
  const I = LJ.I18N;
  const J = LJ.Jarvis;
  const Bridge = LJ.Bridge;
  const Docs = LJ.Docs;

  const VIEW_META = {
    command: { title: 'Command', eyebrow: 'Chamber console' },
    overview: { title: 'Overview', eyebrow: 'The chamber at a glance' },
    matters: { title: 'Matters', eyebrow: 'Master case register' },
    diary: { title: 'Diary', eyebrow: 'Cause list & reminders' },
    documents: { title: 'Documents', eyebrow: 'Case-wise archive' },
    settings: { title: 'Setup', eyebrow: 'Chamber preferences' }
  };

  const App = {
    state: {
      view: 'command',
      diaryTab: 'upcoming',
      calMonth: null,
      calSelected: U.todayISO(),
      matterFilter: 'active',
      matterSearch: '',
      docGroup: 'case',
      docSearch: '',
      docCourt: '',
      docType: '',
      thread: [],
      speaking: false,
      hudLang: null,
      importing: false,
      booted: false,
      speakDraft: false
    },
    els: {},
    listen: { active: false, final: '', lang: 'en-IN', timer: null, autoRestart: false },
    muted: false,
    _alarmTimer: null,

    /* ---------------- boot ---------------- */
    async init() {
      if (App._booting || App._booted) return;
      App._booting = true;
      App.els = {
        viewTitle: document.getElementById('viewTitle'),
        viewEyebrow: document.getElementById('viewEyebrow'),
        clockTime: document.getElementById('clockTime'),
        clockDate: document.getElementById('clockDate'),
        stageGreet: document.getElementById('stageGreet'),
        stageStatus: document.getElementById('stageStatus'),
        stageStats: document.getElementById('stageStats'),
        stageChips: document.getElementById('stageChips'),
        reactor: document.getElementById('reactor'),
        thread: document.getElementById('thread'),
        commandInput: document.getElementById('commandInput'),
        overviewBody: document.getElementById('overviewBody'),
        mattersBody: document.getElementById('mattersBody'),
        diaryBody: document.getElementById('diaryBody'),
        documentsBody: document.getElementById('documentsBody'),
        settingsBody: document.getElementById('settingsBody'),
        docStorageNote: document.getElementById('docStorageNote'),
        modalRoot: document.getElementById('modalRoot'),
        toastRoot: document.getElementById('toastRoot'),
        hud: document.getElementById('hud'),
        hudTitle: document.getElementById('hudTitle'),
        hudText: document.getElementById('hudText'),
        speakToggle: document.getElementById('speakToggle'),
        matterSearch: document.getElementById('matterSearch'),
        matterFilter: document.getElementById('matterFilter'),
        docSearch: document.getElementById('docSearch'),
        docCourtFilter: document.getElementById('docCourtFilter'),
        docTypeFilter: document.getElementById('docTypeFilter')
      };

      try { await Repo.load(); } catch (e) {
        console.error(e);
        App.toast('Local database could not be opened. Please restart the app.', 'err', 7000);
      }
      if (!S.get('seeded')) {
        try { await LJ.seedDemoIfNeeded(); } catch (e) { console.warn('seed failed', e); }
      }
      App.muted = !S.get('autoSpeak');
      App.syncSpeakToggle();
      App.bind();
      App.applyLangUI();
      App.nav('command', { silent: true });
      App.renderStage();
      App.renderThreadFromStore();
      App.renderTopClock();
      setInterval(App.renderTopClock, 1000);
      setInterval(App.checkDueReminders, 45000);
      App.renderAll();
      Bridge.init().then(info => {
        App.els.stageHint && (App.els.stageHint.textContent = (info && info.platform === 'native')
          ? 'On-device archive · Tap the microphone or type · English & हिंदी'
          : 'Tap the microphone or type · English & हिंदी');
        App.renderSettings();
      });
      Bridge.on('ttsStart', () => { App.setReactor('speaking'); App.state.speaking = true; });
      Bridge.on('ttsEnd', () => { App.setReactor(App.listen.active ? 'listening' : 'idle'); App.state.speaking = false; });
      Bridge.on('speech', App.onSpeech);
      Bridge.on('speechState', d => { if (d && d.listening) App.setReactor('listening'); });
      Bridge.on('share', App.onSharedFiles);
      Bridge.on('resume', App.onResume);
      Bridge.on('openBrief', d => App.giveBrief(d && d.kind));
      Bridge.on('openView', d => { if (d && d.view) App.nav(d.view); });
      Bridge.on('nativeToast', d => App.toast(d && d.message || 'Done', 'ok'));
      App.scheduleAlarms();
      App.setupDailyBriefs();
      App.booted = true;
      App._booted = true;
      App._booting = false;
      window.__ljBooted = true;
      const bootErr = document.getElementById('bootError');
      if (bootErr) bootErr.hidden = true;
      App.showWelcome();
      setTimeout(App.maybeAutoBrief, 1200);
      window.addEventListener('beforeunload', () => { try { Bridge.stopSpeaking(); } catch (e) {} });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') App.checkDueReminders();
      });
    },

    bind() {
      document.addEventListener('click', App.onClick);
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') App.closeTopSheet();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && document.activeElement === App.els.commandInput) {
          App.submitCommand(App.els.commandInput.value);
        }
      });
      const send = () => App.submitCommand(App.els.commandInput.value);
      App.els.commandInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      });
      document.querySelectorAll('.rail-btn').forEach(b => {
        b.addEventListener('click', () => App.nav(b.dataset.nav));
      });
      document.querySelectorAll('[data-langmode]').forEach(b => {
        b.addEventListener('click', () => App.setLang(b.dataset.langmode));
      });
      document.getElementById('diaryTabs') && document.getElementById('diaryTabs').addEventListener('click', e => {
        const b = e.target.closest('[data-tab]');
        if (!b) return;
        App.state.diaryTab = b.dataset.tab;
        document.querySelectorAll('#diaryTabs button').forEach(x => x.classList.toggle('is-active', x === b));
        LJ.Views.renderDiary();
      });
      const dg = document.getElementById('docGroupToggle');
      if (dg) dg.addEventListener('click', e => {
        const b = e.target.closest('[data-group]');
        if (!b) return;
        App.state.docGroup = b.dataset.group;
        document.querySelectorAll('#docGroupToggle button').forEach(x => x.classList.toggle('is-active', x === b));
        LJ.DocsUI.render();
      });
      App.els.matterSearch.addEventListener('input', U.debounce(e => {
        App.state.matterSearch = e.target.value;
        LJ.Views.renderMatters();
      }, 160));
      App.els.matterFilter.addEventListener('change', e => {
        App.state.matterFilter = e.target.value;
        LJ.Views.renderMatters();
      });
      App.els.docSearch.addEventListener('input', U.debounce(e => {
        App.state.docSearch = e.target.value;
        App.state.docQuick = '';
        LJ.DocsUI.render();
      }, 180));
      App.els.docCourtFilter.addEventListener('change', e => {
        App.state.docCourt = e.target.value;
        LJ.DocsUI.render();
      });
      App.els.docTypeFilter.addEventListener('change', e => {
        App.state.docType = e.target.value;
        LJ.DocsUI.render();
      });
      document.getElementById('speakToggle').addEventListener('click', () => App.toggleSpeak());
      document.getElementById('hudLangEn') && document.getElementById('hudLangEn').addEventListener('click', () => App.setHudLang('en-IN'));
      document.getElementById('hudLangHi') && document.getElementById('hudLangHi').addEventListener('click', () => App.setHudLang('hi-IN'));
      window.addEventListener('resize', U.debounce(() => { if (App.state.view === 'diary') LJ.Views.renderDiary(); }, 250));
    },

    onClick(e) {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      e.preventDefault();
      let payload = {};
      if (el.dataset.payload) {
        try { payload = JSON.parse(decodeURIComponent(el.dataset.payload)); } catch (err) { payload = {}; }
      }
      Object.keys(el.dataset).forEach(k => { if (k !== 'payload') payload[k] = el.dataset[k]; });
      App.run(el.dataset.action, payload, el);
    },

    run(action, p = {}, el) {
      if (!action) return;
      switch (action) {
        case 'listen': return App.startListening();
        case 'stop-listen': return App.finishListening(true);
        case 'close-hud': return App.cancelListening();
        case 'toggle-speak': return App.toggleSpeak();
        case 'send-command': return App.submitCommand(App.els.commandInput.value);
        case 'clear-chat': return App.clearThread();
        case 'nav': return App.nav(p.view || p.id);
        case 'lang': return App.setLang(p.mode || p.id);
        case 'lang-en': return App.setLang('en');
        case 'lang-hi': return App.setLang('hi');
        case 'lang-auto': return App.setLang('auto');
        case 'close-sheet': return App.closeSheet(el && el.closest('.modal-root'));
        case 'noop': return;
        case 'brief': return App.giveBrief();
        case 'tomorrow': return App.talk(J.causeList('tomorrow'));
        case 'today': return App.talk(J.causeList('today'));
        case 'tasks': return App.talk(J.taskSummary(), { openView: 'overview' });
        case 'deadlines': return App.talk(J.deadlineSummary());
        case 'drafts': return App.talk(J.draftSummary(), { openView: 'documents', filterDrafts: true });
        case 'help': return App.talk(J.helpReply());
        case 'carry': return App.talk(J.carryFor(p.when || 'tomorrow'));
        case 'diary': return App.nav('diary');
        case 'matters': return App.nav('matters');
        case 'documents': return App.nav('documents');
        case 'settings': return App.nav('settings');
        case 'overview': return App.nav('overview');
        case 'open-matter': return LJ.Views.openMatter(p.id);
        case 'edit-matter': return LJ.Views.openCaseForm(p.id || null, true);
        case 'new-case': case 'open-add-case': return LJ.Views.openCaseForm(null, false, p.prefill || p);
        case 'delete-matter': return App.confirmDeleteMatter(p.id);
        case 'new-hearing': return LJ.Views.openHearingForm(p.id || (p.prefill && p.prefill.matterId), p.prefill || {});
        case 'edit-hearing': return LJ.Views.openHearingForm(p.matterId, { id: p.id });
        case 'delete-hearing': return App.confirmDelete('hearing', p.id);
        case 'new-task': return LJ.Views.openTaskForm(p.id || (p.prefill && p.prefill.matterId), p.prefill || {});
        case 'edit-task': return LJ.Views.openTaskForm(p.matterId, { id: p.id });
        case 'done-task': return App.markTaskDone(p.id);
        case 'toggle-task': return App.toggleTask(p.id);
        case 'delete-task': return App.confirmDelete('task', p.id);
        case 'new-reminder': return LJ.Views.openReminderForm(p.prefill || p);
        case 'edit-reminder': return LJ.Views.openReminderForm({ id: p.id });
        case 'delete-reminder': return App.confirmDelete('reminder', p.id);
        case 'dismiss-reminder': return App.dismissReminder(p.id);
        case 'open-doc': return LJ.DocsUI.open(p.id);
        case 'search-docs': return App.talk(J.docListReply(p.query || p.q || ''));
        case 'import-files': return App.startImport('files');
        case 'import-folder': return App.startImport('folder');
        case 'import-drive': return App.startImport('files');
        case 'import-ecourts': return App.openEcourtsImport();
        case 'rescan-folders': return App.rescanLinked();
        case 'scan-device': return App.scanDevice();
        case 'scan-grant': return App.scanGrant();
        case 'scan-now': return App.scanNow();
        case 'exact-alarm': return App.exactAlarm();
        case 'pick-ecourts': return App.pickEcourts();
        case 'confirm-clear-samples': return App.doClearSamples();
        case 'confirm-wipe': return App.doWipe();
        case 'do-delete': return App.doDelete(p.kind, p.id);
        case 'do-delete-matter': return App.doDeleteMatter(p.id);
        case 'add-linked-folder': return App.linkFolder();
        case 'export-archive': return App.exportArchive();
        case 'open-archive-folder': return Bridge.openArchiveFolder().catch(() => App.toast('Open the archive from the Setup screen on this tablet.', 'err'));
        case 'clear-samples': return App.clearSamples();
        case 'wipe-all': return App.wipeAll();
        case 'export-backup': return App.exportBackup();
        case 'restore-backup': return App.restoreBackup();
        case 'test-notification': return App.testNotification();
        case 'enable-notifications': return App.askNotifyPermission();
        case 'save-voice': return App.saveVoiceFromForm();
        case 'preview-voice': return App.previewVoice(el);
        case 'set-langmode': return App.setLangFromSelect(el);
        case 'cal-prev': return LJ.Views.calNav(-1);
        case 'cal-next': return LJ.Views.calNav(1);
        case 'cal-today': return LJ.Views.calToday();
        case 'cal-select': return LJ.Views.calSelect(p.date);
        case 'link-doc': return LJ.DocsUI.openLinkDialog(p.id);
        case 'share-doc': return LJ.DocsUI.share(p.id);
        case 'delete-doc': return LJ.DocsUI.confirmDelete(p.id);
        case 'save-brief-settings': return App.saveBriefSettings();
        case 'save-profile': return App.saveProfile();
        case 'save-voice-settings': return App.saveVoiceSettings();
        case 'save-misc': return App.saveMisc();
        case 'rescan-now': return App.rescanLinked();
        case 'onboard-begin': return App.finishWelcome();
        case 'onboard-tour': return App.finishWelcome(true);
        case 'sample-clear': return App.clearSamples();
        case 'relink-folder': return App.linkFolder();
        default:
          console.warn('unhandled action', action, p);
      }
    },

    /* ---------------- navigation ---------------- */
    nav(view, opts = {}) {
      if (!VIEW_META[view]) return;
      App.state.view = view;
      document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + view));
      document.querySelectorAll('.rail-btn').forEach(b => b.classList.toggle('is-active', b.dataset.nav === view));
      App.els.viewTitle.textContent = VIEW_META[view].title;
      App.els.viewEyebrow.textContent = VIEW_META[view].eyebrow;
      if (view === 'overview') LJ.Views.renderOverview();
      if (view === 'matters') LJ.Views.renderMatters();
      if (view === 'diary') LJ.Views.renderDiary();
      if (view === 'documents') LJ.DocsUI.render();
      if (view === 'settings') App.renderSettings();
      if (opts.filterDrafts) { App.state.docSearch = 'draft'; App.els.docSearch.value = 'draft'; LJ.DocsUI.render(); }
      const main = document.getElementById('views');
      if (main && !opts.silent) main.scrollTop = 0;
    },

    renderAll() {
      App.renderStage();
      LJ.Views.renderOverview();
      LJ.Views.renderMatters();
      LJ.Views.renderDiary();
      LJ.DocsUI.render();
      App.renderSettings();
      if (LJ.Views && LJ.Views.refreshSheets) { try { LJ.Views.refreshSheets(); } catch (e) {} }
    },

    renderTopClock() {
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      App.els.clockTime.textContent = p(d.getHours()) + ':' + p(d.getMinutes());
      const hi = I.fullHindi();
      App.els.clockDate.textContent = I.date(U.todayISO(), { hi, weekday: true, year: false });
      if (App.state.view === 'command' && d.getSeconds() === 0) App.renderStageGreeting();
    },

    /* ---------------- command stage ---------------- */
    renderStageGreeting() {
      const hi = I.fullHindi();
      const st = J.stats();
      App.els.stageGreet.textContent = I.greeting();
      App.els.stageStatus.textContent = J.stageLine();
    },

    renderStage() {
      App.renderStageGreeting();
      const st = J.stats();
      const chips = J.suggestions();
      App.els.stageStats.innerHTML = [
        { n: st.todayList.length, l: I.fullHindi() ? 'आज' : 'Today' },
        { n: st.tomorrowList.length, l: I.fullHindi() ? 'कल' : 'Tomorrow' },
        { n: st.open.length, l: I.fullHindi() ? 'कार्य' : 'Open work' },
        { n: st.drafts.length, l: I.fullHindi() ? 'प्रारूप' : 'Drafts' }
      ].map(x => '<div class="mini-stat"><b>' + x.n + '</b><span>' + U.esc(x.l) + '</span></div>').join('');
      App.els.stageChips.innerHTML = chips.map(c => {
        const payload = encodeURIComponent(JSON.stringify(c));
        return '<button class="chip" data-action="' + (c.act === 'brief' ? 'brief' : c.act === 'tomorrow' ? 'tomorrow' : c.act === 'tasks' ? 'tasks' : c.act === 'drafts' ? 'drafts' : 'noop') + '" data-payload="' + payload + '">' + U.esc(c.label) + '</button>';
      }).join('');
      App.renderTopClock();
    },

    setReactor(state) {
      if (App.els.reactor) App.els.reactor.dataset.state = state;
    },

    /* ---------------- language & speech toggles ---------------- */
    applyLangUI() {
      const mode = S.get('langMode') || 'auto';
      document.querySelectorAll('[data-langmode]').forEach(b => b.classList.toggle('is-active', b.dataset.langmode === mode));
      document.querySelectorAll('#hudLangEn, #hudLangHi').forEach(b => b.classList.toggle('is-active', false));
    },
    setLang(mode) {
      if (!['en', 'hi', 'auto'].includes(mode)) return;
      S.set('langMode', mode);
      App.applyLangUI();
      App.renderStage();
      App.renderAll();
      if (mode === 'hi') {
        App.toast('भाषा: हिंदी — अब जार्विस हिंदी में उत्तर देगा।', 'ok');
      } else if (mode === 'auto') {
        App.toast('Language: Auto — English, with Hindi for Hindi documents.', 'ok');
      } else {
        App.toast('Language: English.', 'ok');
      }
      if (J.lastReply) {
        const note = mode === 'hi' ? 'बहुत अच्छा, सर। अब मैं हिंदी में बात करूँगा।' : mode === 'auto' ? 'Auto mode, Sir. English for the chamber, Hindi where the papers demand it.' : 'English restored, Sir.';
        App.talk(J.say(note), { silentNav: true });
      }
    },
    setLangFromSelect(el) {
      const sel = el && el.closest('.setting-field') ? el.closest('.setting-field').querySelector('select') : null;
      if (sel) App.setLang(sel.value);
    },

    syncSpeakToggle() {
      App.muted = !S.get('autoSpeak');
      App.els.speakToggle.setAttribute('aria-pressed', String(!App.muted));
      App.els.speakToggle.title = App.muted ? 'Voice output is off' : 'Voice output is on';
      const svg = App.els.speakToggle.querySelector('svg');
      if (svg) svg.style.opacity = App.muted ? '0.45' : '1';
    },
    toggleSpeak() {
      const on = !S.get('autoSpeak');
      S.set('autoSpeak', on);
      App.muted = !on;
      App.syncSpeakToggle();
      if (!on) J.stopSpeaking();
      App.toast(on ? 'Voice output enabled.' : 'Voice output muted.', 'ok');
    },
    setHudLang(lang) {
      S.set('recogLang', lang);
      document.querySelectorAll('#hudLangEn, #hudLangHi').forEach(b => {
        b.classList.toggle('is-active', (lang === 'hi-IN' && b.id === 'hudLangHi') || (lang !== 'hi-IN' && b.id === 'hudLangEn'));
      });
      if (App.listen.active) {
        Bridge.stopListening();
        setTimeout(() => App.startListening(lang), 260);
      }
    },

    /* ---------------- thread ---------------- */
    loadThread() {
      try {
        const raw = localStorage.getItem('lj.thread');
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.slice(-40) : [];
      } catch (e) { return []; }
    },
    saveThread() {
      try { localStorage.setItem('lj.thread', JSON.stringify(App.state.thread.slice(-40))); } catch (e) {}
    },

    renderThreadFromStore() {
      App.state.thread = App.loadThread();
      if (!App.state.thread.length) {
        const st = J.stats();
        const greeting = I.fullHindi()
          ? I.greeting() + ' मैं आपका चैंबर सहायक हूँ। ' + J.stageLine() + ' मुझसे बोलिए या लिखिए — मैं सुन रहा हूँ।'
          : I.greeting() + ' The chamber is ready. ' + J.stageLine() + ' Ask me for your briefing, a matter, or a paper — or simply speak.';
        App.state.thread.push({
          role: 'jarvis',
          blocks: [{ text: greeting, lang: I.fullHindi() ? 'hi' : 'en' }],
          actions: J.suggestions(),
          time: Date.now(),
          meta: 'Systems nominal'
        });
        App.saveThread();
      }
      App.els.thread.innerHTML = '';
      App.state.thread.forEach(m => App.appendMessage(m, false));
      App.scrollThread();
    },

    addMessage(msg) {
      App.state.thread.push(msg);
      App.saveThread();
      App.appendMessage(msg, true);
    },

    appendMessage(msg, animate) {
      const wrap = document.createElement('div');
      wrap.className = 'msg ' + (msg.role === 'user' ? 'user' : 'jarvis');
      const avatar = msg.role === 'user' ? (I.fullHindi() ? 'आप' : 'YOU') : 'J';
      let body = '';
      (msg.blocks || []).forEach(b => {
        body += '<div class="bubble' + (b.lang === 'hi' ? ' lang-hi' : '') + '">' + App.fmtText(b.text, b.lang) + '</div>';
      });
      if (!body) body = '<div class="bubble">' + App.fmtText(msg.text || '') + '</div>';
      let acts = '';
      if (msg.actions && msg.actions.length) {
        acts = '<div class="reply-actions">' + msg.actions.map(a => {
          const payload = encodeURIComponent(JSON.stringify(a));
          return '<button class="reply-btn" data-action="reply-act" data-payload="' + payload + '">' + U.esc(a.label) + '</button>';
        }).join('') + '</div>';
      }
      // reply-act is resolved here: simpler to place the actual act
      if (msg.actions && msg.actions.length) {
        acts = '<div class="reply-actions">' + msg.actions.map(a => {
          const params = Object.assign({}, a);
          delete params.label;
          const payload = encodeURIComponent(JSON.stringify(params));
          return '<button class="reply-btn" data-action="' + U.esc(a.act || 'noop') + '" data-payload="' + payload + '">' + U.esc(a.label) + '</button>';
        }).join('') + '</div>';
      }
      wrap.innerHTML =
        '<div class="avatar">' + avatar + '</div>' +
        '<div class="msg-body"><div class="bubble-stack">' + body + '</div>' + acts +
        '<div class="msg-meta">' + U.esc(msg.meta || (msg.role === 'user' ? 'You' : 'J.A.R.V.I.S.')) + ' · ' + new Date(msg.time || Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) + '</div></div>';
      if (!animate) wrap.style.animation = 'none';
      App.els.thread.appendChild(wrap);
      if (animate) App.scrollThread();
    },

    fmtText(text, lang) {
      let s = U.esc(text || '');
      s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/\n/g, '<br>');
      return s;
    },

    scrollThread() {
      requestAnimationFrame(() => { App.els.thread.scrollTop = App.els.thread.scrollHeight; });
    },

    typing(on) {
      const id = 'typing-indicator';
      const existing = document.getElementById(id);
      if (existing) existing.remove();
      if (!on) return;
      const wrap = document.createElement('div');
      wrap.id = id;
      wrap.className = 'msg jarvis';
      wrap.innerHTML = '<div class="avatar">J</div><div class="msg-body"><div class="bubble" style="display:flex;gap:4px;align-items:center;padding:13px 16px">' +
        '<span class="pulse-dot"></span><span style="color:var(--muted-2);font-size:12px">Jarvis is attending to it…</span></div></div>';
      App.els.thread.appendChild(wrap);
      App.scrollThread();
    },

    async submitCommand(raw, opts = {}) {
      const text = String(raw || '').trim();
      if (!text) return;
      if (App.state.importing) { App.toast('One moment, Sir — the archive is being filed.', 'err'); return; }
      App.els.commandInput.value = '';
      App.addMessage({ role: 'user', blocks: [{ text, lang: I.isHindiText(text) ? 'hi' : 'en' }], time: Date.now(), meta: opts.spoken ? 'Spoken command' : 'Typed command' });
      App.typing(true);
      await new Promise(r => setTimeout(r, 260));
      let reply;
      try { reply = J.handle(text); } catch (e) { console.error(e); reply = J.say('I encountered an error while attending to that, Sir.'); }
      App.typing(false);
      await App.showReply(reply, { query: text, spoken: opts.spoken });
    },

    async showReply(reply, opts = {}) {
      if (!reply) return;
      J.lastReply = reply;
      App.addMessage({
        role: 'jarvis', blocks: reply.blocks, actions: reply.actions || [],
        time: Date.now(), meta: reply.kind === 'brief' ? 'Briefing' : (I.fullHindi() ? 'जार्विस' : 'J.A.R.V.I.S.')
      });
      if (reply.doneTask) {
        await Repo.toggleTask(reply.doneTask, true);
        App.renderAll();
      }
      if (reply.navigate) App.nav(reply.navigate, { silent: true });
      if (reply.triggerImport) setTimeout(() => App.startImport('files'), 500);
      const speakPromise = (reply.silent || App.muted) ? Promise.resolve() : J.speakReply(reply);
      if (reply.openDoc) {
        speakPromise.then(() => LJ.DocsUI.open(reply.openDoc));
      }
      if (reply.openAddCase) setTimeout(() => LJ.Views.openCaseForm(null, false, reply.openAddCase), 420);
      if (reply.openHearing) setTimeout(() => LJ.Views.openHearingForm(reply.openHearing.matterId, reply.openHearing), 420);
      if (reply.openReminder) setTimeout(() => LJ.Views.openReminderForm(reply.openReminder), 420);
      if (reply.openTask) setTimeout(() => LJ.Views.openTaskForm(null, reply.openTask), 420);
      if (S.get('handsFree') && !App.muted && !reply.silent) {
        speakPromise.then(() => setTimeout(() => {
          if (App.listen.active || App.state.importing) return;
          if (App._sheets && App._sheets.length) return;
          App.startListening();
        }, 650));
      }
      if (App.state.speakDraft) App.state.speakDraft = false;
    },

    talk(reply, opts = {}) { return App.showReply(reply, opts); },

    giveBrief(kind) {
      App.nav('command', { silent: true });
      const reply = J.buildBrief(kind || (new Date().getHours() >= 17 ? 'evening' : 'morning'));
      App.showReply(reply);
    },

    clearThread() {
      App.state.thread = [];
      localStorage.removeItem('lj.thread');
      J.stopSpeaking();
      App.renderThreadFromStore();
    },

    /* ---------------- voice ---------------- */
    async startListening(langOverride) {
      if (App.listen.active) { App.cancelListening(); return; }
      J.stopSpeaking();
      const lang = langOverride || (S.get('langMode') === 'hi' ? 'hi-IN' : (S.get('recogLang') || 'en-IN'));
      App.listen = { active: true, final: '', lang, timer: null, autoRestart: false };
      App.els.hud.hidden = false;
      App.els.hudTitle.textContent = I.fullHindi() ? 'सुन रहा हूँ…' : 'Listening…';
      App.els.hudText.textContent = I.fullHindi() ? 'कहिए, सर।' : 'Speak now, Sir.';
      App.setReactor('listening');
      document.querySelectorAll('#hudLangEn, #hudLangHi').forEach(b => {
        b.classList.toggle('is-active', (lang === 'hi-IN' && b.id === 'hudLangHi') || (lang !== 'hi-IN' && b.id === 'hudLangEn'));
      });
      const granted = await Bridge.micPermission(true);
      if (!granted) {
        App.els.hudText.textContent = I.fullHindi() ? 'माइक्रोफ़ोन की अनुमति आवश्यक है। सेटिंग में अनुमति दें।' : 'Microphone permission is required. Please allow it in Android settings.';
        setTimeout(() => App.cancelListening(), 2600);
        return;
      }
      Bridge.listen({ lang });
      App.listen.timer = setTimeout(() => {
        if (App.listen.active && !App.listen.final) {
          App.els.hudText.textContent = I.fullHindi() ? 'मैं सुन रहा हूँ…' : 'Still listening, Sir…';
        }
      }, 6000);
    },

    onSpeech(ev) {
      if (!ev) return;
      if (ev.type === 'partial') {
        if (!App.listen.active) return;
        App.els.hudText.textContent = ev.text || '…';
        return;
      }
      if (ev.type === 'final') {
        if (!App.listen.active) {
          if (S.get('handsFree') && ev.text) App.submitCommand(ev.text, { spoken: true });
          return;
        }
        App.listen.final = (App.listen.final ? App.listen.final + ' ' : '') + String(ev.text || '').trim();
        App.els.hudText.textContent = App.listen.final;
        clearTimeout(App.listen.finishTimer);
        App.listen.finishTimer = setTimeout(() => App.finishListening(true), 900);
        return;
      }
      if (ev.type === 'error') {
        if (!App.listen.active) return;
        const msg = ev.error === 'no-speech' || ev.error === 'speech-timeout'
          ? (I.fullHindi() ? 'मुझे कुछ सुनाई नहीं दिया, सर।' : 'I did not catch that, Sir.')
          : ev.error === 'not-allowed' || ev.error === 'insufficient-permissions'
            ? (I.fullHindi() ? 'माइक्रोफ़ोन अनुमति नहीं है।' : 'Microphone access is not permitted.')
            : (I.fullHindi() ? 'पहचान में अड़चन आई। पुनः प्रयास करें।' : 'I had trouble hearing that. Do try again.');
        App.els.hudText.textContent = msg;
        clearTimeout(App.listen.cancelTimer);
        App.listen.cancelTimer = setTimeout(() => App.cancelListening(), 2200);
        return;
      }
      if (ev.type === 'end') {
        if (!App.listen.active) return;
        if (App.listen.final) App.finishListening(true);
        else {
          clearTimeout(App.listen.endTimer);
          App.listen.endTimer = setTimeout(() => {
            if (App.listen.active && !App.listen.final) App.cancelListening(true);
          }, 1200);
        }
      }
    },

    finishListening(shouldSubmit) {
      if (!App.listen.active) return;
      const text = App.listen.final.trim();
      App.listen.active = false;
      clearTimeout(App.listen.timer);
      clearTimeout(App.listen.finishTimer);
      clearTimeout(App.listen.endTimer);
      clearTimeout(App.listen.cancelTimer);
      if (shouldSubmit && text) {
        App.els.hud.hidden = true;
        App.setReactor('idle');
        App.submitCommand(text, { spoken: true });
      } else if (text) {
        App.els.hudText.textContent = text;
      } else {
        App.cancelListening(true);
      }
    },

    cancelListening(silent) {
      App.listen.active = false;
      clearTimeout(App.listen.timer);
      clearTimeout(App.listen.finishTimer);
      clearTimeout(App.listen.endTimer);
      clearTimeout(App.listen.cancelTimer);
      Bridge.stopListening();
      App.els.hud.hidden = true;
      App.setReactor('idle');
      if (silent) App.els.hudText.textContent = I.fullHindi() ? 'कहिए, सर।' : 'Speak now, Sir.';
    },

    /* ---------------- import ---------------- */
    async startImport(kind) {
      if (App.state.importing) return;
      try {
        let res;
        if (kind === 'folder') res = await Bridge.pickFolder();
        else res = await Bridge.pickFiles();
        if (!res || res.cancelled) return;
        let files = res.files || [];
        if (Bridge.available && kind === 'folder' && res.treeUri) {
          const folders = (S.get('folders') || []).filter(f => f.treeUri !== res.treeUri);
          folders.push({ treeUri: res.treeUri, name: res.name || 'Linked folder', addedAt: new Date().toISOString() });
          S.set('folders', folders);
        }
        const usable = files.filter(f => /\.(pdf|docx?|txt|rtf|png|jpe?g|webp)$/i.test(f.name || '') ||
          /pdf|word|text|image/.test((f.mime || f.type || '')));
        if (!usable.length) {
          App.toast('No PDF or Word documents were selected, Sir.', 'err');
          return;
        }
        await App.importList(usable, kind);
      } catch (e) {
        console.error(e);
        App.toast('Import failed: ' + (e.message || e), 'err', 6000);
      }
    },

    async importList(files, kind) {
      App.state.importing = true;
      const sheet = App.openSheet({
        eyebrow: 'Archive', title: 'Filing your documents', sub: 'Reading each paper, then placing it by court, case and type.',
        narrow: true, body: '<div class="import-progress"><p id="impName" class="muted tiny">Preparing…</p><div class="progress-line"><i id="impBar" style="width:0%"></i></div><p id="impCount" class="tiny muted" style="margin-top:8px">0 of ' + files.length + '</p></div>',
        foot: '<button class="ghost-btn" data-action="noop">Please wait</button>',
        static: true
      });
      Docs.onProgress = p => {
        const name = document.getElementById('impName');
        const bar = document.getElementById('impBar');
        const count = document.getElementById('impCount');
        if (name) name.textContent = (p.stage === 'reading' ? 'Reading ' : p.stage === 'filing' ? 'Filing ' : 'Filed ') + p.name;
        if (bar) bar.style.width = Math.round((p.done / Math.max(1, p.total)) * 100) + '%';
        if (count) count.textContent = p.done + ' of ' + p.total;
      };
      try {
        const stats = await Docs.importFiles(files, { source: kind });
        Docs.onProgress = null;
        App.closeSheet(sheet.root, true);
        App.renderAll();
        App.toast('Filed ' + stats.added + ' document' + (stats.added === 1 ? '' : 's') +
          (stats.skipped ? ' · ' + stats.skipped + ' already in archive' : '') +
          (stats.failed ? ' · ' + stats.failed + ' could not be read' : ''), stats.failed ? 'err' : 'ok', 5600);
        const st = J.stats();
        const talk = I.fullHindi()
          ? 'मैंने ' + stats.added + ' दस्तावेज़ पढ़कर संग्रह में व्यवस्थित कर दिए हैं, ' + 'सर' + '। आप चाहें तो मैं उन्हें न्यायालय और मामले के अनुसार दिखा दूँ।'
          : 'Filed and indexed, Sir. ' + n(stats.added, 'document') + ' have been read and sorted by court, case and type' +
            (stats.failed ? ', though ' + stats.failed + ' resisted my reading' : '') + '.';
        App.talk(J.reply([{ text: talk, lang: I.fullHindi() ? 'hi' : 'en' }], [{ label: 'Open archive', act: 'documents' }, { label: 'Unlinked papers', act: 'documents' }]), {});
      } finally {
        App.state.importing = false;
      }
    },

    onSharedFiles(data) {
      const files = (data && data.files) || [];
      if (!files.length) return;
      App.importList(files, 'shared');
    },

    async linkFolder() {
      try {
        const res = await Bridge.pickFolder();
        if (!res || res.cancelled) return;
        if (res.treeUri) {
          const folders = (S.get('folders') || []).filter(f => f.treeUri !== res.treeUri);
          folders.push({ treeUri: res.treeUri, name: res.name || 'Linked folder', addedAt: new Date().toISOString() });
          S.set('folders', folders);
          App.toast('Folder linked. I shall rescan it at each opening, Sir.', 'ok');
          if (res.files && res.files.length) App.importList(res.files, 'folder');
          App.renderSettings();
        }
      } catch (e) { App.toast('Folder could not be linked.', 'err'); }
    },

    async rescanLinked() {
      const folders = S.get('folders') || [];
      if (!folders.length) { App.toast('No folder is linked yet, Sir. Link one first.', 'err'); return; }
      let all = [];
      for (const f of folders) {
        try {
          const r = await Bridge.scanFolder(f.treeUri);
          if (r && r.files) all = all.concat(r.files);
        } catch (e) { console.warn('scan failed', f, e); }
      }
      if (!all.length) { App.toast('No new documents found in the linked folders.', 'ok'); return; }
      await App.importList(all, 'rescan');
    },

    async onResume() {
      if (!S.get('rescanOnResume')) return;
      const folders = S.get('folders') || [];
      if (!folders.length) return;
      try {
        let all = [];
        for (const f of folders) {
          const r = await Bridge.scanFolder(f.treeUri);
          if (r && r.files) all = all.concat(r.files);
        }
        const fresh = all.filter(f => !Docs.isDuplicate(f));
        if (fresh.length) App.importList(fresh, 'rescan');
      } catch (e) {}
    },

    /* ---------------- whole-tablet scan ---------------- */
    async scanDevice() {
      if (!Bridge.available) {
        App.openSheet({
          eyebrow: 'Archive', title: 'Scan the whole tablet',
          sub: 'This works in the installed Android app.',
          narrow: true,
          body: '<p class="form-note" style="margin-top:0">Android grants an app access only to the folders you choose. In the installed Legal Jarvis app you may give one-time “All files access”, and I shall then find every PDF and Word document already on the tablet and file it by court, case and type.</p>',
          foot: '<button class="primary-btn" data-action="close-sheet">Understood</button>'
        });
        return;
      }
      try {
        const perm = await Bridge.storagePermission();
        if (perm && perm.granted) { App.scanNow(); return; }
        App.scanSheet();
      } catch (e) {
        App.toast('Android would not open the access screen. Please use the file picker instead.', 'err', 5000);
      }
    },

    scanSheet() {
      App.openSheet({
        eyebrow: 'Archive', title: 'Find every paper on the tablet',
        sub: 'One permission, then a single sweep of the tablet.',
        narrow: true,
        body:
          '<p class="form-note" style="margin-top:0">Android normally hides the tablet’s folders from apps. With <strong>All files access</strong>, I can read the PDF and Word documents already stored there — in Downloads, Documents and your chamber folders — and file each one into the case archive.</p>' +
          '<p class="form-note">I ignore photographs, music, videos and the app’s own archive. Documents are read on this tablet only; nothing is uploaded.</p>' +
          '<p class="form-note">Grant the permission on the next screen, then return here and choose <strong>Scan now</strong>.</p>',
        foot: '<button class="ghost-btn" data-action="close-sheet">Not now</button>' +
          '<button class="ghost-btn" data-action="scan-grant">Grant access</button>' +
          '<button class="primary-btn" data-action="scan-now">Scan now</button>'
      });
    },

    async exactAlarm() {
      if (!Bridge.available) { App.toast('Exact reminders are handled by the installed app.', 'err'); return; }
      try {
        await Bridge.exactAlarmPermission();
        App.toast('If Android asks, allow “Alarms & reminders” for Legal Jarvis. I shall then arrive at the precise minute.', 'ok', 7000);
      } catch (e) {
        App.toast('Android would not open the alarm settings.', 'err');
      }
    },

    async scanGrant() {
      try {
        const perm = await Bridge.storagePermission();
        App.toast('Return to Legal Jarvis and tap Scan now.', 'ok', 6000);
        if (perm && perm.granted) App.scanNow();
      } catch (e) {
        App.toast('The permission screen could not be opened.', 'err');
      }
    },

    async scanNow() {
      if (App.state.importing) { App.toast('One moment, Sir — the archive is already being filed.', 'err'); return; }
      App.toast('Sweeping the tablet for documents, Sir…', 'ok', 6000);
      let r;
      try {
        r = await Bridge.scanDevice();
      } catch (e) {
        App.toast('The tablet could not be scanned: ' + (e.message || e), 'err', 6000);
        return;
      }
      if (r && r.needPermission) { App.scanSheet(); return; }
      if (r && r.unavailable) { App.toast('Tablet-wide scanning is available in the installed app.', 'err'); return; }
      const files = ((r && r.files) || []).filter(f => /\.(pdf|docx?|txt|rtf)$/i.test(f.name || ''));
      if (!files.length) {
        App.toast('No PDF or Word documents were found outside the archive, Sir.', 'ok', 5000);
        return;
      }
      const fresh = files.filter(f => !Docs.isDuplicate(f));
      if (!fresh.length) {
        App.toast('All ' + files.length + ' documents on the tablet are already in the archive, Sir.', 'ok', 5000);
        return;
      }
      App.closeTopSheet();
      const batch = fresh.slice(0, 50);
      const remainder = fresh.length - batch.length;
      App.toast('Found ' + files.length + ' documents — filing ' + batch.length + ' new ones' +
        (remainder ? ' (' + remainder + ' will follow on the next scan)' : '') + '.', 'ok', 6000);
      await App.importList(batch, 'scan');
      if (remainder) setTimeout(() => App.toast('There are ' + remainder + ' more papers to file, Sir. Tap Scan tablet again when convenient.', 'ok', 8000), 1500);
    },

    /* ---------------- e-Courts import ---------------- */
    openEcourtsImport() {
      const sheet = App.openSheet({
        eyebrow: 'e-Courts · Google Drive', title: 'Import your e-Courts register',
        sub: 'Bring the case data exported by your e-Courts app, or a Legal Jarvis backup. Google Drive appears inside the file picker.',
        body:
          '<div class="form-grid">' +
          '<div class="field full"><p class="form-note" style="margin-top:0">Supported: <strong>CSV</strong> exports from e-Courts, and <strong>JSON</strong> backups. The first row should carry columns such as <span class="mono">CNR, Case Number, Case Title, Court, Client, Next Date, Stage, Status</span>. I will merge cases by CNR, case number and court, and add future dates to your diary.</p></div>' +
          '<div class="field full"><label>Where shall I look?</label>' +
          '<div class="pill-row">' +
          '<button class="primary-btn" data-action="pick-ecourts">Choose CSV / JSON from Drive</button>' +
          '<button class="ghost-btn" data-action="import-files">Import case documents instead</button>' +
          '</div></div>' +
          '<div class="field full"><hr class="hr"><p class="form-note">No portal access is required. Nothing leaves this tablet; I read only the file you choose. For automatic e-Courts updates, export the register from the e-Courts app into your Drive folder and import it here — the register is then updated in one step.</p></div>' +
          '</div>',
        foot: '<button class="ghost-btn" data-action="close-sheet">Close</button>'
      });
      App._ecourtsSheet = sheet;
    },

    async pickEcourts() {
      try {
        const r = await Bridge.pickBackup({ mime: '.csv,.json,text/csv,application/json' });
        if (!r || r.cancelled || !r.text) return;
        const result = await App.mergeEcourts(r.text, r.name || 'import');
        App.closeTopSheet();
        App.renderAll();
        App.talk(J.reply([{
          text: I.fullHindi()
            ? 'ई-कोर्ट्स डेटा पढ़ लिया गया, ' + 'सर' + '। ' + result.added + ' नए मामले जोड़े गए और ' + result.updated + ' अद्यतन किए गए' + (result.hearings ? '; ' + result.hearings + ' तिथियाँ डायरी में दर्ज हुईं' : '') + '।'
            : 'The e-Courts register is read, Sir. ' + n(result.added, 'new matter') + ' added, ' + n(result.updated, 'matter') + ' updated' + (result.hearings ? ', and ' + n(result.hearings, 'hearing date') + ' entered into the diary' : '') + '.'
        }], [{ label: 'Open register', act: 'matters' }, { label: 'Open diary', act: 'diary' }]));
      } catch (e) {
        App.toast('That file could not be read: ' + (e.message || e), 'err', 6000);
      }
    },

    async mergeEcourts(text, filename) {
      let rows = [];
      const trimmed = String(text).trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed);
        const arr = Array.isArray(parsed) ? parsed : (parsed.data && (parsed.data.matters || parsed.data)) || parsed.matters || [];
        rows = Array.isArray(arr) ? arr : [];
      } else {
        rows = parseCSV(trimmed);
      }
      if (!rows.length) throw new Error('No rows were found.');
      let added = 0, updated = 0, hearings = 0;
      const today = U.todayISO();
      for (const row of rows) {
        const get = (...names) => {
          for (const key of Object.keys(row)) {
            const k = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
            for (const nm of names) {
              if (k === nm.replace(/[^a-z0-9]/g, '')) return row[key];
            }
          }
          return '';
        };
        const cnr = U.clean(get('cnr', 'cnrnumber', 'cnr no'));
        const title = U.clean(get('casetitle', 'title', 'case title', 'parties', 'case name', 'matter'));
        const client = U.clean(get('client', 'clientname', 'petitioner', 'applicant', 'complainant'));
        const court = U.clean(get('court', 'courts', 'courtname', 'court name'));
        let caseNo = U.clean(get('casenumber', 'caseno', 'case number', 'case no', 'number'));
        let year = U.clean(get('year', 'caseyear'));
        if (!year && /\/(\d{2,4})$/.test(caseNo)) { year = caseNo.split('/').pop(); caseNo = caseNo.split('/')[0]; }
        const stage = U.clean(get('stage', 'stageofcase', 'case status', 'status', 'purpose', 'business on date'));
        let nextDateRaw = U.clean(get('nextdate', 'next hearing', 'next hearing date', 'hearingdate', 'date'));
        const nextDate = normaliseDate(nextDateRaw);
        if (!title && !cnr) continue;
        let m = null;
        if (cnr) m = Repo.data.matters.find(x => x.cnr && x.cnr.toLowerCase() === cnr.toLowerCase());
        if (!m && caseNo && court) m = Repo.data.matters.find(x => String(x.caseNo) === caseNo && (x.year === year || !year) && (x.court || '').toLowerCase() === court.toLowerCase());
        if (!m && title) {
          const key = U.normalize(title);
          m = Repo.data.matters.find(x => U.normalize(x.title) === key) || null;
        }
        const fields = {
          title: title || (m && m.title),
          client: client || (m && m.client) || '',
          court: court || (m && m.court) || '',
          caseNo: caseNo || (m && m.caseNo) || '',
          year: year || (m && m.year) || '',
          cnr: cnr || (m && m.cnr) || '',
          stage: stage || (m && m.stage) || '',
          source: 'ecourts'
        };
        if (!fields.title) continue;
        if (m) {
          Object.keys(fields).forEach(k => { if (fields[k]) m[k] = fields[k]; });
          await Repo.saveMatter(m);
          updated++;
        } else {
          m = await Repo.saveMatter(Object.assign({ id: U.uid('mat'), status: 'active', createdAt: new Date().toISOString() }, fields));
          added++;
        }
        if (nextDate && nextDate >= today) {
          const exists = Repo.data.hearings.find(h => h.matterId === m.id && h.date === nextDate);
          if (!exists) {
            await Repo.saveHearing({ matterId: m.id, date: nextDate, court: fields.court, purpose: fields.stage, source: 'ecourts' });
            hearings++;
          }
          if (!m.nextHearing || m.nextHearing < today || m.nextHearing > nextDate) {
            m.nextHearing = nextDate;
            await Repo.saveMatter(m);
          }
        }
      }
      return { added, updated, hearings };
    },

    /* ---------------- data ---------------- */
    async clearSamples() {
      const sheet = App.openSheet({
        eyebrow: 'Housekeeping', title: 'Clear the sample chamber?',
        sub: 'This removes the demonstration matters, dates, tasks and documents. Your own records remain untouched.',
        narrow: true,
        body: '<p class="form-note" style="margin-top:0">Should you wish to see the demonstration again, reinstall the app. Your imported documents and manually entered matters will not be affected.</p>',
        foot: '<button class="ghost-btn" data-action="close-sheet">Keep them</button>' +
          '<button class="danger-btn" data-action="confirm-clear-samples">Clear sample data</button>'
      });
      App._confirmSheet = sheet;
    },

    async doClearSamples() {
      await LJ.clearSampleData();
      App.closeTopSheet();
      App.renderAll();
      App.toast('Sample chamber cleared. The register is yours alone, Sir.', 'ok');
    },

    async wipeAll() {
      const sheet = App.openSheet({
        eyebrow: 'Caution', title: 'Erase all chamber data?',
        sub: 'Every matter, date, task, reminder and document index on this tablet will be removed. This cannot be undone.',
        narrow: true,
        body: '<p class="form-note" style="margin-top:0">Please export a backup first, Sir. I would be remiss if I did not say so.</p>',
        foot: '<button class="ghost-btn" data-action="close-sheet">Cancel</button>' +
          '<button class="ghost-btn" data-action="export-backup">Export backup first</button>' +
          '<button class="danger-btn" data-action="confirm-wipe">Erase everything</button>'
      });
      App._wipeSheet = sheet;
    },

    async doWipe() {
      await LJ.resetEverything();
      App.closeTopSheet();
      App.renderAll();
      App.renderThreadFromStore();
      App.toast('All chamber data has been erased.', 'ok');
    },

    async exportBackup() {
      try {
        const text = await LJ.backupJSON();
        const name = 'LegalJarvis-Backup-' + U.todayISO() + '.json';
        await Bridge.saveBackup(name, text);
        App.toast('Backup prepared, Sir.', 'ok');
      } catch (e) { App.toast('Backup failed: ' + (e.message || e), 'err'); }
    },

    async restoreBackup() {
      try {
        const r = await Bridge.pickBackup({ mime: '.json,application/json' });
        if (!r || !r.text) return;
        await LJ.restoreJSON(r.text);
        App.renderAll();
        App.renderThreadFromStore();
        App.toast('Chamber restored from backup.', 'ok');
      } catch (e) { App.toast('Restore failed: ' + (e.message || e), 'err'); }
    },

    async exportArchive() {
      try {
        await Bridge.exportArchive();
      } catch (e) { App.toast('Archive export is available in the Android build.', 'err'); }
    },

    /* ---------------- tasks & reminders ---------------- */
    async markTaskDone(id) {
      const t = await Repo.toggleTask(id, true);
      App.renderAll();
      if (t) App.toast('Done: ' + t.title, 'ok');
    },
    async toggleTask(id) {
      const t = await Repo.toggleTask(id);
      App.renderAll();
    },

    async dismissReminder(id) {
      const r = Repo.data.reminders.find(x => x.id === id);
      if (!r) return;
      r.dismissed = true;
      await Repo.saveReminder(r);
      await Bridge.cancelAlarm(id);
      App.renderAll();
      App.toast('Reminder dismissed.', 'ok');
    },

    async scheduleAlarms() {
      if (!S.get('notifications')) return;
      const today = U.todayISO();
      const list = Repo.data.reminders.filter(r => !r.dismissed && r.date >= today).slice(0, 60);
      for (const r of list) {
        if (Date.now() > new Date(r.date + 'T' + (r.time || '09:00') + ':00').getTime()) continue;
        await Bridge.scheduleAlarm(r);
      }
      const t = Repo.data.tasks.filter(x => !x.done && x.due);
      for (const task of t.slice(0, 40)) {
        const at = new Date(task.due + 'T09:00:00').getTime();
        if (at < Date.now()) continue;
        await Bridge.scheduleAlarm({ id: 'task_' + task.id, date: task.due, time: '09:00', title: 'Task: ' + task.title, kind: 'task' });
      }
    },

    setupDailyBriefs() {
      if (!S.get('notifications')) return;
      Bridge.setDailyBrief(S.get('briefMorning'), S.get('briefEvening'), true,
        J.briefNote('morning'), J.briefNote('evening'));
    },

    async askNotifyPermission() {
      const granted = await Bridge.requestNotifications();
      App.toast(granted ? 'Notifications enabled, Sir.' : 'Notifications were not permitted. You may allow them in Android settings.', granted ? 'ok' : 'err');
      S.set('notifications', granted);
      if (granted) { App.scheduleAlarms(); App.setupDailyBriefs(); }
      App.renderSettings();
    },

    async testNotification() {
      const ok = await Bridge.requestNotifications();
      await Bridge.notifyNow('Legal Jarvis', I.fullHindi() ? 'सभी प्रणालियाँ सामान्य हैं, सर।' : 'All systems nominal, Sir. Your reminders will arrive here.');
      App.toast(ok ? 'A test notification has been sent.' : 'Notification permission is required.', ok ? 'ok' : 'err');
    },

    async checkDueReminders() {
      if (S.get('notifications') === false) return;
      const now = new Date();
      const today = U.todayISO();
      const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      let changed = false;
      for (const r of Repo.data.reminders) {
        if (r.dismissed || r.notifiedAt) continue;
        if (r.date === today && (r.time || '09:00') <= hhmm) {
          r.notifiedAt = now.toISOString();
          await Repo.saveReminder(r);
          changed = true;
          if (document.visibilityState === 'visible' && !App.state.speaking) {
            App.talk(J.reply([{
              text: I.fullHindi() ? 'स्मरण, ' + 'सर' + ': ' + (r.titleHi || r.title) + '।' : 'A reminder, Sir: ' + r.title + '.'
            }], [{ label: 'Open matter', act: 'open-matter', id: r.matterId }, { label: 'Dismiss', act: 'dismiss-reminder', id: r.id }]));
          }
        }
      }
      if (changed) App.renderAll();
    },

    autoBriefDue() {
      if (!S.get('autoBrief')) return false;
      if (!S.get('onboarded')) return false;
      if (new Date().getHours() < 5) return false;
      return S.get('lastBriefDate') !== U.todayISO();
    },

    async maybeAutoBrief() {
      if (!App.autoBriefDue()) return;
      if (document.visibilityState !== 'visible') return;
      S.set('lastBriefDate', U.todayISO());
      if (App.listen.active) App.cancelListening(true);
      App.talk(J.buildBrief(new Date().getHours() >= 17 ? 'evening' : 'morning'));
    },

    /* ---------------- forms / settings persistence ---------------- */
    async saveProfile() {
      const name = document.getElementById('setOwnerName');
      const court = document.getElementById('setHomeCourt');
      S.patch({ ownerName: name ? U.clean(name.value) || 'Sir' : 'Sir', homeCourt: court ? U.clean(court.value) : '' });
      App.renderStage();
      App.renderAll();
      App.toast('Chamber profile saved, ' + (S.get('ownerName') || 'Sir') + '.', 'ok');
    },

    async saveVoiceSettings() {
      const sel = document.getElementById('setVoice');
      const rate = document.getElementById('setRate');
      const pitch = document.getElementById('setPitch');
      const greet = document.getElementById('setGreet');
      const auto = document.getElementById('setAutoSpeak');
      const autoBrief = document.getElementById('setAutoBrief');
      const handsFree = document.getElementById('setHandsFree');
      S.patch({
        voiceName: sel ? sel.value : S.get('voiceName'),
        speechRate: rate ? Number(rate.value) : S.get('speechRate'),
        speechPitch: pitch ? Number(pitch.value) : S.get('speechPitch'),
        greetOnOpen: greet ? greet.checked : S.get('greetOnOpen'),
        autoSpeak: auto ? auto.checked : S.get('autoSpeak'),
        autoBrief: autoBrief ? autoBrief.checked : S.get('autoBrief'),
        handsFree: handsFree ? handsFree.checked : S.get('handsFree')
      });
      App.muted = !S.get('autoSpeak');
      App.syncSpeakToggle();
      App.renderAll();
      App.toast('Voice settings saved. A moment, Sir.', 'ok');
      J.speakReply(J.reply([{ text: 'Good evening, Sir. All systems are nominal. I am at your service.' }]), true);
    },

    async saveMisc() {
      const recog = document.getElementById('setRecogLang');
      const rescan = document.getElementById('setRescan');
      S.patch({
        recogLang: recog ? recog.value : S.get('recogLang'),
        rescanOnResume: rescan ? rescan.checked : S.get('rescanOnResume')
      });
      App.toast('Preferences saved.', 'ok');
    },

    async saveBriefSettings() {
      const m = document.getElementById('setBriefMorning');
      const e = document.getElementById('setBriefEvening');
      const n = document.getElementById('setNotify');
      S.patch({
        briefMorning: m ? m.value || '08:30' : S.get('briefMorning'),
        briefEvening: e ? e.value || '19:30' : S.get('briefEvening'),
        notifications: n ? n.checked : S.get('notifications')
      });
      App.setupDailyBriefs();
      if (S.get('notifications')) await App.askNotifyPermission();
      App.scheduleAlarms();
      App.toast('Briefing times saved.', 'ok');
      App.renderSettings();
    },

    async saveVoiceFromForm() { return App.saveVoiceSettings(); },

    async previewVoice(el) {
      const sheet = el && el.closest('.modal-root');
      const rate = sheet && sheet.querySelector('#pvRate') ? Number(sheet.querySelector('#pvRate').value) : S.get('speechRate');
      const pitch = sheet && sheet.querySelector('#pvPitch') ? Number(sheet.querySelector('#pvPitch').value) : S.get('speechPitch');
      const voice = sheet && sheet.querySelector('#pvVoice') ? sheet.querySelector('#pvVoice').value : S.get('voiceName');
      J.stopSpeaking();
      await Bridge.speak('Good evening, Sir. All systems are nominal. The chamber is at your service.', { lang: 'en-GB', rate, pitch, voice });
    },

    /* ---------------- sheets ---------------- */
    openSheet(opts = {}) {
      const root = document.createElement('div');
      root.className = 'modal-root';
      const width = opts.wide ? ' wide' : opts.narrow ? ' narrow' : '';
      root.innerHTML =
        '<div class="modal-backdrop" data-action="close-sheet"></div>' +
        '<section class="sheet' + width + '" role="dialog" aria-modal="true">' +
        '<div class="sheet-head"><div>' +
        (opts.eyebrow ? '<p class="eyebrow">' + U.esc(opts.eyebrow) + '</p>' : '') +
        '<h2>' + U.esc(opts.title || '') + '</h2>' +
        (opts.sub ? '<p class="sheet-sub">' + U.esc(opts.sub) + '</p>' : '') +
        '</div><button class="sheet-close" data-action="close-sheet" aria-label="Close">×</button></div>' +
        '<div class="sheet-body">' + (opts.body || '') + '</div>' +
        (opts.foot ? '<div class="sheet-foot">' + opts.foot + '</div>' : '') +
        '</section>';
      if (opts.static) root.dataset.static = '1';
      document.body.appendChild(root);
      App._sheets = App._sheets || [];
      App._sheets.push(root);
      if (opts.onMount) setTimeout(() => opts.onMount(root), 30);
      return { root, close: () => App.closeSheet(root) };
    },

    closeSheet(root, force) {
      const target = root || (App._sheets && App._sheets[App._sheets.length - 1]);
      if (!target) return;
      if (target.dataset.static === '1' && !force) return;
      target.remove();
      App._sheets = (App._sheets || []).filter(x => x !== target);
      if (document.getElementById('modalRoot')) {
        document.getElementById('modalRoot').hidden = true;
        document.getElementById('modalRoot').innerHTML = '';
      }
    },

    closeTopSheet() {
      if (App.listen.active) { App.cancelListening(); return; }
      const top = App._sheets && App._sheets[App._sheets.length - 1];
      if (top) App.closeSheet(top);
    },

    handleBack() {
      if (App.listen.active) { App.cancelListening(); return true; }
      if (App._sheets && App._sheets.length) { App.closeSheet(App._sheets[App._sheets.length - 1]); return true; }
      if (App.state.view !== 'command') { App.nav('command'); return true; }
      return false;
    },

    /* ---------------- greeting / welcome ---------------- */
    showWelcome() {
      if (S.get('onboarded')) {
        if (S.get('greetOnOpen') !== false && !App.autoBriefDue()) {
          setTimeout(() => {
            if (document.visibilityState !== 'visible') return;
            const st = J.stats();
            const lang = I.fullHindi() ? 'hi' : 'en';
            const text = I.fullHindi()
              ? I.greeting() + ' मैं लीगल जार्विस हूँ। ' + J.stageLine() + ' आप बोलकर या लिखकर आदेश दे सकते हैं।'
              : I.greeting() + ' All systems are nominal. ' + J.stageLine() + ' You may speak, or type — I am listening either way.';
            J.speakReply(J.reply([{ text, lang }]), true);
          }, 500);
        }
        return;
      }
      const sheet = App.openSheet({
        eyebrow: 'Welcome to the chamber', title: 'Good evening, Sir.',
        sub: 'I am Legal Jarvis — your private, on-device chamber assistant.',
        wide: true, static: true,
        body:
          '<div class="welcome-grid">' +
          '<div>' +
          '<p class="form-note" style="margin-top:0">I keep the register, the diary, the papers and the deadlines. I read your PDFs and Word files, file them by court, case and type, and bring you the right paper in seconds.</p>' +
          '<div class="welcome-list">' +
          '<div><b>Speak or type</b><span>English and Hindi. “Brief me.” “Next date in the Sharma case.” “Pull up the latest reply.”</span></div>' +
          '<div><b>Private by design</b><span>Everything stays on this tablet. No account, no cloud, no subscription.</span></div>' +
          '<div><b>Ready with a demonstration</b><span>A sample chamber is loaded so you may see it work. Clear it in one tap when you begin.</span></div>' +
          '<div><b>Make it yours</b><span>Set your name, choose a British voice, and allow notifications for briefings and deadlines.</span></div>' +
          '</div>' +
          '</div>' +
          '<div class="welcome-card">' +
          '<p class="eyebrow">Voice</p>' +
          '<p class="welcome-quote">“Good morning, Sir. You have four matters listed today, and the rejoinder in the Sharma matter is still pending your final review.”</p>' +
          '<p class="tiny muted" style="margin-bottom:14px">For the most convincing British timbre, install the Google Text-to-Speech voice pack “English (United Kingdom)” from Android settings. I shall then sound rather more like myself.</p>' +
          '<label class="welcome-check"><input type="checkbox" id="welcomeSpeak" checked> Let me speak the welcome aloud</label>' +
          '</div>' +
          '</div>',
        foot: '<button class="ghost-btn" data-action="onboard-begin">Begin quietly</button>' +
          '<button class="primary-btn" data-action="onboard-tour">Begin with Jarvis</button>'
      });
      App._welcomeSheet = sheet;
    },

    finishWelcome(tour) {
      const speak = document.getElementById('welcomeSpeak');
      const shouldSpeak = tour || (speak && speak.checked);
      S.set('onboarded', true);
      S.set('greetOnOpen', !!shouldSpeak);
      if (App._welcomeSheet) App.closeSheet(App._welcomeSheet.root, true);
      else App.closeTopSheet();
      App.renderAll();
      if (shouldSpeak) {
        setTimeout(() => {
          const st = J.stats();
          const text = I.fullHindi()
            ? I.greeting() + ' मैं लीगल जार्विस हूँ, आपका चैंबर सहायक। ' + J.stageLine() + ' मैं आपकी आज्ञा की प्रतीक्षा में हूँ।'
            : I.greeting() + ' I am Legal Jarvis, your chamber assistant. ' + J.stageLine() +
              ' The sample register is before you. When you are ready to begin in earnest, say “clear sample data”, and the chamber becomes entirely yours.';
          J.speakReply(J.reply([{ text, lang: I.fullHindi() ? 'hi' : 'en' }]), true);
        }, 500);
      }
      if (shouldSpeak) S.set('lastBriefDate', U.todayISO());
      else setTimeout(App.maybeAutoBrief, 1500);
      App.askNotifyPermission();
    },

    /* ---------------- misc ---------------- */
    toast(message, kind, ms) {
      const el = document.createElement('div');
      el.className = 'toast ' + (kind || '');
      el.innerHTML = '<span class="dot"></span><span>' + U.esc(message) + '</span>';
      App.els.toastRoot.appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; setTimeout(() => el.remove(), 260); }, ms || 3600);
    },

    confirmDelete(kind, id) {
      const labels = { hearing: 'hearing date', task: 'task', reminder: 'reminder' };
      App.openSheet({
        eyebrow: 'Confirm', title: 'Remove this ' + (labels[kind] || 'record') + '?',
        sub: 'This cannot be undone.', narrow: true,
        body: '<p class="form-note" style="margin-top:0">The record will be deleted from this tablet.</p>',
        foot: '<button class="ghost-btn" data-action="close-sheet">Cancel</button>' +
          '<button class="danger-btn" data-action="do-delete" data-payload="' + encodeURIComponent(JSON.stringify({ kind, id })) + '">Delete</button>'
      });
    },

    async doDelete(kind, id) {
      if (kind === 'hearing') await Repo.deleteHearing(id);
      else if (kind === 'task') await Repo.remove('tasks', id);
      else if (kind === 'reminder') {
        await Repo.remove('reminders', id);
        await Bridge.cancelAlarm(id);
      }
      App.closeTopSheet();
      App.renderAll();
      App.toast('Removed.', 'ok');
    },

    confirmDeleteMatter(id) {
      const m = Repo.matter(id);
      if (!m) return;
      App.openSheet({
        eyebrow: 'Confirm', title: 'Remove this matter?',
        sub: m.title, narrow: true,
        body: '<p class="form-note" style="margin-top:0">Hearing dates, tasks and reminders for this matter will also be removed. Linked documents will remain in the archive, marked as unlinked.</p>',
        foot: '<button class="ghost-btn" data-action="close-sheet">Cancel</button>' +
          '<button class="danger-btn" data-action="do-delete-matter" data-id="' + U.esc(id) + '">Remove matter</button>'
      });
    },

    async doDeleteMatter(id) {
      await Repo.deleteMatter(id);
      App.closeTopSheet();
      App.renderAll();
      App.toast('Matter removed from the register.', 'ok');
    },

    renderSettings() { if (LJ.SetupUI) LJ.SetupUI.render(); }
  };

  /* small helpers */
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c === '\r') { /* skip */ }
        else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    const clean = rows.filter(r => r.some(c => String(c).trim() !== ''));
    if (clean.length < 2) return [];
    const headers = clean[0].map(h => String(h).replace(/^\uFEFF/, '').trim());
    return clean.slice(1).map(r => {
      const o = {};
      headers.forEach((h, i) => { o[h || ('col' + i)] = (r[i] || '').trim(); });
      return o;
    });
  }

  function normaliseDate(s) {
    if (!s) return '';
    const t = String(s).trim();
    const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    const dmy = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (dmy) {
      let y = +dmy[3]; if (y < 100) y += 2000;
      return y + '-' + String(+dmy[2]).padStart(2, '0') + '-' + String(+dmy[1]).padStart(2, '0');
    }
    return J.parseWhen(t) ? J.parseWhen(t).iso : '';
  }

  function n(count, singular, plural) {
    return count + ' ' + (count === 1 ? singular : (plural || singular + 's'));
  }

  LJ.App = App;
  window.App = App;

  document.addEventListener('DOMContentLoaded', () => { App.init(); });
  if (document.readyState !== 'loading') App.init();
})();
