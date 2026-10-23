/* ============================================================
   Legal Jarvis — Overview, Matters, Diary and the Add/Edit forms
   ============================================================ */
(function () {
  'use strict';
  const U = LJ.Utils;
  const S = LJ.Settings;
  const Repo = LJ.Repo;
  const I = LJ.I18N;
  const J = LJ.Jarvis;
  const App = LJ.App;
  const Docs = LJ.Docs;
  const Bridge = LJ.Bridge;

  const esc = U.esc;
  const enc = obj => encodeURIComponent(JSON.stringify(obj || {}));

  const ICO = {
    scale: '<svg viewBox="0 0 24 24"><path d="M11 3h2v2.2c2.7.4 4.8 1.7 6 3.8l-1.7 1c-.9-1.5-2.4-2.4-4.3-2.7V19h3v2H8v-2h3V7.3c-1.9.3-3.4 1.2-4.3 2.7l-1.7-1c1.2-2.1 3.3-3.4 6-3.8V3Z"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><path d="M7 2h2v2h6V2h2v2h3v18H4V4h3V2Zm13 7H6v11h14V9Z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M9.6 16.6 5 12l1.4-1.4 3.2 3.2 7.9-7.9L19 7.4l-9.4 9.2Z"/></svg>',
    draft: '<svg viewBox="0 0 24 24"><path d="M6 2h8l6 6v14H6V2Zm7 2v5h5l-5-5ZM8 13h8v2H8v-2Zm0 4h6v2H8v-2Z"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8Zm1-9.4V6h-2v6l4.8 2.9 1-1.6-3.8-2.3Z"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M6 2h8l6 6v14H6V2Zm7 2v5h5l-5-5Z"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M12 2a6 6 0 0 0-6 6v4l-2 4v2h16v-2l-2-4V8a6 6 0 0 0-6-6Zm0 20a3 3 0 0 0 3-3H9a3 3 0 0 0 3 3Z"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>'
  };

  const Views = {};

  /* ============================================================
     OVERVIEW
     ============================================================ */
  Views.renderOverview = function () {
    const el = App.els.overviewBody;
    if (!el) return;
    const st = J.stats();
    const today = U.todayISO();
    const tomorrow = U.isoOf(U.addDays(today, 1));
    const active = Repo.data.matters.filter(m => m.status !== 'disposed');
    const docs = Repo.data.documents;
    const unlinked = docs.filter(d => !d.matterId).length;
    const sample = Repo.data.matters.some(m => m.sample);
    const hearings = Repo.data.hearings.filter(h => h.date === today || h.date === tomorrow);
    const grouped = [today, tomorrow].filter(d => hearings.some(h => h.date === d));

    const kpi = (icon, num, label, sub, cls) =>
      '<div class="kpi"><div class="kpi-icon ' + (cls || '') + '">' + icon + '</div><div><b>' + num + '</b><span>' + esc(label) + '</span>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div></div>';

    const causeHtml = grouped.length ? grouped.map(date => {
      const list = Repo.hearingsOn(date);
      return '<div class="day-group" style="margin:0 0 12px">' +
        '<div class="day-head" style="padding-bottom:5px;margin-bottom:4px"><h3 style="font-size:15px">' + esc(I.date(date, { weekday: true })) + '</h3>' +
        '<span class="day-rel">' + (date === today ? (I.fullHindi() ? 'आज' : 'Today') : (I.fullHindi() ? 'कल' : 'Tomorrow')) + '</span>' +
        '<span class="day-count">' + list.length + '</span></div>' +
        list.map(h => {
          const m = Repo.matter(h.matterId);
          if (!m) return '';
          const carry = Repo.docsFor(m.id).filter(d => ['Petition', 'Plaint', 'Reply', 'Rejoinder', 'Evidence', 'Order', 'Application', 'Written Statement'].includes(d.type)).slice(0, 2);
          return '<div class="cause-item" data-action="open-matter" data-id="' + esc(m.id) + '" style="cursor:pointer">' +
            '<div class="cause-time"><b>' + esc(h.time ? I.time(h.time) : '—') + '</b><span>' + (h.itemNo ? 'Item ' + esc(h.itemNo) : 'Listed') + '</span></div>' +
            '<div class="cause-main"><strong>' + esc(m.title) + '</strong>' +
            '<div class="cause-sub"><span>' + esc(m.court || '') + '</span>' + (m.client ? '<span>' + esc(m.client) + '</span>' : '') + '</div>' +
            (carry.length ? '<div class="carry">' + carry.map(d => '<span class="badge cyan">' + esc(d.type) + '</span>').join('') + '</div>' : '') +
            '</div></div>';
        }).join('') + '</div>';
    }).join('') : '<div class="empty" style="padding:30px 18px"><h3>' + (I.fullHindi() ? 'कल और आज कोई पेशी नहीं' : 'No listings today or tomorrow') + '</h3><p>' + (I.fullHindi() ? 'डायरी तुलनात्मक रूप से शांत है।' : 'A rare lull in the diary. Use it well, Sir.') + '</p><button class="ghost-btn" data-action="new-hearing">+ Add a date</button></div>';

    const agenda = Repo.openTasks().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 6);
    const agendaHtml = agenda.length ? agenda.map(t => {
      const m = Repo.matter(t.matterId);
      const overdue = t.due && t.due < today;
      return '<div class="check-row' + (t.done ? ' done' : '') + '"><input type="checkbox" data-action="toggle-task" data-id="' + esc(t.id) + '">' +
        '<span><span>' + esc(t.title) + '</span>' + (m ? ' <em class="tiny muted">· ' + esc(m.title) + '</em>' : '') +
        (t.due ? '<span class="due">' + (overdue ? 'overdue · ' : '') + esc(I.shortDate(t.due)) + '</span>' : '') + '</span></div>';
    }).join('') : '<p class="tiny muted">The desk is clear, Sir.</p>';

    const reminders = Repo.upcomingReminders(10).slice(0, 5);
    const remHtml = reminders.length ? reminders.map(r => {
      const days = U.daysBetween(today, r.date);
      return '<div class="agenda-row"><div class="agenda-when">' + (days === 0 ? (I.fullHindi() ? 'आज' : 'Today') : days === 1 ? (I.fullHindi() ? 'कल' : 'Tomorrow') : esc(I.shortDate(r.date))) + '</div>' +
        '<div class="what"><strong>' + esc(r.title) + '</strong>' + (r.matterId && Repo.matter(r.matterId) ? esc(Repo.matter(r.matterId).title) : esc(r.kind || 'Reminder')) + '</div></div>';
    }).join('') : '<p class="tiny muted">No reminders in the next ten days.</p>';

    const drafts = docs.filter(d => d.status === 'in-progress').slice(0, 5);
    const draftHtml = drafts.length ? drafts.map(d => {
      const m = d.matterId && Repo.matter(d.matterId);
      return '<button class="doc-mini" data-action="open-doc" data-id="' + esc(d.id) + '">' +
        '<span class="ext ' + esc((d.ext || '').toLowerCase()) + '">' + esc((d.ext || 'doc').toUpperCase()) + '</span>' +
        '<span class="name">' + esc(d.name) + (m ? '<span class="tiny muted" style="display:block;overflow:hidden;text-overflow:ellipsis">' + esc(m.title) + '</span>' : '') + '</span>' +
        '<span class="when">' + esc(I.shortDate(Docs.docAge(d))) + '</span></button>';
    }).join('') : '<p class="tiny muted">No unfinished drafts. The archive is tidy.</p>';

    const recent = U.sortBy(docs, d => d.addedAt || '', -1).slice(0, 4);
    const recentHtml = recent.length ? recent.map(d =>
      '<button class="doc-mini" data-action="open-doc" data-id="' + esc(d.id) + '"><span class="ext ' + esc((d.ext || '').toLowerCase()) + '">' + esc((d.ext || 'doc').toUpperCase()) + '</span>' +
      '<span class="name">' + esc(d.name) + '</span><span class="when">' + esc(I.shortDate(Docs.docAge(d))) + '</span></button>').join('') :
      '<p class="tiny muted">No documents yet. Import your first papers.</p>';

    el.innerHTML =
      '<div class="overview-hero">' +
      '<div><h2>' + esc(I.greeting()) + '</h2><p>' + esc(I.today(I.fullHindi())) + ' · ' + (I.fullHindi() ? active.length + ' सक्रिय मामले · ' + Repo.data.documents.length + ' दस्तावेज़' : active.length + ' active matters · ' + Repo.data.documents.length + ' documents in the archive') + '</p></div>' +
      '<div class="hero-date">' +
      '<button class="primary-btn" data-action="brief">' + (I.fullHindi() ? 'ब्रीफिंग सुनिए' : 'Hear my briefing') + '</button>' +
      '<button class="ghost-btn" data-action="carry">' + (I.fullHindi() ? 'क्या ले जाना है' : 'What to carry') + '</button>' +
      '</div></div>' +
      (sample ? '<div class="sample-banner"><div><strong>Demonstration chamber</strong><span>' + (I.fullHindi() ? 'कुछ प्रविष्टियाँ नमूने की हैं। जब आप तैयार हों, एक टैप में हटा दें।' : 'A handful of records are samples so you can see the system work. Clear them in one tap when you begin.') + '</span></div>' +
        '<button class="ghost-btn small" data-action="clear-samples">Clear sample data</button></div>' : '') +
      '<div class="kpi-grid">' +
      kpi(ICO.scale, active.length, I.fullHindi() ? 'सक्रिय मामले' : 'Active matters', (I.fullHindi() ? 'कुल ' : '') + Repo.data.matters.length + (I.fullHindi() ? ' पंजीकृत' : ' on the register')) +
      kpi(ICO.calendar, Repo.data.hearings.filter(h => h.date === tomorrow).length, I.fullHindi() ? 'कल की पेशी' : 'Listed tomorrow', I.date(tomorrow, { weekday: true, year: false }), 'cyan') +
      kpi(ICO.check, Repo.openTasks().length, I.fullHindi() ? 'खुले कार्य' : 'Open chamber tasks', st.overdue.length ? st.overdue.length + ' overdue' : 'Nothing overdue') +
      kpi(ICO.draft, st.drafts.length, I.fullHindi() ? 'प्रारूप समीक्षा' : 'Drafts to review', unlinked ? (I.fullHindi() ? unlinked + ' बिना मामले के' : unlinked + ' papers unlinked') : 'All papers linked') +
      '</div>' +
      '<div class="overview-grid"><div class="stack">' +
      '<div class="card"><div class="card-head"><h3 class="card-title">' + (I.fullHindi() ? 'आज और कल की सूची' : 'Cause list — today & tomorrow') + '</h3><button class="ghost-btn small" data-action="diary">' + (I.fullHindi() ? 'पूरी डायरी' : 'Full diary') + '</button></div>' + causeHtml + '</div>' +
      '<div class="card"><div class="card-head"><h3 class="card-title">' + (I.fullHindi() ? 'चैंबर कार्य' : 'Chamber agenda') + '</h3><button class="ghost-btn small" data-action="new-task">+ ' + (I.fullHindi() ? 'कार्य' : 'Task') + '</button></div>' + agendaHtml + '</div>' +
      '</div><div class="stack">' +
      '<div class="card"><div class="card-head"><h3 class="card-title">' + (I.fullHindi() ? 'समय-सीमाएँ और स्मरण' : 'Deadlines & reminders') + '</h3><button class="ghost-btn small" data-action="new-reminder">+ ' + (I.fullHindi() ? 'रिमाइंडर' : 'Reminder') + '</button></div>' + remHtml + '</div>' +
      '<div class="card"><div class="card-head"><h3 class="card-title">' + (I.fullHindi() ? 'प्रारूप — अंतिम समीक्षा हेतु' : 'Drafts awaiting review') + '</h3><button class="ghost-btn small" data-action="drafts">' + (I.fullHindi() ? 'सभी' : 'All') + '</button></div>' + draftHtml + '</div>' +
      '<div class="card"><div class="card-head"><h3 class="card-title">' + (I.fullHindi() ? 'हाल के दस्तावेज़' : 'Recently filed') + '</h3><button class="ghost-btn small" data-action="documents">' + (I.fullHindi() ? 'संग्रह' : 'Archive') + '</button></div>' + recentHtml + '</div>' +
      '</div></div>';
  };

  /* ============================================================
     MATTERS
     ============================================================ */
  Views.renderMatters = function () {
    const el = App.els.mattersBody;
    if (!el) return;
    const today = U.todayISO();
    const q = App.state.matterSearch;
    const filter = App.state.matterFilter;
    let matters = Repo.data.matters.slice();
    if (filter === 'active') matters = matters.filter(m => m.status !== 'disposed');
    if (filter === 'disposed') matters = matters.filter(m => m.status === 'disposed');
    if (filter === 'week') {
      const end = U.isoOf(U.addDays(today, 7));
      matters = matters.filter(m => m.nextHearing && m.nextHearing >= today && m.nextHearing <= end);
    }
    if (q) {
      matters = matters.map(m => ({ m, s: LJ.scoreText(q, [m.title, m.titleHi, m.client, m.clientHi, m.court, m.caseNo, m.cnr, (m.stage || '')].join(' ')) }))
        .filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.m);
    } else {
      matters.sort((a, b) => {
        const ad = a.nextHearing || '9999-99-99';
        const bd = b.nextHearing || '9999-99-99';
        if (ad !== bd) return ad.localeCompare(bd);
        return (a.title || '').localeCompare(b.title || '');
      });
    }
    if (!matters.length) {
      el.innerHTML = '<div class="empty"><h3>' + (I.fullHindi() ? 'कोई मामला नहीं मिला' : 'No matters found') + '</h3><p>' + (I.fullHindi() ? 'नया मामला जोड़ें — ई-कोर्ट्स से या स्वयं।' : 'Add a matter manually, or import your e-Courts register. Once entered, I track it like any other.') + '</p><button class="primary-btn" data-action="new-case">+ New matter</button></div>';
      return;
    }
    el.innerHTML = matters.map(m => Views.matterCard(m)).join('');
  };

  Views.matterCard = function (m) {
    const today = U.todayISO();
    const next = m.nextHearing;
    const days = next ? U.daysBetween(today, next) : null;
    const cls = days == null ? '' : days === 0 ? ' today' : days <= 3 ? ' soon' : '';
    const tasks = Repo.tasksFor(m.id).filter(t => !t.done);
    const docs = Repo.docsFor(m.id);
    const drafts = docs.filter(d => d.status === 'in-progress');
    const tags = (m.tags && m.tags.length ? m.tags : (m.tag ? [m.tag] : [])).slice(0, 2);
    const done = Repo.tasksFor(m.id).filter(t => t.done).length;
    const total = Repo.tasksFor(m.id).length;
    return '<article class="matter-card" data-action="open-matter" data-id="' + esc(m.id) + '" tabindex="0">' +
      '<div class="matter-top"><h3>' + esc(m.title) + (m.titleHi ? '<span class="hi-sub">' + esc(m.titleHi) + '</span>' : '') + '</h3>' +
      '<span class="badge ' + (m.status === 'disposed' ? 'green' : 'gold') + '">' + esc(m.status === 'disposed' ? 'Disposed' : (m.source === 'ecourts' ? 'e-Courts' : m.sample ? 'Sample' : 'Manual')) + '</span></div>' +
      '<div class="matter-client">' + esc(m.client || m.opposite || 'Client not recorded') + (m.caseNo ? '<span class="dot-sep">·</span> No. ' + esc(m.caseNo) + (m.year ? '/' + esc(m.year) : '') : '') + (m.cnr ? '<span class="dot-sep">·</span> CNR ' + esc(m.cnr) : '') + '</div>' +
      '<div class="matter-meta">' + (m.court ? '<span class="badge">' + esc(m.court) + '</span>' : '') + tags.map(t => '<span class="badge ' + (I.isHindiText(t) ? 'hi gold' : 'cyan') + '">' + esc(t) + '</span>').join('') + '</div>' +
      '<div class="muted tiny" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + esc(m.stage || 'Stage not recorded.') + '</div>' +
      '<div class="matter-foot">' +
      '<div class="next-date' + cls + '">' + (next ? '<b>' + esc(I.shortDate(next)) + '</b><span>' + (days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'next') + '</span>' : '<span class="badge">No date</span>') + '</div>' +
      '<div class="case-progress">' + (tasks.length ? tasks.length + ' open' : 'clear') + (drafts.length ? ' · ' + drafts.length + ' draft' : '') + '<div class="progress-bar"><i style="width:' + (total ? Math.round((done / total) * 100) : 0) + '%"></i></div></div>' +
      '</div></article>';
  };

  /* ---------------- matter sheet ---------------- */
  let caseSheet = null;

  Views.openMatter = function (id, tab) {
    const m = Repo.matter(id);
    if (!m) { App.toast('Matter not found.', 'err'); return; }
    if (caseSheet && caseSheet.root && caseSheet.root.isConnected) App.closeSheet(caseSheet.root, true);
    const sheet = App.openSheet({
      eyebrow: 'Matter profile',
      title: m.title,
      sub: [m.client, m.court].filter(Boolean).join(' · '),
      wide: true,
      body: '',
      foot:
        '<button class="ghost-btn" data-action="edit-matter" data-id="' + esc(m.id) + '">Edit matter</button>' +
        '<button class="ghost-btn" data-action="new-hearing" data-id="' + esc(m.id) + '">+ Date</button>' +
        '<button class="ghost-btn" data-action="new-task" data-id="' + esc(m.id) + '">+ Task</button>' +
        '<button class="primary-btn" data-action="deliverable" data-id="' + esc(m.id) + '">Brief me on this</button>'
    });
    caseSheet = { root: sheet.root, id, tab: tab || 'profile' };
    sheet.root.querySelector('.sheet-body').innerHTML = Views.caseBody(m, caseSheet.tab);
    sheet.root.addEventListener('click', e => {
      const t = e.target.closest('[data-case-tab]');
      if (!t) return;
      e.preventDefault();
      caseSheet.tab = t.dataset.caseTab;
      Views.refreshSheets();
    });
  };

  Views.caseBody = function (m, tab) {
    const today = U.todayISO();
    const next = Repo.data.hearings.filter(h => h.matterId === m.id && h.date >= today).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))[0];
    const tasks = Repo.tasksFor(m.id);
    const openTasks = tasks.filter(t => !t.done);
    const procs = openTasks.filter(t => t.kind === 'process');
    const chamber = openTasks.filter(t => t.kind !== 'process');
    const docs = Repo.docsFor(m.id);
    const drafts = docs.filter(d => d.status === 'in-progress');
    const hearings = Repo.hearingsFor(m.id);
    const reminders = Repo.data.reminders.filter(r => r.matterId === m.id && !r.dismissed);
    const tabs = [
      { id: 'profile', label: I.fullHindi() ? 'प्रोफ़ाइल' : 'Profile' },
      { id: 'dates', label: I.fullHindi() ? 'तिथियाँ' : 'Dates' },
      { id: 'work', label: I.fullHindi() ? 'कार्य' : 'Work' },
      { id: 'papers', label: I.fullHindi() ? 'दस्तावेज़' : 'Papers' },
      { id: 'notes', label: I.fullHindi() ? 'टिप्पणियाँ' : 'Notes' }
    ];

    let html =
      '<div class="case-hero"><div class="tag-row">' +
      (m.tags || []).map(t => '<span class="badge gold">' + esc(t) + '</span>').join('') +
      '<span class="badge ' + (m.status === 'disposed' ? 'green' : 'cyan') + '">' + esc(m.status || 'active') + '</span>' +
      (m.cnr ? '<span class="badge">CNR ' + esc(m.cnr) + '</span>' : '') +
      '</div>' +
      (m.titleHi ? '<p class="hi-sub-large">' + esc(m.titleHi) + '</p>' : '') +
      '<div class="case-line">' +
      (m.client ? '<span><b>Client</b> ' + esc(m.client) + (m.clientHi ? ' · ' + esc(m.clientHi) : '') + '</span>' : '') +
      (m.opposite ? '<span><b>Opposite</b> ' + esc(m.opposite) + '</span>' : '') +
      (m.court ? '<span><b>Court</b> ' + esc(m.court) + '</span>' : '') +
      (m.caseNo ? '<span><b>Case</b> ' + esc(m.caseNo) + (m.year ? '/' + esc(m.year) : '') + '</span>' : '') +
      '</div></div>' +
      '<div class="case-strip">' +
      '<div class="case-stat"><span>' + (I.fullHindi() ? 'अगली तिथि' : 'Next listing') + '</span><strong class="gold">' + (next ? esc(I.date(next.date, { weekday: false })) + (next.time ? ' · ' + esc(I.time(next.time)) : '') : 'Not dated') + '</strong></div>' +
      '<div class="case-stat"><span>' + (I.fullHindi() ? 'प्रक्रिया शेष' : 'Procedure pending') + '</span><strong>' + procs.length + ' item' + (procs.length === 1 ? '' : 's') + '</strong></div>' +
      '<div class="case-stat"><span>' + (I.fullHindi() ? 'दस्तावेज़' : 'Papers filed') + '</span><strong>' + docs.length + ' linked' + (drafts.length ? ' · ' + drafts.length + ' draft' : '') + '</strong></div>' +
      '</div>' +
      '<div class="detail-tabs">' + tabs.map(t => '<button data-case-tab="' + t.id + '" class="' + (t.id === tab ? 'is-active' : '') + '">' + esc(t.label) + '</button>').join('') + '</div>';

    if (tab === 'profile') {
      html += '<div class="detail-panel">' +
        '<div class="card" style="margin-bottom:12px"><div class="card-head"><h3 class="card-title">' + (I.fullHindi() ? 'वर्तमान स्थिति' : 'Current stage') + '</h3><button class="ghost-btn small" data-action="edit-matter" data-id="' + esc(m.id) + '">Update</button></div>' +
        '<p style="margin:0;font-size:13.5px;line-height:1.65">' + esc(m.stage || 'Not recorded yet.') + '</p>' +
        (m.stageHi ? '<p class="hi-sub-large" style="margin:8px 0 0">' + esc(m.stageHi) + '</p>' : '') +
        (next ? '<p class="tiny muted" style="margin:10px 0 0">Next listing before ' + esc(next.court || m.court || 'court') + ' on ' + esc(I.date(next.date, { weekday: true })) + (next.purpose ? ' — ' + esc(next.purpose) : '') + '</p>' : '') +
        '</div>' +
        '<div class="card" style="margin-bottom:12px"><div class="card-head"><h3 class="card-title">' + (I.fullHindi() ? 'अगली तिथि से पूर्व प्रक्रिया' : 'Procedure before the next date') + '</h3><button class="ghost-btn small" data-action="new-task" data-id="' + esc(m.id) + '" data-payload="' + enc({ kind: 'process' }) + '">+ Step</button></div>' +
        (procs.length ? procs.map(t => Views.taskRow(t, m)).join('') : '<p class="tiny muted" style="margin:0">No procedural step is pending.</p>') +
        '</div>' +
        '<div class="card" style="margin-bottom:12px"><div class="card-head"><h3 class="card-title">' + (I.fullHindi() ? 'चैंबर कार्य' : 'On the chamber desk') + '</h3><button class="ghost-btn small" data-action="new-task" data-id="' + esc(m.id) + '">+ Task</button></div>' +
        (chamber.length ? chamber.map(t => Views.taskRow(t, m)).join('') : '<p class="tiny muted" style="margin:0">Nothing pending on the desk for this matter.</p>') +
        '</div>' +
        '<div class="card"><div class="card-head"><h3 class="card-title">' + (I.fullHindi() ? 'जुड़े प्रारूप' : 'Linked drafts') + '</h3><button class="ghost-btn small" data-action="import-files">+ Import</button></div>' +
        (docs.length ? docs.slice(0, 4).map(d => Views.docRow(d, true)).join('') : '<p class="tiny muted" style="margin:0">No papers linked yet.</p>') +
        '</div></div>';
    } else if (tab === 'dates') {
      html += '<div class="detail-panel">' +
        '<div class="toolbar" style="margin-bottom:10px"><span class="tiny muted">' + hearings.length + ' recorded date' + (hearings.length === 1 ? '' : 's') + '</span><span class="toolbar-spacer"></span>' +
        '<button class="primary-btn" data-action="new-hearing" data-id="' + esc(m.id) + '">+ Add date</button></div>' +
        (hearings.length ? hearings.map(h => {
          const past = h.date < today;
          return '<div class="list-item-row" style="opacity:' + (past ? '0.55' : '1') + '">' +
            '<div class="grow"><strong style="font-family:var(--mono);font-size:12px;color:var(--gold-bright)">' + esc(I.date(h.date, { weekday: true })) + (h.time ? ' · ' + esc(I.time(h.time)) : '') + '</strong>' +
            '<div class="sub">' + esc(h.court || m.court || '') + (h.itemNo ? ' · Item ' + esc(h.itemNo) : '') + (h.purpose ? ' — ' + esc(h.purpose) : '') + '</div>' +
            (h.note ? '<div class="sub">' + esc(h.note) + '</div>' : '') + '</div>' +
            '<div class="row-actions"><button class="icon-tiny" title="Edit" data-action="edit-hearing" data-id="' + esc(h.id) + '" data-matter-id="' + esc(m.id) + '">✎</button>' +
            '<button class="icon-tiny del" title="Delete" data-action="delete-hearing" data-id="' + esc(h.id) + '">🗑</button></div></div>';
        }).join('') : '<div class="empty" style="padding:26px"><p>No dates recorded. Add the next listing.</p></div>') +
        '</div>';
    } else if (tab === 'work') {
      html += '<div class="detail-panel">' +
        '<div class="card" style="margin-bottom:12px"><div class="card-head"><h3 class="card-title">Open work</h3><button class="ghost-btn small" data-action="new-task" data-id="' + esc(m.id) + '">+ Task</button></div>' +
        (openTasks.length ? openTasks.map(t => Views.taskRow(t, m)).join('') : '<p class="tiny muted" style="margin:0">All clear.</p>') + '</div>' +
        '<div class="card" style="margin-bottom:12px"><div class="card-head"><h3 class="card-title">Reminders</h3><button class="ghost-btn small" data-action="new-reminder" data-payload="' + enc({ matterId: m.id }) + '">+ Reminder</button></div>' +
        (reminders.length ? reminders.map(r => '<div class="list-item-row"><div class="grow"><strong style="font-size:12.5px">' + esc(r.title) + '</strong><div class="sub">' + esc(I.date(r.date, { weekday: true })) + ' · ' + esc(r.kind || 'reminder') + '</div></div>' +
          '<div class="row-actions"><button class="icon-tiny" data-action="edit-reminder" data-id="' + esc(r.id) + '">✎</button>' +
          '<button class="icon-tiny del" data-action="delete-reminder" data-id="' + esc(r.id) + '">🗑</button></div></div>').join('') : '<p class="tiny muted" style="margin:0">No reminders for this matter.</p>') + '</div>' +
        '<div class="card"><div class="card-head"><h3 class="card-title">Completed</h3></div>' +
        (tasks.filter(t => t.done).length ? tasks.filter(t => t.done).slice(0, 8).map(t => Views.taskRow(t, m)).join('') : '<p class="tiny muted" style="margin:0">Nothing completed yet.</p>') + '</div>' +
        '</div>';
    } else if (tab === 'papers') {
      html += '<div class="detail-panel">' +
        '<div class="toolbar" style="margin-bottom:10px"><span class="tiny muted">' + docs.length + ' papers · ' + drafts.length + ' draft' + (drafts.length === 1 ? '' : 's') + '</span><span class="toolbar-spacer"></span>' +
        '<button class="ghost-btn" data-action="import-files">+ Import papers</button><button class="ghost-btn" data-action="documents">Archive</button></div>' +
        (docs.length ? docs.map(d => Views.docRow(d, true)).join('') : '<div class="empty" style="padding:26px"><p>No document is linked to this matter yet. Import a PDF or Word file and I shall file it here.</p></div>') +
        '</div>';
    } else {
      html += '<div class="detail-panel"><div class="card"><div class="card-head"><h3 class="card-title">Chamber notes</h3><button class="ghost-btn small" data-action="edit-matter" data-id="' + esc(m.id) + '">Edit</button></div>' +
        '<p style="font-size:13px;line-height:1.7;white-space:pre-wrap;margin:0">' + esc(m.notes || 'No notes recorded.') + '</p></div>' +
        '<div class="card" style="margin-top:12px"><div class="card-head"><h3 class="card-title">Record</h3></div>' +
        '<div class="about-lines">' +
        '<div><b>Source</b> ' + esc(m.source === 'ecourts' ? 'e-Courts import' : m.source === 'sample' ? 'Demonstration data' : 'Entered manually') + '</div>' +
        '<div><b>Side</b> ' + esc(m.side || '—') + '</div>' +
        '<div><b>CNR</b> ' + esc(m.cnr || '—') + '</div>' +
        '<div><b>Last updated</b> ' + esc((m.updatedAt || '').slice(0, 10) || '—') + '</div>' +
        '</div></div>' +
        '<div style="margin-top:14px;text-align:right"><button class="danger-btn" data-action="delete-matter" data-id="' + esc(m.id) + '">Remove this matter</button></div>' +
        '</div>';
    }
    return html;
  };

  Views.taskRow = function (t, m) {
    const overdue = !t.done && t.due && t.due < U.todayISO();
    return '<div class="check-row' + (t.done ? ' done' : '') + '">' +
      '<input type="checkbox" ' + (t.done ? 'checked' : '') + ' data-action="toggle-task" data-id="' + esc(t.id) + '">' +
      '<span style="flex:1"><span>' + esc(t.title) + '</span> ' +
      (t.kind === 'process' ? '<span class="badge">process</span>' : '') +
      (t.due ? '<span class="due">' + (overdue ? 'overdue · ' : '') + esc(I.shortDate(t.due)) + '</span>' : '') +
      (t.titleHi ? '<span class="hi-sub" style="display:block">' + esc(t.titleHi) + '</span>' : '') + '</span>' +
      '<span class="row-actions"><button class="icon-tiny" data-action="edit-task" data-id="' + esc(t.id) + '" data-matter-id="' + esc(t.matterId || '') + '">✎</button>' +
      '<button class="icon-tiny del" data-action="delete-task" data-id="' + esc(t.id) + '">🗑</button></span></div>';
  };

  Views.docRow = function (d, compact) {
    const m = d.matterId ? Repo.matter(d.matterId) : null;
    return '<div class="list-item-row"><span class="ext ' + esc((d.ext || '').toLowerCase()) + '">' + esc((d.ext || 'doc').toUpperCase()) + '</span>' +
      '<div class="grow"><strong style="font-size:12.5px">' + esc(d.name) + '</strong>' +
      '<div class="sub">' + esc(d.type || 'Document') + ' · ' + esc(I.shortDate(Docs.docAge(d))) + (compact && m ? ' · ' + esc(m.title) : '') + (d.status === 'in-progress' ? ' · <span style="color:var(--warn)">draft</span>' : '') + '</div></div>' +
      '<div class="row-actions"><button class="icon-tiny" title="Open" data-action="open-doc" data-id="' + esc(d.id) + '">↗</button></div></div>';
  };

  Views.refreshSheets = function () {
    if (!caseSheet || !caseSheet.root || !caseSheet.root.isConnected) return;
    const m = Repo.matter(caseSheet.id);
    if (!m) { App.closeSheet(caseSheet.root, true); caseSheet = null; return; }
    const body = caseSheet.root.querySelector('.sheet-body');
    if (body) body.innerHTML = Views.caseBody(m, caseSheet.tab);
    const sub = caseSheet.root.querySelector('.sheet-sub');
    if (sub) sub.textContent = [m.client, m.court].filter(Boolean).join(' · ');
  };

  /* ---------------- case form ---------------- */
  Views.openCaseForm = function (id, isEdit, prefill) {
    prefill = prefill || {};
    const m = id ? Repo.matter(id) : null;
    const v = m ? Object.assign({}, m) : Object.assign({ status: 'active', courtType: 'District Court', side: 'Petitioner' }, prefill);
    const courts = U.unique(Repo.courts().concat([
      'Rajasthan High Court, Jaipur Bench', 'District & Sessions Court, Jaipur Metropolitan',
      'Civil Judge (Jr. Division), Jaipur Metropolitan', 'Family Court, Jaipur',
      'Revenue Appellate Authority, Jaipur', 'Central Administrative Tribunal, Jaipur'
    ]));
    const courtTypes = ['High Court', 'District Court', 'Civil Court', 'Family Court', 'Revenue Court', 'Tribunal', 'Consumer Forum', 'Labour Court', 'Police Station', 'Other'];
    const sides = ['Petitioner', 'Applicant', 'Plaintiff', 'Appellant', 'Accused', 'Respondent', 'Defendant', 'Complainant'];
    const title = m ? 'Edit matter' : 'New matter';

    const sheet = App.openSheet({
      eyebrow: m ? (m.source === 'sample' ? 'Demonstration record' : 'Master register') : 'Master register',
      title: title + (m ? '' : ' — ' + (I.fullHindi() ? 'नया मामला' : 'offline or online')),
      sub: 'Enter once. I shall keep the dates, the tasks and the papers together from here on.',
      wide: true,
      body:
        '<form id="caseForm" class="form-grid" autocomplete="off">' +
        field('Case title', '<input class="input" id="cfTitle" required value="' + esc(v.title || '') + '" placeholder="e.g. State of Rajasthan v. Mahesh Sharma">', 'full', true) +
        field('Client', '<input class="input" id="cfClient" value="' + esc(v.client || '') + '" placeholder="Client name">', '', true) +
        field('Opposite party', '<input class="input" id="cfOpposite" value="' + esc(v.opposite || '') + '" placeholder="State / opposite party">') +
        field('Court / authority', '<input class="input" id="cfCourt" list="courtOptions" value="' + esc(v.court || '') + '" placeholder="Court or authority">' +
          '<datalist id="courtOptions">' + courts.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>', 'full') +
        field('Court type', '<select class="input" id="cfCourtType">' + courtTypes.map(c => '<option ' + (v.courtType === c ? 'selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>') +
        field('Case number', '<input class="input" id="cfCaseNo" value="' + esc(v.caseNo || '') + '" placeholder="42">') +
        field('Year', '<input class="input" id="cfYear" value="' + esc(v.year || '') + '" inputmode="numeric" placeholder="2023">') +
        field('CNR (if any)', '<input class="input" id="cfCnr" value="' + esc(v.cnr || '') + '" placeholder="RJJP010012342023">') +
        field('Our side', '<select class="input" id="cfSide">' + sides.map(c => '<option ' + (v.side === c ? 'selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>') +
        field('Status', '<select class="input" id="cfStatus"><option value="active" ' + (v.status !== 'disposed' ? 'selected' : '') + '>Active</option><option value="disposed" ' + (v.status === 'disposed' ? 'selected' : '') + '>Disposed</option></select>') +
        field('Current stage / last order', '<textarea class="textarea" id="cfStage" placeholder="What happened on the last date, and what stands next">' + esc(v.stage || '') + '</textarea>', 'full') +
        field('Next hearing date', '<input class="input" type="date" id="cfNext" value="' + esc(v.nextHearing || '') + '">') +
        field('Time', '<input class="input" type="time" id="cfTime" value="' + esc(m && m.nextTime ? m.nextTime : (prefill.time || '')) + '">') +
        field('Tags', '<input class="input" id="cfTags" value="' + esc((v.tags || []).join(', ')) + '" placeholder="Criminal, Revenue">') +
        field('Notes for the chamber', '<input class="input" id="cfNotes" value="' + esc(v.notes || '') + '" placeholder="Anything you wish me to remember">') +
        '<details class="hi-details" ' + ((v.titleHi || v.clientHi || v.stageHi) ? 'open' : '') + '><summary>' + (I.fullHindi() ? 'हिंदी विवरण' : 'Hindi / bilingual details') + ' <span class="tiny muted">— used when the papers are in Hindi</span></summary>' +
        '<div class="form-grid" style="margin-top:12px">' +
        field('Case title (Hindi)', '<input class="input" id="cfTitleHi" value="' + esc(v.titleHi || '') + '" placeholder="राज्य बनाम महेश शर्मा">') +
        field('Client (Hindi)', '<input class="input" id="cfClientHi" value="' + esc(v.clientHi || '') + '" placeholder="महेश शर्मा">') +
        field('Stage (Hindi)', '<input class="input" id="cfStageHi" value="' + esc(v.stageHi || '') + '" placeholder="अभियोजन साक्ष्य — पी.डब्ल्यू.-3 लंबित">', 'full') +
        '</div></details>' +
        '</form>' +
        '<p class="form-note">Everything here is stored only on this tablet. A matter entered manually is treated exactly like one imported from e-Courts: dates, procedural steps, drafts and reminders all follow automatically.</p>',
      foot: (m ? '<div class="left"><button class="danger-btn" data-action="delete-matter" data-id="' + esc(m.id) + '">Remove</button></div>' : '') +
        '<button class="ghost-btn" data-action="close-sheet">Cancel</button>' +
        '<button class="primary-btn" form="caseForm" type="submit">' + (m ? 'Save changes' : 'Add to register') + '</button>'
    });

    const form = sheet.root.querySelector('#caseForm');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      await Views.saveCase(sheet.root, m, v);
    });
    setTimeout(() => { const t = sheet.root.querySelector('#cfTitle'); if (t && !m) t.focus(); }, 120);
  };

  Views.saveCase = async function (root, existing, original) {
    const val = id => { const el = root.querySelector('#' + id); return el ? U.clean(el.value) : ''; };
    const title = val('cfTitle');
    const client = val('cfClient');
    if (!title && !client) { App.toast('A case title or client name is required, Sir.', 'err'); return; }
    const nextDate = val('cfNext');
    const time = val('cfTime');
    const rec = existing ? Object.assign({}, existing) : {
      id: U.uid('mat'), createdAt: new Date().toISOString(), source: 'manual', sample: false,
      status: 'active'
    };
    Object.assign(rec, {
      title: title || client,
      client,
      opposite: val('cfOpposite'),
      court: val('cfCourt') || 'Unspecified court',
      courtType: val('cfCourtType'),
      caseNo: val('cfCaseNo'),
      year: val('cfYear'),
      cnr: val('cfCnr'),
      side: val('cfSide'),
      status: val('cfStatus') || 'active',
      stage: val('cfStage'),
      titleHi: val('cfTitleHi'),
      clientHi: val('cfClientHi'),
      stageHi: val('cfStageHi'),
      tags: val('cfTags') ? val('cfTags').split(',').map(x => U.clean(x)).filter(Boolean) : [],
      notes: val('cfNotes'),
      source: existing && existing.source !== 'sample' ? existing.source : 'manual',
      sample: false
    });
    if (!rec.clientHi && I.isHindiText(rec.client)) rec.clientHi = rec.client;
    if (!rec.titleHi && I.isHindiText(rec.title)) rec.titleHi = rec.title;
    await Repo.saveMatter(rec);
    if (nextDate) {
      const dup = Repo.data.hearings.find(h => h.matterId === rec.id && h.date === nextDate);
      if (!dup) {
        await Repo.saveHearing({ matterId: rec.id, date: nextDate, time, court: rec.court, purpose: rec.stage || 'Next hearing', source: 'manual' });
      } else {
        dup.time = time || dup.time;
        dup.court = rec.court;
        await Repo.saveHearing(dup);
      }
      rec.nextHearing = nextDate;
      rec.nextTime = time;
      await Repo.saveMatter(rec);
    }
    App.closeTopSheet();
    App.renderAll();
    App.toast(existing ? 'Matter updated, Sir.' : 'Matter added to the register.', 'ok');
    if (!existing && J.lastReply) {
      J.speakReply(J.reply([{ text: 'Entered, ' + (S.get('ownerName') || 'Sir') + '. ' + rec.title + ' is now on the register' + (nextDate ? ', with the next date of ' + I.spokenDate(nextDate) : '') + '. I shall remind you in good time.' }]), true);
    }
  };

  /* ---------------- hearing form ---------------- */
  Views.openHearingForm = function (matterId, prefill) {
    prefill = prefill || {};
    const existing = prefill.id ? Repo.hearing(prefill.id) : null;
    const matters = Repo.data.matters.slice().sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    if (!matters.length) {
      App.toast('Add a matter first, Sir.', 'err');
      Views.openCaseForm(null, false, {});
      return;
    }
    const sel = existing ? existing.matterId : (matterId || prefill.matterId || matters[0].id);
    const date = existing ? existing.date : prefill.date || U.todayISO();
    const time = existing ? existing.time : prefill.time || '10:30';
    const court = existing ? existing.court : prefill.court || (Repo.matter(sel) || {}).court || '';
    const purpose = existing ? existing.purpose : prefill.purpose || '';
    const sheet = App.openSheet({
      eyebrow: existing ? 'Edit hearing' : 'Court diary',
      title: existing ? 'Edit this date' : (I.fullHindi() ? 'नई तिथि जोड़ें' : 'Add a hearing date'),
      sub: 'Dates entered here join the cause list, the briefings and the reminder engine.',
      body:
        '<form id="hearingForm" class="form-grid" autocomplete="off">' +
        field('Matter', '<select class="input" id="hfMatter" required>' + matters.map(m => '<option value="' + esc(m.id) + '" ' + (m.id === sel ? 'selected' : '') + '>' + esc(m.title) + '</option>').join('') + '</select>', 'full', true) +
        field('Date', '<input class="input" type="date" id="hfDate" required value="' + esc(date) + '">', '', true) +
        field('Time', '<input class="input" type="time" id="hfTime" value="' + esc(time) + '">') +
        field('Court / authority', '<input class="input" id="hfCourt" value="' + esc(court) + '" placeholder="Court before which listed">', 'full') +
        field('Purpose / stage', '<input class="input" id="hfPurpose" list="purposeOptions" value="' + esc(purpose) + '" placeholder="Arguments, evidence, orders…">' +
          '<datalist id="purposeOptions"><option value="Arguments"><option value="Evidence"><option value="Cross-examination"><option value="Final arguments"><option value="Orders"><option value="Further proceedings"><option value="Filing / compliance"></datalist>', 'full') +
        field('Item number', '<input class="input" id="hfItem" value="' + esc(existing ? existing.itemNo || '' : '') + '" placeholder="e.g. 24">') +
        field('Hindi purpose', '<input class="input" id="hfPurposeHi" value="' + esc(existing ? existing.purposeHi || '' : prefill.purposeHi || '') + '" placeholder="तर्क, साक्ष्य…">') +
        field('Note', '<input class="input" id="hfNote" value="' + esc(existing ? existing.note || '' : '') + '" placeholder="Anything to remember for this date">', 'full') +
        '</form>' +
        '<p class="form-note">Once saved, this will appear in the cause list and in both daily briefings. I shall also prompt you with the papers to carry.</p>',
      foot: (existing ? '<div class="left"><button class="danger-btn" data-action="delete-hearing" data-id="' + esc(existing.id) + '">Remove</button></div>' : '') +
        '<button class="ghost-btn" data-action="close-sheet">Cancel</button>' +
        '<button class="primary-btn" form="hearingForm" type="submit">' + (existing ? 'Save date' : 'Add to diary') + '</button>'
    });
    const form = sheet.root.querySelector('#hearingForm');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const val = id => { const el = rootQ(sheet.root, '#' + id); return el ? U.clean(el.value) : ''; };
      const mid = val('hfMatter');
      if (!mid || !val('hfDate')) { App.toast('Matter and date are required.', 'err'); return; }
      const rec = existing ? Object.assign({}, existing) : { id: U.uid('hrg'), createdAt: new Date().toISOString(), source: 'manual' };
      Object.assign(rec, {
        matterId: mid, date: val('hfDate'), time: val('hfTime'), court: val('hfCourt'),
        purpose: val('hfPurpose'), purposeHi: val('hfPurposeHi'), itemNo: val('hfItem'), note: val('hfNote')
      });
      await Repo.saveHearing(rec);
      App.closeTopSheet();
      App.renderAll();
      App.toast(existing ? 'Date updated, Sir.' : 'Date entered in the diary.', 'ok');
      const m = Repo.matter(mid);
      if (m) J.speakReply(J.reply([{ text: 'Noted, ' + (S.get('ownerName') || 'Sir') + '. ' + m.title + ' is listed on ' + I.spokenDate(rec.date) + (rec.time ? ' at ' + I.time(rec.time) : '') + '. I shall include it in your briefing.' }]), true);
    });
    function rootQ(root, sel) { return root.querySelector(sel); }
  };

  /* ---------------- task form ---------------- */
  Views.openTaskForm = function (matterId, prefill) {
    prefill = prefill || {};
    const existing = prefill.id ? Repo.data.tasks.find(t => t.id === prefill.id) : null;
    const matters = Repo.data.matters.slice().sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    const sel = existing ? existing.matterId : (matterId || prefill.matterId || (matters[0] && matters[0].id) || '');
    const sheet = App.openSheet({
      eyebrow: existing ? 'Edit task' : 'Chamber work',
      title: existing ? 'Edit task' : 'Add a task',
      sub: 'Procedural steps and desk work in one place.',
      body:
        '<form id="taskForm" class="form-grid" autocomplete="off">' +
        field('Task', '<input class="input" id="tfTitle" required value="' + esc(existing ? existing.title : prefill.title || '') + '" placeholder="e.g. File process fee for PW-3 summons">', 'full', true) +
        field('Matter', '<select class="input" id="tfMatter"><option value="">Chamber (general)</option>' + matters.map(m => '<option value="' + esc(m.id) + '" ' + (m.id === sel ? 'selected' : '') + '>' + esc(m.title) + '</option>').join('') + '</select>', 'full') +
        field('Kind', '<select class="input" id="tfKind"><option value="chamber" ' + (!prefill.kind || prefill.kind === 'chamber' ? 'selected' : '') + '>Chamber work</option><option value="process" ' + (prefill.kind === 'process' ? 'selected' : '') + '>Procedural step</option></select>') +
        field('Due date', '<input class="input" type="date" id="tfDue" value="' + esc(existing ? existing.due || '' : prefill.due || U.isoOf(U.addDays(U.todayISO(), 1))) + '">') +
        field('Priority', '<select class="input" id="tfPriority"><option value="high" ' + (prefill.priority === 'high' ? 'selected' : '') + '>High</option><option value="medium" ' + (!prefill.priority || prefill.priority === 'medium' ? 'selected' : '') + '>Medium</option><option value="low" ' + (prefill.priority === 'low' ? 'selected' : '') + '>Low</option></select>') +
        field('Hindi title', '<input class="input" id="tfTitleHi" value="' + esc(existing ? existing.titleHi || '' : prefill.titleHi || '') + '" placeholder="प्रक्रिया शुल्क जमा करें">') +
        '</form>',
      foot: '<button class="ghost-btn" data-action="close-sheet">Cancel</button>' +
        '<button class="primary-btn" form="taskForm" type="submit">' + (existing ? 'Save task' : 'Add task') + '</button>'
    });
    sheet.root.querySelector('#taskForm').addEventListener('submit', async e => {
      e.preventDefault();
      const v = id => U.clean((sheet.root.querySelector('#' + id) || {}).value || '');
      if (!v('tfTitle')) { App.toast('A task description is required.', 'err'); return; }
      const rec = existing ? Object.assign({}, existing) : { id: U.uid('tsk'), done: false, createdAt: new Date().toISOString(), sample: false };
      Object.assign(rec, {
        title: v('tfTitle'), titleHi: v('tfTitleHi'), matterId: v('tfMatter') || null,
        kind: v('tfKind'), due: v('tfDue'), priority: v('tfPriority')
      });
      await Repo.saveTask(rec);
      if (rec.due && S.get('notifications') !== false) {
        const at = new Date(rec.due + 'T09:00:00').getTime();
        if (at > Date.now()) {
          Bridge.scheduleAlarm({ id: 'task_' + rec.id, date: rec.due, time: '09:00', title: 'Task: ' + rec.title, kind: 'task' }).catch(() => {});
        }
      }
      App.closeTopSheet();
      App.renderAll();
      App.toast(existing ? 'Task updated.' : 'Task added to the chamber desk.', 'ok');
    });
  };

  /* ---------------- reminder form ---------------- */
  Views.openReminderForm = function (prefill) {
    prefill = prefill || {};
    const existing = prefill.id ? Repo.data.reminders.find(r => r.id === prefill.id) : null;
    const matters = Repo.data.matters.slice().sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    const sheet = App.openSheet({
      eyebrow: existing ? 'Edit reminder' : 'Reminders',
      title: existing ? 'Edit reminder' : 'Set a reminder',
      sub: 'I shall notify you at the chosen moment, and again in the morning briefing.',
      body:
        '<form id="remForm" class="form-grid" autocomplete="off">' +
        field('Reminder', '<input class="input" id="rfTitle" required value="' + esc(existing ? existing.title : prefill.title || '') + '" placeholder="e.g. Limitation date for appeal">', 'full', true) +
        field('Date', '<input class="input" type="date" id="rfDate" required value="' + esc(existing ? existing.date : prefill.date || U.isoOf(U.addDays(U.todayISO(), 1))) + '">', '', true) +
        field('Time', '<input class="input" type="time" id="rfTime" value="' + esc(existing ? existing.time || '09:00' : prefill.time || '09:00') + '">') +
        field('Matter (optional)', '<select class="input" id="rfMatter"><option value="">No specific matter</option>' + matters.map(m => '<option value="' + esc(m.id) + '" ' + ((existing ? existing.matterId : prefill.matterId) === m.id ? 'selected' : '') + '>' + esc(m.title) + '</option>').join('') + '</select>', 'full') +
        field('Kind', '<select class="input" id="rfKind">' + ['reminder', 'filing', 'limitation', 'inspection', 'hearing prep', 'client meeting'].map(k => '<option value="' + k + '" ' + ((existing ? existing.kind : prefill.kind) === k ? 'selected' : '') + '>' + esc(k.charAt(0).toUpperCase() + k.slice(1)) + '</option>').join('') + '</select>') +
        field('Hindi title', '<input class="input" id="rfTitleHi" value="' + esc(existing ? existing.titleHi || '' : prefill.titleHi || '') + '" placeholder="अपील की परिसीमा तिथि">') +
        '</form>' +
        '<p class="form-note">Reminders are scheduled on this tablet. Please allow notifications when prompted, so that they reach you even when the chamber screen is dark.</p>',
      foot: '<button class="ghost-btn" data-action="close-sheet">Cancel</button>' +
        '<button class="primary-btn" form="remForm" type="submit">' + (existing ? 'Save reminder' : 'Set reminder') + '</button>'
    });
    sheet.root.querySelector('#remForm').addEventListener('submit', async e => {
      e.preventDefault();
      const v = id => U.clean((sheet.root.querySelector('#' + id) || {}).value || '');
      if (!v('rfTitle') || !v('rfDate')) { App.toast('A title and date are required.', 'err'); return; }
      const rec = existing ? Object.assign({}, existing) : { id: U.uid('rem'), dismissed: false, createdAt: new Date().toISOString() };
      Object.assign(rec, {
        title: v('rfTitle'), titleHi: v('rfTitleHi'), date: v('rfDate'), time: v('rfTime'),
        matterId: v('rfMatter') || null, kind: v('rfKind'), dismissed: false, notifiedAt: ''
      });
      await Repo.saveReminder(rec);
      if (S.get('notifications') !== false) {
        Bridge.requestNotifications().then(ok => { if (ok) Bridge.scheduleAlarm(rec); });
      }
      App.closeTopSheet();
      App.renderAll();
      App.toast('Reminder set for ' + I.shortDate(rec.date) + '.', 'ok');
      J.speakReply(J.reply([{ text: 'I shall remind you, ' + (S.get('ownerName') || 'Sir') + ': ' + rec.title + ', on ' + I.spokenDate(rec.date) + '.' }]), true);
    });
  };

  /* ============================================================
     DIARY
     ============================================================ */
  Views.renderDiary = function () {
    const el = App.els.diaryBody;
    if (!el) return;
    const tab = App.state.diaryTab;
    document.querySelectorAll('#diaryTabs button').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
    if (tab === 'upcoming') el.innerHTML = Views.diaryUpcoming();
    else if (tab === 'calendar') { el.innerHTML = Views.diaryCalendar(); bindCalendar(); }
    else el.innerHTML = Views.diaryReminders();
  };

  Views.diaryUpcoming = function () {
    const today = U.todayISO();
    const start = U.addDays(today, -7);
    const end = U.isoOf(U.addDays(today, 60));
    const list = Repo.data.hearings.filter(h => h.date >= U.isoOf(start) && h.date <= end)
      .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    const byDate = {};
    list.forEach(h => { (byDate[h.date] = byDate[h.date] || []).push(h); });
    const dates = Object.keys(byDate).sort();
    if (!dates.length) {
      return '<div class="empty"><h3>' + (I.fullHindi() ? 'कोई तिथि दर्ज नहीं' : 'The diary is empty') + '</h3><p>Add the next listing for any matter — or import your e-Courts data.</p>' +
        '<button class="primary-btn" data-action="new-hearing">+ Add a date</button></div>';
    }
    const upcoming = dates.filter(d => d >= today);
    const past = dates.filter(d => d < today).reverse();
    let html = '';
    if (upcoming.length) {
      html += upcoming.map(d => {
        const rel = I.rel(d);
        return '<div class="day-group"><div class="day-head"><h3>' + esc(I.date(d, { weekday: true })) + '</h3>' +
          (rel ? '<span class="day-rel">' + esc(rel.toUpperCase()) + '</span>' : '') +
          '<span class="day-count">' + byDate[d].length + ' listing' + (byDate[d].length === 1 ? '' : 's') + '</span></div>' +
          byDate[d].map(h => {
            const m = Repo.matter(h.matterId);
            if (!m) return '';
            const docs = Repo.docsFor(m.id);
            return '<div class="hearing-row" data-action="open-matter" data-id="' + esc(m.id) + '">' +
              '<div class="hearing-court"><strong>' + esc(h.time ? I.time(h.time) : 'Time not set') + '</strong>' + esc(h.court || m.court || 'Court not recorded') + '</div>' +
              '<div class="hearing-main"><strong>' + esc(m.title) + '</strong><p>' + esc(h.purpose || m.stage || '') + (h.itemNo ? ' · Item ' + esc(h.itemNo) : '') + '</p></div>' +
              '<div class="matter-meta">' + (docs.length ? '<span class="badge cyan">' + docs.length + ' papers</span>' : '') + (m.client ? '<span class="badge">' + esc(m.client) + '</span>' : '') + '</div>' +
              '</div>';
          }).join('') + '</div>';
      }).join('');
    } else {
      html += '<div class="empty" style="margin-bottom:20px"><h3>No forthcoming dates</h3><p>Add a listing to begin.</p><button class="primary-btn" data-action="new-hearing">+ Add a date</button></div>';
    }
    if (past.length) {
      html += '<details class="past-dates"><summary>Past dates (' + past.reduce((n, d) => n + byDate[d].length, 0) + ')</summary>';
      html += past.slice(0, 12).map(d => byDate[d].map(h => {
        const m = Repo.matter(h.matterId);
        return m ? '<div class="hearing-row" style="opacity:.6" data-action="open-matter" data-id="' + esc(m.id) + '"><div class="hearing-court">' + esc(I.shortDate(d)) + '</div><div class="hearing-main"><strong>' + esc(m.title) + '</strong><p>' + esc(h.purpose || '') + '</p></div></div>' : '';
      }).join('')).join('');
      html += '</details>';
    }
    return html;
  };

  Views.diaryCalendar = function () {
    const now = new Date();
    let cal = App.state.calMonth;
    if (!cal) cal = { y: now.getFullYear(), m: now.getMonth() };
    const first = new Date(cal.y, cal.m, 1);
    const startDow = first.getDay();
    const start = new Date(cal.y, cal.m, 1 - startDow);
    const today = U.todayISO();
    const sel = App.state.calSelected;
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = U.isoOf(d);
      const hears = Repo.data.hearings.filter(h => h.date === iso);
      const rems = Repo.data.reminders.filter(r => r.date === iso && !r.dismissed);
      cells.push({ d, iso, hears, rems, dim: d.getMonth() !== cal.m });
    }
    const selected = cells.find(c => c.iso === sel) || cells.find(c => c.iso === today);
    let panel = '';
    if (selected) {
      const items = selected.hears.map(h => {
        const m = Repo.matter(h.matterId);
        return m ? '<div class="hearing-row" data-action="open-matter" data-id="' + esc(m.id) + '"><div class="hearing-court"><strong>' + esc(h.time ? I.time(h.time) : '—') + '</strong>' + esc(h.court || m.court) + '</div><div class="hearing-main"><strong>' + esc(m.title) + '</strong><p>' + esc(h.purpose || '') + '</p></div></div>' : '';
      }).join('');
      const remItems = selected.rems.map(r => '<div class="reminder-row"><div class="reminder-when">' + esc(I.shortDate(r.date)) + '</div><div class="reminder-main"><strong>' + esc(r.title) + '</strong><span>' + esc(r.kind || 'reminder') + '</span></div></div>').join('');
      panel = '<div class="cal-day-panel"><h4>' + esc(I.date(selected.iso, { weekday: true })) + '</h4>' +
        (items || remItems ? items + remItems : '<p class="tiny muted">Nothing listed. A quiet day.</p>') +
        '<div class="pill-row" style="margin-top:10px"><button class="ghost-btn small" data-action="new-hearing">+ Date</button><button class="ghost-btn small" data-action="new-reminder">+ Reminder</button></div></div>';
    }
    return '<div class="card calendar-card"><div class="cal-head"><h3>' + esc(I.monthYear(cal.y, cal.m, I.fullHindi())) + '</h3>' +
      '<div class="pill-row"><button class="ghost-btn small" data-action="cal-prev">‹</button><button class="ghost-btn small" data-action="cal-today">' + (I.fullHindi() ? 'आज' : 'Today') + '</button><button class="ghost-btn small" data-action="cal-next">›</button></div></div>' +
      '<div class="cal-grid">' + (I.fullHindi() ? I.HI_DOW : I.EN_DOW).map(d => '<div class="cal-dow">' + esc(String(d).slice(0, 3)) + '</div>').join('') +
      cells.map(c => {
        const ev = c.hears.length ? c.hears[0] : null;
        const m = ev ? Repo.matter(ev.matterId) : null;
        return '<div class="cal-cell' + (c.dim ? ' dim' : '') + (c.iso === today ? ' today' : '') + (c.iso === sel ? ' sel' : '') + (c.hears.length || c.rems.length ? ' has-ev' : '') + '" data-action="cal-select" data-date="' + c.iso + '">' +
          '<div class="cal-day">' + c.d.getDate() + '</div>' +
          '<div class="cal-ev">' + c.hears.slice(0, 2).map(h => { const mm = Repo.matter(h.matterId); return '<span title="' + esc(mm ? mm.title : '') + '">' + (h.time ? esc(h.time) + ' ' : '') + esc(mm ? shortCase(mm.title) : 'Listing') + '</span>'; }).join('') +
          c.rems.slice(0, 1).map(r => '<span class="rem" title="' + esc(r.title) + '">' + esc(r.title) + '</span>').join('') + '</div></div>';
      }).join('') + '</div>' + panel + '</div>' +
      '<p class="tiny muted" style="margin:12px 2px">' + (I.fullHindi() ? 'नीला — सुनवाई; स्वर्ण — स्मरण।' : 'Cyan — hearings; gold — reminders.') + '</p>';
  };

  Views.diaryReminders = function () {
    const today = U.todayISO();
    const list = Repo.data.reminders.filter(r => !r.dismissed).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    if (!list.length) return '<div class="empty"><h3>No reminders</h3><p>Ask me to remind you of a limitation date, a filing, or a client meeting.</p><button class="primary-btn" data-action="new-reminder">+ Add reminder</button></div>';
    return '<div class="card">' + list.map(r => {
      const m = r.matterId ? Repo.matter(r.matterId) : null;
      const overdue = r.date < today;
      return '<div class="reminder-row"><div class="reminder-when">' + esc(I.shortDate(r.date)) + (r.time ? '<br>' + esc(I.time(r.time)) : '') + '</div>' +
        '<div class="reminder-main"><strong>' + esc(r.title) + (r.titleHi ? ' <span class="badge hi">' + esc(r.titleHi) + '</span>' : '') + '</strong>' +
        '<span>' + esc(r.kind || 'reminder') + (m ? ' · ' + esc(m.title) : '') + (overdue ? ' · <span style="color:var(--danger)">past</span>' : '') + '</span></div>' +
        '<div class="row-actions"><button class="icon-tiny" data-action="edit-reminder" data-id="' + esc(r.id) + '" title="Edit">✎</button>' +
        '<button class="icon-tiny" data-action="dismiss-reminder" data-id="' + esc(r.id) + '" title="Dismiss">✓</button>' +
        '<button class="icon-tiny del" data-action="delete-reminder" data-id="' + esc(r.id) + '" title="Delete">🗑</button></div></div>';
    }).join('') + '</div>';
  };

  function bindCalendar() {
    document.querySelectorAll('.cal-cell').forEach(c => { c.style.cursor = 'pointer'; });
  }

  Views.calNav = function (delta) {
    let cal = App.state.calMonth;
    if (!cal) { const n = new Date(); cal = { y: n.getFullYear(), m: n.getMonth() }; }
    const d = new Date(cal.y, cal.m + delta, 1);
    App.state.calMonth = { y: d.getFullYear(), m: d.getMonth() };
    Views.renderDiary();
  };
  Views.calToday = function () {
    const n = new Date();
    App.state.calMonth = { y: n.getFullYear(), m: n.getMonth() };
    App.state.calSelected = U.todayISO();
    Views.renderDiary();
  };
  Views.calSelect = function (date) {
    App.state.calSelected = date;
    Views.renderDiary();
  };

  function shortCase(title) {
    const t = String(title || '').replace(/\s+v\.?\s+.*$/i, '').replace(/\s+बनाम\s+.*$/, '');
    return t.length > 18 ? t.slice(0, 17) + '…' : t;
  }

  function field(label, input, cls, req) {
    return '<div class="field ' + (cls || '') + '"><label>' + esc(label) + (req ? ' <span class="req">*</span>' : '') + '</label>' + input + '</div>';
  }

  Views.field = field;
  Views.shortCase = shortCase;
  LJ.Views = Views;

  /* extra sheet for "brief me on this matter" */
  const origRun = App.run;
  App.run = function (action, p, el) {
    if (action === 'deliverable') {
      const m = Repo.matter(p.id);
      if (!m) return;
      App.talk(J.caseProfile(m));
      return;
    }
    return origRun.call(App, action, p, el);
  };
})();
