/* ============================================================
   Legal Jarvis — dialogue, reasoning and voice
   English is the working language of the chamber.
   Hindi is used to describe Hindi names, files and contents.
   ============================================================ */
(function () {
  'use strict';
  const U = LJ.Utils;
  const I = LJ.I18N;
  const Repo = LJ.Repo;
  const Docs = LJ.Docs;
  const S = LJ.Settings;
  const Bridge = LJ.Bridge;

  const TYPE_WORDS = /\b(file|files|document|documents|doc|pdf|docx|draft|drafts|reply|rejoinder|petition|plaint|application|notice|order|judgment|affidavit|evidence|vakalatnama|exhibit|paper|papers|फाइल|दस्तावेज|दस्तावेज़|जवाब|याचिका|आवेदन|नोटिस|आदेश|प्रारूप|वकालतनामा)\b/i;

  function addr() { return S.get('ownerName') || 'Sir'; }
  function addressHi() { return 'सर'; }
  function owner() { return S.get('ownerName') || 'Sir'; }

  function stripMd(t) {
    return String(t || '').replace(/\*\*/g, '').replace(/`/g, '').replace(/[ \t]+/g, ' ').trim();
  }

  function speakable(t) {
    return stripMd(t)
      .replace(/\bv\.\s*/g, 'versus ')
      .replace(/\bvs\.?\s*/g, 'versus ')
      .replace(/₹\s*([\d,]+)/g, '$1 rupees')
      .replace(/\bNo\.\s*/g, 'number ')
      .replace(/\.pdf\b/gi, ' PDF user file')
      .replace(/\.docx?\b/gi, ' Word document')
      .replace(/\.txt\b/gi, ' text file')
      .replace(/\b(BNSS|BNS|BSA|IPC|CrPC|CPC|CNR|JDA|NCLT|DRT|CAT|SDM|PW|FIR|IA|WS)\b/g, m => m.split('').join(' '))
      .replace(/\s*—\s*/g, ', ')
      .replace(/\s*\/\s*/g, ' or ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const Jarvis = {
    lastReply: null,
    speaking: false,
    _speakToken: 0,
    onState: null,

    reply(blocks, actions = [], extra = {}) {
      if (typeof blocks === 'string') blocks = [{ text: blocks, lang: I.fullHindi() ? 'hi' : 'en' }];
      blocks = (blocks || []).filter(b => b && String(b.text || '').trim()).map(b => ({
        text: String(b.text), lang: b.lang || 'en'
      }));
      return Object.assign({ blocks, actions, kind: 'answer', at: Date.now() }, extra);
    },

    say(text, actions) { return Jarvis.reply([{ text, lang: I.fullHindi() ? 'hi' : 'en' }], actions); },

    hiName(rec) {
      if (!rec) return '';
      return rec.nameHi || (I.isHindiText(rec.name) ? rec.name : '') || rec.titleHi || (I.isHindiText(rec.title) ? rec.title : '') || '';
    },
    enName(rec) {
      if (!rec) return '';
      return rec.name || rec.title || '';
    },
    displayName(rec) {
      if (!rec) return '';
      const en = Jarvis.enName(rec), hi = Jarvis.hiName(rec);
      if (I.fullHindi() && hi) return hi;
      return en;
    },

    /* ---------------- speech ---------------- */
    async speakReply(reply, force) {
      if (!reply || !reply.blocks || !reply.blocks.length) return;
      if (!force && (!S.get('autoSpeak') || window.App && App.muted)) return;
      const token = ++Jarvis._speakToken;
      Jarvis.speaking = true;
      Jarvis.onState && Jarvis.onState('speaking');
      try {
        for (const b of reply.blocks) {
          if (token !== Jarvis._speakToken) break;
          const lang = b.lang === 'hi' ? 'hi-IN' : 'en-GB';
          const text = speakable(b.text);
          if (!text) continue;
          await Bridge.speak(text, { lang, voice: b.lang === 'hi' ? '' : S.get('voiceName') });
        }
      } finally {
        if (token === Jarvis._speakToken) {
          Jarvis.speaking = false;
          Jarvis.onState && Jarvis.onState('idle');
        }
      }
    },

    stopSpeaking() {
      Jarvis._speakToken++;
      Jarvis.speaking = false;
      Bridge.stopSpeaking();
      Jarvis.onState && Jarvis.onState('idle');
    },

    /* ---------------- stats ---------------- */
    stats() {
      const today = U.todayISO();
      const hears = Repo.data.hearings;
      const todayList = Utils(hears.filter(h => h.date === today));
      const tomorrowList = Utils(hears.filter(h => h.date === U.isoOf(U.addDays(today, 1))));
      const active = Repo.data.matters.filter(m => m.status !== 'disposed');
      const open = Repo.openTasks();
      const drafts = Repo.data.documents.filter(d => d.status === 'in-progress');
      const overdue = Repo.overdueTasks();
      const dueSoon = Repo.upcomingReminders(7);
      return { today, todayList, tomorrowList, active, open, drafts, overdue, dueSoon };
    },

    /* ---------------- greeting ---------------- */
    greeting() {
      const st = Jarvis.stats();
      const tmr = st.tomorrowList.length, tod = st.todayList.length;
      const pend = st.open.length;
      const draft = st.drafts.length;
      if (I.fullHindi()) {
        const lines = [
          I.greeting() + ' मैं आपकी सेवा में उपस्थित हूँ।',
          tod ? 'आज ' + tod + ' मामले सूचीबद्ध हैं।' : 'आज का दिन आपके लिए तुलनात्मक रूप से शांत है — कोई सुनवाई सूचीबद्ध नहीं है।',
          'कल ' + tmr + ' मामले हैं, और ' + pend + ' चैंबर कार्य लंबित हैं' + (draft ? ', जिनमें ' + draft + ' प्रारूप अंतिम समीक्षा की प्रतीक्षा में हैं' : '') + '।',
          'मैं आपके आदेश की प्रतीक्षा में हूँ, ' + addressHi() + '।'
        ];
        return Jarvis.reply([{ text: lines.join(' '), lang: 'hi' }], [
          { label: 'आज का ब्रीफिंग', act: 'brief' }, { label: 'कल की पेशी', act: 'tomorrow' }, { label: 'लंबित कार्य', act: 'tasks' }
        ]);
      }
      const bits = [
        I.greeting(),
        tod
          ? 'You have ' + n(tod, 'matter') + ' before the court today.'
          : 'Your diary is clear of hearings today — a rare luxury, Sir.',
        tmr
          ? 'Tomorrow brings ' + n(tmr, 'matter') + '.'
          : 'Tomorrow is presently unlisted.',
        pend
          ? 'There ' + (pend === 1 ? 'is one chamber task' : 'are ' + pend + ' chamber tasks') + ' still open' + (draft ? ', and ' + n(draft, 'draft', 'drafts') + ' awaiting your final review' : '') + '.'
          : 'The chamber desk is clear, Sir.'
      ];
      return Jarvis.reply([{ text: bits.join(' '), lang: 'en' }], [
        { label: 'Full briefing', act: 'brief' }, { label: "Tomorrow's cause list", act: 'tomorrow' }, { label: 'Pending work', act: 'tasks' }
      ]);
    },

    /* ---------------- briefings ---------------- */
    buildBrief(kind) {
      // kind: 'morning' | 'evening'
      const st = Jarvis.stats();
      const isEvening = kind === 'evening';
      const dateISO = isEvening ? U.isoOf(U.addDays(st.today, 1)) : st.today;
      const list = isEvening ? st.tomorrowList : st.todayList;
      const actions = [
        { label: isEvening ? "Tomorrow's cause list" : "Today's cause list", act: 'diary' },
        { label: 'Open pending work', act: 'tasks' },
        { label: 'Speak to Jarvis', act: 'listen' }
      ];
      if (I.fullHindi()) {
        const out = [];
        out.push(I.greeting() + ' आज ' + I.date(st.today, { hi: true }) + ' है।');
        if (!list.length) {
          out.push(isEvening ? 'कल कोई सुनवाई सूचीबद्ध नहीं है।' : 'आज न्यायालय में कोई मामला सूचीबद्ध नहीं है।');
        } else {
          const courts = uniqueCourts(list);
          out.push((isEvening ? 'कल ' : 'आज ') + list.length + ' मामले ' + (courts.length > 1 ? courts.length + ' न्यायालयों में ' : '') + 'सूचीबद्ध हैं।');
          list.slice(0, 3).forEach(h => {
            const m = Repo.matter(h.matterId);
            if (!m) return;
            out.push(Jarvis.displayName(m) + ' — ' + (h.court || m.court || '') + ', ' + (h.time ? I.timeHi(h.time) + ' बजे' : 'समय अंकित नहीं') + '। वर्तमान स्थिति: ' + (m.stageHi || m.stage || '') + '।');
          });
          if (list.length > 3) out.push('शेष ' + (list.length - 3) + ' मामले सूची में दर्ज हैं।');
          const carry = carryLines(list);
          if (carry.length) out.push('साथ ले जाने योग्य दस्तावेज़: ' + carry.slice(0, 3).join('; ') + '।');
        }
        const prep = prepFor(list);
        if (prep.length) out.push('आज रात तैयारी आवश्यक: ' + prep.slice(0, 3).join('; ') + '।');
        if (st.dueSoon.length) {
          const r = st.dueSoon[0];
          out.push('अगली समय-सीमा: ' + (r.titleHi || r.title) + ' — ' + I.date(r.date, { hi: true }) + '।');
        }
        if (st.overdue.length) out.push('एक सूचना, ' + addressHi() + ' — ' + st.overdue.length + ' कार्य निर्धारित तिथि से शेष हैं।');
        out.push('मैं आपके निर्देशों की प्रतीक्षा में हूँ।');
        return Jarvis.reply([{ text: out.join(' '), lang: 'hi' }], actions, { kind: 'brief' });
      }

      const out = [];
      out.push(I.greeting() + ' It is ' + I.date(st.today, { hi: false }) + '.');
      if (!list.length) {
        out.push(isEvening ? 'Nothing is listed for tomorrow, Sir. The diary is clear.' : 'You have no matters listed today, Sir. The diary is clear.');
      } else {
        const courts = uniqueCourts(list);
        out.push((isEvening ? 'Tomorrow you have ' : 'You have ') + n(list.length, 'matter') + ' listed' + (courts.length > 1 ? ' across ' + n(courts.length, 'court') : '') + '.');
        list.slice(0, 3).forEach(h => {
          const m = Repo.matter(h.matterId);
          if (!m) return;
          out.push(Jarvis.displayName(m) + ' before the ' + (h.court || m.court || 'court') + ' at ' + (h.time ? I.time(h.time) : 'a time yet to be notified') + '. The matter stands at: ' + (m.stage || 'stage to be updated') + '.');
        });
        if (list.length > 3) out.push('The remaining ' + (list.length - 3) + ' matters are in the diary.');
        const carry = carryLines(list);
        if (carry.length) out.push('I would carry ' + carry.slice(0, 3).join('; ') + '.');
        const prep = prepFor(list);
        if (prep.length) out.push('For tonight, Sir, I would attend to ' + prep.slice(0, 3).join('; ') + '.');
      }
      if (st.dueSoon.length) {
        const r = st.dueSoon[0];
        out.push('The nearest deadline is ' + (r.title || 'a filing') + ' on ' + I.date(r.date, { hi: false, weekday: false }) + '.');
      } else if (!isEvening) {
        out.push('No filing deadline falls due in the coming week.');
      }
      if (st.drafts.length) out.push(n(st.drafts.length, 'draft') + ' remain unfinished in the archive.');
      if (st.overdue.length) out.push('A gentle flag, Sir: ' + n(st.overdue.length, 'chamber task') + ' have slipped past their due date.');
      out.push('I am at your disposal.');
      return Jarvis.reply([{ text: out.join(' '), lang: 'en' }], actions, { kind: 'brief' });
    },

    /* A short, useful line for the notification itself (not the spoken brief). */
    briefNote(kind) {
      const isEvening = kind === 'evening';
      const st = Jarvis.stats();
      const list = isEvening ? st.tomorrowList : st.todayList;
      const day = isEvening ? 'tomorrow' : 'today';
      const bits = [];
      if (!list.length) {
        bits.push('Nothing listed ' + day + ', Sir.');
      } else {
        const parts = list.slice(0, 3).map(h => {
          const m = Repo.matter(h.matterId);
          return (m ? Jarvis.displayName(m) : 'A matter') + ' at ' + (h.time ? I.time(h.time) : 'a time to be notified');
        });
        bits.push(n(list.length, 'listing') + ' ' + day + ': ' + parts.join('; ') + (list.length > 3 ? ' and ' + (list.length - 3) + ' more' : '') + '.');
      }
      if (st.overdue.length) bits.push(n(st.overdue.length, 'task') + ' overdue.');
      if (st.dueSoon.length) bits.push('Next deadline: ' + (st.dueSoon[0].title || 'a filing') + ' on ' + I.shortDate(st.dueSoon[0].date) + '.');
      return bits.join(' ').slice(0, 280);
    },

    brief(kind) { return Jarvis.buildBrief(kind || (new Date().getHours() >= 17 ? 'evening' : 'morning')); },

    /* ---------------- cause lists ---------------- */
    causeList(when) {
      // when: today | tomorrow | date iso
      const isT = when === 'today';
      const date = isT ? U.todayISO() : when === 'tomorrow' ? U.isoOf(U.addDays(U.todayISO(), 1)) : when;
      const list = Repo.hearingsOn(date);
      const actions = [{ label: 'Open diary', act: 'diary' }];
      if (!list.length) {
        if (I.fullHindi()) return Jarvis.reply([{ text: (isT ? 'आज ' : 'कल ') + I.date(date, { hi: true }) + ' को कोई सुनवाई सूचीबद्ध नहीं है, ' + addressHi() + '। क्या आप एक नई तिथि जोड़ना चाहेंगे?' , lang: 'hi' }], [{ label: 'तिथि जोड़ें', act: 'new-hearing' }, { label: 'डायरी', act: 'diary' }]);
        return Jarvis.reply([{ text: (isT ? 'Today, ' : 'Tomorrow, ') + I.date(date, { weekday: true }) + ' holds no listed matters, ' + addr() + '. Shall I add a date for you?' }], [{ label: 'Add a date', act: 'new-hearing' }, { label: 'Open diary', act: 'diary' }]);
      }
      if (I.fullHindi()) {
        const blocks = [{ text: 'कल ' + I.date(date, { hi: true }) + ' की सूची, ' + addressHi() + ' — कुल ' + list.length + ' मामले।', lang: 'hi' }];
        list.forEach((h, i) => {
          const m = Repo.matter(h.matterId);
          const t = I.timeHi(h.time);
          blocks.push({
            lang: 'hi',
            text: (i + 1) + '. ' + Jarvis.displayName(m || {}) + ' — ' + (h.court || 'न्यायालय अंकित नहीं') + (t ? ', ' + t : '') + '।\n' + (h.purposeHi || h.purpose || m && m.stageHi || '') + (h.itemNo ? '\nआइटम ' + h.itemNo : '')
          });
        });
        return Jarvis.reply(blocks, list.map((h, i) => ({ label: 'मामला ' + (i + 1), act: 'open-matter', id: h.matterId })).concat(actions));
      }
      const blocks = [{ text: (isT ? 'Today, ' : 'Tomorrow, ') + I.date(date, { weekday: true }) + ' — ' + n(list.length, 'listing') + ', ' + addr() + '.' }];
      list.forEach((h, i) => {
        const m = Repo.matter(h.matterId);
        const t = I.time(h.time);
        blocks.push({
          text: (i + 1) + '. **' + Jarvis.displayName(m || { title: 'Unlinked listing' }) + '**\n' +
            (h.court || (m && m.court) || 'Court not recorded') + (t ? ' · ' + t : '') + (h.itemNo ? ' · item ' + h.itemNo : '') +
            '\n' + (h.purpose || (m && m.stage) || 'Purpose to be updated')
        });
      });
      const links = list.slice(0, 4).map((h, i) => ({ label: 'Matter ' + (i + 1), act: 'open-matter', id: h.matterId }));
      return Jarvis.reply(blocks, links.concat(actions));
    },

    carryFor(when) {
      const date = when && when !== 'tomorrow' && when !== 'today' ? when : (when === 'today' ? U.todayISO() : U.isoOf(U.addDays(U.todayISO(), 1)));
      const list = Repo.hearingsOn(date);
      if (!list.length) {
        if (I.fullHindi()) return Jarvis.reply([{ text: 'कल कोई सुनवाई नहीं है, अतः कुछ विशेष ले जाने की आवश्यकता नहीं। फिर भी मैं आपका भार नहीं बढ़ाऊँगा, ' + addressHi() + '।', lang: 'hi' }], [{ label: 'डायरी', act: 'diary' }]);
        return Jarvis.reply([{ text: 'There is no listing, Sir, so your arms may remain light. Should you wish, I can pull the drafts that are ready for filing.' }], [{ label: 'Ready drafts', act: 'drafts' }]);
      }
      const carry = [];
      const blocks = [];
      if (I.fullHindi()) {
        blocks.push({ text: I.date(date, { hi: true }) + ' के लिए मेरी अनुशंसा, ' + addressHi() + ':', lang: 'hi' });
        list.forEach(h => {
          const m = Repo.matter(h.matterId);
          if (!m) return;
          const docs = Repo.docsFor(m.id).filter(d => ['Petition', 'Plaint', 'Reply', 'Rejoinder', 'Evidence', 'Order', 'Application', 'Written Statement'].includes(d.type)).slice(0, 2);
          blocks.push({
            lang: 'hi',
            text: '**' + Jarvis.displayName(m) + '** — ' + (docs.length ? docs.map(d => d.nameHi || d.name).join(', ') : 'कोई दस्तावेज़ जुड़ा नहीं; कृपया जाँचें') + '।'
          });
        });
        return Jarvis.reply(blocks, [{ label: 'दस्तावेज़', act: 'documents' }, { label: 'डायरी', act: 'diary' }]);
      }
      blocks.push({ text: 'For ' + I.date(date, { weekday: true }) + ', I recommend the following, ' + addr() + ':' });
      list.forEach(h => {
        const m = Repo.matter(h.matterId);
        if (!m) return;
        const docs = Repo.docsFor(m.id).filter(d => ['Petition', 'Plaint', 'Reply', 'Rejoinder', 'Evidence', 'Order', 'Application', 'Written Statement'].includes(d.type)).slice(0, 2);
        blocks.push({
          text: '**' + Jarvis.displayName(m) + '**\n' + (docs.length ? docs.map(d => d.name).join(' · ') : 'No document is linked yet — perhaps add the case file before the hearing.')
        });
      });
      return Jarvis.reply(blocks, [{ label: 'Open documents', act: 'documents' }, { label: 'Open diary', act: 'diary' }]);
    },

    /* ---------------- case profile ---------------- */
    caseProfile(m) {
      if (!m) return Jarvis.say('I could not identify that matter, Sir.');
      const next = nextHearingOf(m);
      const tasks = Repo.tasksFor(m.id).filter(t => !t.done);
      const procs = tasks.filter(t => t.kind === 'process');
      const chamber = tasks.filter(t => t.kind !== 'process');
      const docs = Repo.docsFor(m.id);
      const drafts = docs.filter(d => d.status === 'in-progress');
      const actions = [
        { label: 'Open full profile', act: 'open-matter', id: m.id },
        { label: 'Add date', act: 'new-hearing', id: m.id },
        { label: 'Add task', act: 'new-task', id: m.id }
      ];
      if (I.fullHindi()) {
        const blocks = [{
          lang: 'hi',
          text: '**' + (m.titleHi || m.title) + '**\n' + (m.clientHi || m.client) + ' · ' + (m.courtHi || m.court) + (m.caseNo ? ' · वाद संख्या ' + m.caseNo + '/' + (m.year || '') : '')
        }];
        blocks.push({ lang: 'hi', text: 'वर्तमान स्थिति: ' + (m.stageHi || m.stage || 'अद्यतन आवश्यक') + '।' });
        blocks.push({ lang: 'hi', text: next ? 'अगली तिथि: ' + I.date(next.date, { hi: true }) + ' ' + (next.time ? I.timeHi(next.time) + ' बजे' : '') + ', ' + (next.court || m.court || '') + '।' : 'अगली तिथि अंकित नहीं है।' });
        if (procs.length) blocks.push({ lang: 'hi', text: 'प्रक्रिया शेष: ' + procs.map(t => t.titleHi || t.title).join('; ') + '।' });
        if (chamber.length) blocks.push({ lang: 'hi', text: 'चैंबर कार्य: ' + chamber.map(t => t.titleHi || t.title).join('; ') + '।' });
        if (drafts.length) blocks.push({ lang: 'hi', text: 'प्रारूप समीक्षा हेतु: ' + drafts.map(d => d.nameHi || d.name).join(', ') + '।' });
        return Jarvis.reply(blocks, actions);
      }
      const blocks = [{
        text: '**' + m.title + '**\n' + (m.client || '') + ' · ' + (m.court || '') + (m.caseNo ? ' · ' + (m.caseNature || 'Case') + ' No. ' + m.caseNo + '/' + (m.year || '') : '') + (m.cnr ? '\nCNR ' + m.cnr : '')
      }];
      blocks.push({ text: '**Present stage.** ' + (m.stage || 'Not yet recorded.') });
      blocks.push({ text: next ? '**Next listing.** ' + I.date(next.date, { weekday: true }) + (next.time ? ' at ' + I.time(next.time) : '') + ' before the ' + (next.court || m.court || 'court') + '.' : '**Next listing.** No future date is recorded for this matter.' });
      if (procs.length) blocks.push({ text: '**Procedure pending.** ' + procs.map(t => t.title + (t.due ? ' (by ' + I.date(t.due, { weekday: false }) + ')' : '')).join('; ') + '.' });
      if (chamber.length) blocks.push({ text: '**On your desk.** ' + chamber.map(t => t.title).join('; ') + '.' });
      blocks.push({ text: docs.length
        ? '**Linked papers.** ' + n(docs.length, 'document') + (drafts.length ? ', of which ' + n(drafts.length, 'draft') + ' still await your review: ' + drafts.map(d => d.name).join(', ') : '') + '.'
        : '**Linked papers.** None as yet. I can file documents into this matter in moments.' });
      return Jarvis.reply(blocks, actions);
    },

    nextDateFor(m) {
      if (!m) return Jarvis.say('I could not find that matter in the register, Sir.');
      const n = nextHearingOf(m);
      if (!n) {
        if (I.fullHindi()) return Jarvis.reply([{ text: Jarvis.displayName(m) + ' के लिए कोई आगामी तिथि अंकित नहीं है, ' + addressHi() + '। क्या मैं एक तिथि जोड़ दूँ?', lang: 'hi' }], [{ label: 'तिथि जोड़ें', act: 'new-hearing', id: m.id }, { label: 'मामला खोलें', act: 'open-matter', id: m.id }]);
        return Jarvis.reply([{ text: 'No future date is recorded for ' + m.title + ', Sir. Shall I add one?' }], [{ label: 'Add date', act: 'new-hearing', id: m.id }, { label: 'Open matter', act: 'open-matter', id: m.id }]);
      }
      if (I.fullHindi()) {
        return Jarvis.reply([{ text: I.date(n.date, { hi: true }) + ' को ' + (n.time ? I.timeHi(n.time) + ' बजे ' : '') + (n.court || m.court || '') + ' के समक्ष ' + (m.titleHi || m.title) + ' की अगली पेशी है। वर्तमान स्थिति: ' + (m.stageHi || m.stage || '') + '।', lang: 'hi' }],
          [{ label: 'मामला खोलें', act: 'open-matter', id: m.id }, { label: 'डायरी', act: 'diary' }]);
      }
      return Jarvis.reply([{
        text: 'The next listing is ' + I.date(n.date, { weekday: true }) + (n.time ? ' at ' + I.time(n.time) : '') + ', before the ' + (n.court || m.court || 'court') + '. The matter presently stands at: ' + (m.stage || 'stage not recorded') + '.'
      }], [{ label: 'Open matter', act: 'open-matter', id: m.id }, { label: 'Open diary', act: 'diary' }]);
    },

    /* ---------------- documents ---------------- */
    describeDoc(d) {
      const bits = [];
      bits.push('**' + d.name + '**');
      bits.push([d.type || 'Document', d.court || 'court not recorded', d.lastModified ? 'dated ' + I.date(d.lastModified, { weekday: false }) : ''].filter(Boolean).join(' · '));
      bits.push(d.status === 'in-progress' ? 'Status: draft, still in progress.' : d.status === 'filed' ? 'Status: filed.' : 'Status: ready for printing and filing.');
      return bits.join('\n');
    },

    docSearchReply(query, opts = {}) {
      let matches = Docs.search(query);
      let relaxed = false;
      if (!matches.length) {
        const stripped = String(query).replace(/\b(from\s+)?(yesterday|today|last week|this week|कल|आज|पिछले सप्ताह|इस सप्ताह)\b/gi, ' ');
        if (stripped.trim() !== String(query).trim()) {
          matches = Docs.search(stripped);
          relaxed = matches.length > 0;
        }
      }
      if (!matches.length) {
        if (I.fullHindi()) {
          return Jarvis.reply([{ text: 'क्षमा करें, ' + addressHi() + ' — इस विवरण से कोई दस्तावेज़ नहीं मिला। आप कृपया नाम, मामला अथवा दस्तावेज़ का प्रकार बताएँ, अथवा मैं संग्रह खोल दूँ?', lang: 'hi' }],
            [{ label: 'संग्रह खोलें', act: 'documents' }, { label: 'फाइलें जोड़ें', act: 'import-files' }]);
        }
        return Jarvis.reply([{ text: 'I have searched the archive and found nothing matching that description, ' + addr() + '. If you give me a client name, a case, or a document type, I shall look again. The archive itself is open to you.' }],
          [{ label: 'Open archive', act: 'documents' }, { label: 'Import files', act: 'import-files' }]);
      }
      const d = matches[0];
      const m = d.matterId ? Repo.matter(d.matterId) : null;
      const hindiDoc = I.mode() === 'auto' && I.isHindiText(d.name + ' ' + (d.text || '').slice(0, 1500));
      const isList = matches.length > 1 && !opts.single;
      const blocks = [];
      const actions = [{ label: 'Open document', act: 'open-doc', id: d.id }];
      if (matches.length > 1) actions.push({ label: 'See all matches', act: 'search-docs', query });
      if (m) actions.push({ label: 'Open matter', act: 'open-matter', id: m.id });

      if (I.fullHindi()) {
        blocks.push({ lang: 'hi', text: 'मुझे वह मिल गया, ' + addressHi() + '।' });
        blocks.push({ lang: 'hi', text: Jarvis.describeDoc(Object.assign({}, d, { type: d.typeHi || d.type, court: d.courtHi || d.court })) });
        if (m) blocks.push({ lang: 'hi', text: 'यह ' + (m.titleHi || m.title) + ' मामले से जुड़ा है।' });
        if (relaxed) blocks.push({ lang: 'hi', text: 'उस विशेष दिन का कोई दस्तावेज़ नहीं मिला, अतः मैंने निकटतम दस्तावेज़ प्रस्तुत किया है।' });
        if (isList) blocks.push({ lang: 'hi', text: 'कुल ' + matches.length + ' दस्तावेज़ मिले; शेष भी सूची में हैं।' });
        return Jarvis.reply(blocks, actions, { focusDocId: d.id });
      }
      blocks.push({ text: 'I have it, ' + addr() + '.' });
      blocks.push({ text: Jarvis.describeDoc(d) });
      if (m) blocks.push({ text: 'It is linked to **' + m.title + '**' + (m.stage ? ', where the matter stands at: ' + m.stage : '') + '.' });
      if (relaxed) blocks.push({ text: 'Nothing was dated for that exact day; I have brought you the closest paper instead.' });
      if (isList) blocks.push({ text: 'There ' + (matches.length === 2 ? 'is one other closely related paper' : 'are ' + (matches.length - 1) + ' other related papers') + ' in the archive. Shall I open the full list?' });
      if (hindiDoc) {
        blocks.push({ lang: 'hi', text: hindiDocLine(d, m) });
      }
      const wantsOpen = opts.open || /\b(open|pull up|bring up|show me|display|let me see|kholo|khol|dikhao|dikha|दिखाओ|खोलो|खोल)\b/i.test(String(query));
      return Jarvis.reply(blocks, actions, { focusDocId: d.id, openDoc: wantsOpen ? d.id : null });
    },

    docListReply(query) {
      const matches = Docs.search(query).slice(0, 6);
      if (!matches.length) return Jarvis.docSearchReply(query);
      const blocks = [{ text: 'I found ' + n(matches.length, 'document') + ' worth your attention, ' + addr() + ':' }];
      matches.forEach((d, i) => {
        blocks.push({ text: (i + 1) + '. **' + d.name + '**\n' + [d.type, d.court, I.date(d.lastModified, { weekday: false })].filter(Boolean).join(' · ') + (d.status === 'in-progress' ? ' · draft' : '') });
      });
      const actions = matches.slice(0, 4).map((d, i) => ({ label: 'Open ' + (i + 1), act: 'open-doc', id: d.id }));
      return Jarvis.reply(blocks, actions);
    },

    /* ---------------- add / edit ---------------- */
    openAddCase(q) {
      const t = String(q || '');
      const prefill = {};
      const when = parseWhen(t);
      const courtHit = Docs.detectCourt(t, '');

      /* Strip the command scaffolding: "add a case titled …" */
      let body = t
        .replace(/^\s*(?:please\s+)?(?:add|create|register|open|make|start|बनाओ|जोड़ो|दर्ज)\s+/i, '')
        .replace(/^\s*(?:an?|the|new|नया|नई|एक)\s+/i, '')
        .replace(/^\s*(?:case|matter|केस|मामला)\s*/i, '')
        .replace(/^\s*(?:titled|titled\s+as|called|named|by\s+the\s+name\s+of|नाम\s+से)\s+/i, '')
        .replace(/^\s*[:\-–—]\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();

      /* The title ends where the court or the next date begins. */
      let title = body
        .replace(/\s+(?:in|before|at)\s+(?:the\s+)?(?:hon'?ble\s+)?(?:high\s+court|rajasthan\s+high\s+court|district|sessions|civil|family|revenue|sdm|cat|nclt|drt|consumer|labour|police|उच्च\s+न्यायालय|जिला|सत्र|सिविल|परिवार|राजस्व)[\s\S]*$/i, '')
        .replace(/\s+(?:with\s+)?(?:next|coming|having\s+next)\s+(?:date|hearing|listing|peshi|तारीख|पेशी)[\s\S]*$/i, '')
        .replace(/\s+on\s+\d{1,2}(?:st|nd|rd|th)?\s+\w+[\s\S]*$/i, '')
        .replace(/[.,;:\s]+$/, '');

      const vs = title.match(/^(.+?)\s+(?:v\.?s?\.?|versus|बनाम)\s+(.+)$/i);
      if (vs) {
        const a = U.titleCase(U.clean(vs[1])), b = U.titleCase(U.clean(vs[2]));
        title = a + ' v. ' + b;
        prefill.client = a;
        prefill.opposite = b;
      } else {
        title = U.titleCase(U.clean(title));
      }
      title = title.replace(/\s+V\.\s+/g, ' v. ');
      if (title && title.length > 2 && !/^(add|new|case|matter|नया|मामला)$/i.test(title)) prefill.title = title;

      if (courtHit) {
        prefill.court = courtHit.court;
        prefill.courtType = courtHit.courtType;
        prefill.courtHi = courtHit.courtHi;
      }
      if (when) {
        prefill.nextHearing = when.iso;
        if (when.time) prefill.time = when.time;
      }
      if (/criminal|आपराधिक/i.test(t)) prefill.tags = ['Criminal'];
      else if (/revenue|राजस्व/i.test(t)) prefill.tags = ['Revenue'];
      else if (/civil|सिविल/i.test(t)) prefill.tags = ['Civil'];

      const spoke = prefill.title
        ? ' I have entered “' + prefill.title + '”' + (prefill.court ? ', before the ' + prefill.court : '') + (prefill.nextHearing ? ', listed ' + I.date(prefill.nextHearing, { weekday: false }) : '') + '. Please confirm or complete the particulars.'
        : ' Give me whatever you know — the rest I shall arrange in order.';
      if (I.fullHindi()) return Jarvis.reply([{ lang: 'hi', text: 'बिल्कुल, ' + addressHi() + '। नए मामले का विवरण भरने के लिए मैंने प्रपत्र खोल दिया है।' + (prefill.title ? ' शीर्षक “' + prefill.title + '” भर दिया है।' : '') + ' आप जो जानकारी जानते हैं, वही पर्याप्त है।' }], [{ label: 'मामला जोड़ें', act: 'open-add-case', prefill }], { openAddCase: prefill });
      return Jarvis.reply([{ text: 'Very good, ' + addr() + '.' + spoke + ' Once entered, this matter will be tracked exactly as an e-Courts matter.' }],
        [{ label: 'Add matter', act: 'open-add-case', prefill }], { openAddCase: prefill });
    },

    openAddHearing(q) {
      const m = Docs.revMatter(q) || Repo.findMatter(q);
      const prefill = {};
      if (m) prefill.matterId = m.id;
      const when = parseWhen(q);
      if (when) { prefill.date = when.iso; if (when.time) prefill.time = when.time; }
      if (I.fullHindi()) return Jarvis.reply([{ text: 'तिथि जोड़ने का प्रपत्र तैयार है, ' + addressHi() + '।' + (m ? ' ' + (m.titleHi || m.title) + ' के लिए।' : '') + ' मामला और तिथि चुनकर पुष्टि कर दें।', lang: 'hi' }], [{ label: 'तिथि जोड़ें', act: 'new-hearing', id: m && m.id, prefill }], { openHearing: prefill });
      return Jarvis.reply([{ text: 'The date form is ready, ' + addr() + '.' + (m ? ' I have selected ' + m.title + '.' : '') + ' Confirm the matter and the date, and the diary will be updated at once.' }],
        [{ label: 'Add hearing date', act: 'new-hearing', id: m && m.id, prefill }], { openHearing: prefill });
    },

    openAddReminder(q, parsed) {
      const when = parsed && parsed.iso ? parsed : parseWhen(q);
      let title = String(q || '')
        .replace(/^.*?\b(remind me( to| about)?|reminder( to| for)?|add (a )?reminder( to| for)?|याद दिलाओ|रिमाइंडर)\b/i, '')
        .replace(/\b(today|tomorrow|day after tomorrow|next week|on|at|by|कल|आज|परसों)\b.*$/i, '')
        .replace(/\b(on|by|at)\s+\d{1,2}(st|nd|rd|th)?\s+\w+.*$/i, '')
        .replace(/[.?!]+$/, '').trim();
      if (!title || title.length < 3) title = 'Chamber reminder';
      title = U.titleCase(title);
      const prefill = { title, date: when ? when.iso : U.todayISO(), time: when && when.time ? when.time : '09:00', kind: 'reminder' };
      if (I.fullHindi()) return Jarvis.reply([{ text: 'अवश्य, ' + addressHi() + '। मैंने स्मरण-पत्र तैयार कर दिया है — कृपया तिथि और समय की पुष्टि कर दें।', lang: 'hi' }], [{ label: 'रिमाइंडर सहेजें', act: 'new-reminder', prefill }], { openReminder: prefill });
      return Jarvis.reply([{ text: 'With pleasure, ' + addr() + '. I have drafted the reminder — confirm the date and time, and I shall set it.' }],
        [{ label: 'Set reminder', act: 'new-reminder', prefill }], { openReminder: prefill });
    },

    /* ---------------- tasks & deadlines ---------------- */
    taskSummary() {
      const open = Utils(Repo.openTasks());
      const overdue = Repo.overdueTasks();
      const drafts = Repo.data.documents.filter(d => d.status === 'in-progress');
      if (!open.length) {
        if (I.fullHindi()) return Jarvis.reply([{ text: 'चैंबर डेस्क पूर्णतः स्वच्छ है, ' + addressHi() + '। कोई कार्य लंबित नहीं है। नया कार्य जोड़ना हो तो आज्ञा दें।', lang: 'hi' }], [{ label: 'कार्य जोड़ें', act: 'new-task' }]);
        return Jarvis.reply([{ text: 'Your desk is entirely clear, ' + addr() + '. Not a single chamber task remains open.' }], [{ label: 'Add a task', act: 'new-task' }]);
      }
      if (I.fullHindi()) {
        const blocks = [{ lang: 'hi', text: open.length + ' कार्य लंबित हैं' + (overdue.length ? ', जिनमें ' + overdue.length + ' निर्धारित तिथि से शेष' : '') + '।' }];
        open.slice(0, 6).forEach(t => {
          const m = Repo.matter(t.matterId);
          blocks.push({ lang: 'hi', text: '• ' + (t.titleHi || t.title) + (m ? ' — ' + (m.titleHi || m.title) : '') + (t.due ? ' (' + I.date(t.due, { hi: true, weekday: false }) + ')' : '') });
        });
        if (drafts.length) blocks.push({ lang: 'hi', text: 'प्रारूप समीक्षा हेतु: ' + drafts.map(d => d.nameHi || d.name).join(', ') + '।' });
        return Jarvis.reply(blocks, [{ label: 'मामले', act: 'matters' }, { label: 'रिमाइंडर', act: 'new-reminder' }]);
      }
      const blocks = [{ text: n(open.length, 'task') + ' remain open' + (overdue.length ? ', of which ' + n(overdue.length, 'item') + ' ' + (overdue.length === 1 ? 'has' : 'have') + ' slipped past the due date' : '') + ', ' + addr() + '.' }];
      open.slice(0, 6).forEach(t => {
        const m = Repo.matter(t.matterId);
        blocks.push({ text: '• **' + (t.title || 'Untitled task') + '**' + (m ? ' — ' + m.title : '') + (t.due ? ' (' + I.date(t.due, { weekday: false }) + ')' : '') });
      });
      if (drafts.length) blocks.push({ text: 'And ' + n(drafts.length, 'draft') + ' await final review: ' + drafts.map(d => d.name).join(', ') + '.' });
      const acts = open.slice(0, 3).map(t => ({ label: 'Done: ' + shortLabel(t.title), act: 'done-task', id: t.id }));
      return Jarvis.reply(blocks, acts.concat([{ label: 'Open matters', act: 'matters' }]));
    },

    deadlineSummary() {
      const soon = Repo.upcomingReminders(14);
      const pendingProcs = Repo.data.tasks.filter(t => !t.done && t.kind === 'process' && t.due);
      if (!soon.length && !pendingProcs.length) {
        if (I.fullHindi()) return Jarvis.reply([{ text: 'आगामी चौदह दिनों में कोई समय-सीमा अंकित नहीं है, ' + addressHi() + '। यह एक अच्छी स्थिति है।', lang: 'hi' }], [{ label: 'रिमाइंडर जोड़ें', act: 'new-reminder' }]);
        return Jarvis.reply([{ text: 'No filing deadline or limitation date falls due in the next fortnight, ' + addr() + '. A comfortable position.' }], [{ label: 'Add reminder', act: 'new-reminder' }]);
      }
      if (I.fullHindi()) {
        const blocks = [{ lang: 'hi', text: 'आगामी समय-सीमाएँ:' }];
        soon.slice(0, 6).forEach(r => blocks.push({ lang: 'hi', text: '• ' + (r.titleHi || r.title) + ' — ' + I.date(r.date, { hi: true }) + (r.matterId && Repo.matter(r.matterId) ? ' · ' + (Repo.matter(r.matterId).titleHi || Repo.matter(r.matterId).title) : '') }));
        if (pendingProcs.length) blocks.push({ lang: 'hi', text: 'प्रक्रियागत अनुपालन शेष: ' + pendingProcs.slice(0, 4).map(t => t.titleHi || t.title).join('; ') + '।' });
        return Jarvis.reply(blocks, [{ label: 'रिमाइंडर जोड़ें', act: 'new-reminder' }]);
      }
      const blocks = [{ text: 'The coming deadlines, ' + addr() + ':' }];
      soon.slice(0, 6).forEach(r => {
        const m = r.matterId ? Repo.matter(r.matterId) : null;
        blocks.push({ text: '• **' + (r.title || 'Reminder') + '** — ' + I.date(r.date, { weekday: true }) + (m ? ' · ' + m.title : '') });
      });
      if (pendingProcs.length) blocks.push({ text: '**Procedural compliances still open.** ' + pendingProcs.slice(0, 4).map(t => t.title + (t.due ? ' (' + I.date(t.due, { weekday: false }) + ')' : '')).join('; ') + '.' });
      const quick = soon.slice(0, 2).map(r => ({
        label: 'Remind me: ' + (r.title || 'deadline'),
        act: 'new-reminder',
        prefill: { title: r.title || 'Deadline', date: r.date, time: r.time || '09:00', matterId: r.matterId || null, kind: 'limitation' }
      }));
      return Jarvis.reply(blocks, quick.concat([{ label: 'Add reminder', act: 'new-reminder' }, { label: 'Open diary', act: 'diary' }]));
    },

    draftSummary() {
      const drafts = Repo.data.documents.filter(d => d.status === 'in-progress');
      if (!drafts.length) {
        if (I.fullHindi()) return Jarvis.reply([{ text: 'कोई प्रारूप अंतिम समीक्षा हेतु लंबित नहीं है, ' + addressHi() + '।', lang: 'hi' }], [{ label: 'दस्तावेज़', act: 'documents' }]);
        return Jarvis.reply([{ text: 'No drafts are awaiting your review, ' + addr() + '. The archive is tidy.' }], [{ label: 'Open archive', act: 'documents' }]);
      }
      const blocks = I.fullHindi()
        ? [{ lang: 'hi', text: drafts.length + ' प्रारूप आपकी समीक्षा की प्रतीक्षा में हैं:' }]
        : [{ text: n(drafts.length, 'draft') + ' await your final review, ' + addr() + ':' }];
      drafts.slice(0, 6).forEach(d => {
        const m = d.matterId ? Repo.matter(d.matterId) : null;
        blocks.push(I.fullHindi()
          ? { lang: 'hi', text: '• **' + (d.nameHi || d.name) + '**' + (m ? ' — ' + (m.titleHi || m.title) : '') }
          : { text: '• **' + d.name + '**' + (m ? ' — ' + m.title : '') + (d.type ? ' · ' + d.type : '') });
      });
      const acts = drafts.slice(0, 4).map((d, i) => ({ label: 'Open draft ' + (i + 1), act: 'open-doc', id: d.id }));
      return Jarvis.reply(blocks, acts);
    },

    counts() {
      const active = Repo.data.matters.filter(m => m.status !== 'disposed');
      const disposed = Repo.data.matters.filter(m => m.status === 'disposed');
      const docs = Repo.data.documents.length;
      if (I.fullHindi()) {
        return Jarvis.reply([{ lang: 'hi', text: 'रजिस्टर में कुल ' + (active.length + disposed.length) + ' मामले हैं — ' + active.length + ' सक्रिय और ' + disposed.length + ' निस्तारित। संग्रह में ' + docs + ' दस्तावेज़ सुरक्षित हैं।' }],
          [{ label: 'मामले', act: 'matters' }, { label: 'दस्तावेज़', act: 'documents' }]);
      }
      return Jarvis.reply([{ text: 'The register holds ' + n(active.length + disposed.length, 'matter') + ' — ' + active.length + ' active and ' + disposed.length + ' disposed. The archive contains ' + n(docs, 'document') + '.' }],
        [{ label: 'Open register', act: 'matters' }, { label: 'Open archive', act: 'documents' }]);
    },

    helpReply() {
      if (I.fullHindi()) {
        return Jarvis.reply([{ lang: 'hi', text: 'मैं अंग्रेज़ी और हिंदी, दोनों में आपकी सेवा कर सकता हूँ, ' + addressHi() + '।\n\nमुझसे कहिए:\n• “आज का ब्रीफिंग” या “कल की सूची”\n• “शर्मा मामले की अगली तारीख”\n• “नवीनतम जवाब दिखाइए”\n• “नया केस जोड़ो” / “तारीख जोड़ो” / “रिमाइंडर लगाओ”\n• “क्या काम बकाया है”\n• “फाइलें जोड़ो”\n\nमैं आपके दस्तावेज़ स्वयं वर्गीकृत करता हूँ, तिथियाँ याद रखता हूँ और निर्धारित समय पर सूचित करता हूँ।' }],
          [{ label: 'आज का ब्रीफिंग', act: 'brief' }, { label: 'मामले', act: 'matters' }, { label: 'दस्तावेज़', act: 'documents' }]);
      }
      return Jarvis.reply([{
        text: 'I am at your service, ' + addr() + '. Speak to me as you would to a junior — or indeed, to a butler.\n\n' +
          '**The chamber.** “Give me my briefing.” “What is listed tomorrow?” “What is pending?”\n' +
          '**A matter.** “Next date in the Sharma case.” “Status of Balaji Traders.”\n' +
          '**Papers.** “Pull up the latest reply in the Sharma case.” “Show me the draft notice from yesterday.”\n' +
          '**New work.** “Add a case.” “Add a date.” “Remind me to file the process fee on Monday.” “Mark the rejoinder done.”\n' +
          '**The archive.** “Import documents.” “Sync e-Courts.”\n\n' +
          'I file every document by court, case and type, and I keep your diary, deadlines and drafts under constant watch. You may also type, when the court demands silence.'
      }], [{ label: 'Brief me', act: 'brief' }, { label: 'Open matters', act: 'matters' }, { label: 'Import documents', act: 'import-files' }]);
    },

    whoReply() {
      if (I.fullHindi()) {
        return Jarvis.reply([{ lang: 'hi', text: 'मैं लीगल जार्विस हूँ, ' + addressHi() + ' — आपके चैंबर का डिजिटल सहायक। मैं आपकी फाइलें व्यवस्थित करता हूँ, तिथियाँ स्मरण रखता हूँ, प्रारूपों पर दृष्टि रखता हूँ और प्रत्येक प्रातः आपका ब्रीफिंग प्रस्तुत करता हूँ। आपकी सेवा में, सदैव।' }],
          [{ label: 'मेरी क्षमताएँ', act: 'help' }]);
      }
      return Jarvis.reply([{ text: 'I am Legal Jarvis, ' + addr() + ' — your chamber’s digital secretary. I read and file your papers, mind your diary, watch your limitation dates, keep an eye on drafts, and brief you each morning. I do not sleep, I do not forget, and I do not lose files.\n\nAt your service.' }],
        [{ label: 'What can you do?', act: 'help' }]);
    },

    thanksReply() {
      if (I.fullHindi()) return Jarvis.reply([{ lang: 'hi', text: 'यह मेरा कर्तव्य है, ' + addressHi() + '। आपकी सेवा में सदैव उपस्थित।' }]);
      return Jarvis.say('It is my pleasure, ' + addr() + '. Always at your service.');
    },

    /* ---------------- main dispatch ---------------- */
    handle(rawQuery, opts = {}) {
      const q = String(rawQuery || '').trim();
      const low = q.toLowerCase();
      if (!q) return Jarvis.greeting();
      const devCount = (q.match(/[ऀ-ॿ]/g) || []).length;
      const letterCount = (q.replace(/\s/g, '') || '').length || 1;
      I._autoHi = (I.mode() === 'auto' && devCount >= 3 && devCount / letterCount > 0.45);
      try {
      const hiMode = I.fullHindi();

      /* control */
      if (/^(stop|quiet|silence|shut up|chup|ruko|रुको|चुप|बंद करो|stop talking)\b/.test(low)) {
        Jarvis.stopSpeaking();
        return Jarvis.reply([{ text: hiMode ? 'जैसी आज्ञा, ' + addressHi() + '।' : 'As you wish, ' + addr() + '.', lang: hiMode ? 'hi' : 'en' }], [], { silent: true });
      }
      if (/^(repeat|again|phir se|फिर से|दोहराओ)\b/.test(low)) {
        if (Jarvis.lastReply) return Object.assign({}, Jarvis.lastReply, { repeated: true });
        return Jarvis.say(hiMode ? 'अभी कहने के लिए कुछ नहीं है, ' + addressHi() + '।' : 'I have nothing to repeat, ' + addr() + '.');
      }
      if (/(speak|talk|बोलो|बात करो|जवाब दो).*(hindi|हिंदी)|(hindi|हिंदी).*(speak|talk|बोलो|में बोलो)|switch to hindi|use hindi/.test(low)) {
        I.mode(); S.set('langMode', 'hi');
        return Jarvis.reply([{ lang: 'hi', text: 'बहुत अच्छा, ' + addressHi() + '। अब मैं हिंदी में बात करूँगा। जैसी आपकी आज्ञा।' }], [{ label: 'English', act: 'lang-en' }, { label: 'Auto', act: 'lang-auto' }]);
      }
      if (/(speak|talk|बोलो|बात करो).*(english|अंग्रेज़ी|अंग्रेजी)|(english|अंग्रेज़ी).*(speak|talk|में बोलो)|switch to english|use english/.test(low)) {
        S.set('langMode', 'en');
        return Jarvis.reply([{ text: 'Very good, ' + addr() + '. I shall speak in English. Hindi shall remain available whenever a document calls for it.' }], [{ label: 'Auto', act: 'lang-auto' }, { label: 'हिंदी', act: 'lang-hi' }]);
      }
      if (/(auto|automatic).*(language|bhasha)|language.*(auto|automatic)|मिश्रित भाषा/.test(low)) {
        S.set('langMode', 'auto');
        return Jarvis.reply([{ text: 'Auto mode restored, ' + addr() + '. English for the chamber; Hindi whenever a Hindi file demands it.' }], [{ label: 'हिंदी', act: 'lang-hi' }, { label: 'English', act: 'lang-en' }]);
      }

      /* greetings & pleasantries */
      if (/^((hi|hello|hey|hii+|good morning|good afternoon|good evening|namaste|namaskar|jarvis|सुप्रभात|नमस्ते|नमस्कार|जार्विस)[\s,!.?]*){1,3}$/i.test(q)) return Jarvis.greeting();
      if (/(thank you|thanks|dhanyavad|shukriya|धन्यवाद|शुक्रिया)/.test(low)) return Jarvis.thanksReply();
      if (/(who are you|what are you|तुम कौन|आप कौन|your name|तुम्हारा नाम|आपका नाम)/.test(low)) return Jarvis.whoReply();
      if (/(help|what can you do|how do i|commands|मदद|क्या कर सकते|सहायता)/.test(low)) return Jarvis.helpReply();

      /* explicit paper retrieval — “pull up”, “open”, “show me” with a document noun */
      const wantsDoc = TYPE_WORDS.test(low);
      const explicitOpen = /(open|pull up|locate|kholo|खोलो|dikhao|दिखाओ|show me|lao|लाओ)/i.test(low);
      const explicitFind = /(pull up|locate|find|search|dhoondo|ढूंढ|खोज|latest|newest|नवीनतम|ताज़ा)/i.test(low);
      if (wantsDoc && (explicitOpen || explicitFind)) {
        const onlyCounting = /^(how many|kitne|कितने)\b/i.test(low) || /\b(import|add|scan|file them|फाइलें जोड़|इंपोर्ट)\b/i.test(low);
        if (!onlyCounting) return explicitOpen ? Jarvis.docSearchReply(q, { open: true }) : Jarvis.docListReply(q);
      }

      /* briefing */
      if (/(brief|briefing|brief me|summary|summarise|summarize|round.?up|ब्रीफ|सारांश|आज का हाल|हाल बताओ)/.test(low)) {
        const evening = /evening|tonight|शाम|रात|evening briefing/.test(low);
        return Jarvis.buildBrief(evening ? 'evening' : 'morning');
      }

      /* what to carry */
      if (/(carry|ले जाना|ले जाऊँ|साथ ले|कौन सी फाइल.*ले)/.test(low)) {
        return Jarvis.carryFor(/today|आज/.test(low) ? 'today' : 'tomorrow');
      }

      /* cause list / tomorrow / today */
      const causeIntent = /(cause list|court list|diary|kya hai|kya listed|sunwai|peshi|पेशी|सुनवाई|सूची|what.?s (on|listed|happening)|what is (on|listed)|what do i have|what have i|which matters|kaun se mamle|कौन से मामले|listed|schedule)/i.test(low);
      const dayRef = /(tomorrow|कल\b|today|आज)/i.test(low);
      if ((causeIntent && dayRef) || /^(tomorrow|kal|कल)[\s!.?]*$/i.test(q.trim()) || /^(today|aaj|आज)[\s!.?]*$/i.test(q.trim())) {
        const isNextDate = /(next date|next hearing|अगली तारीख|अगली पेशी|kab|कब)/i.test(low);
        if (!isNextDate) return /(tomorrow|कल\b)/.test(low) ? Jarvis.causeList('tomorrow') : Jarvis.causeList('today');
      }

      /* add flows */
      if (/(add|new|create|register|जोड़ो|जोड़ें|नया|बनाओ)/.test(low)) {
        if (/(case|matter|केस|मामला)/.test(low)) return Jarvis.openAddCase(q);
        if (/(hearing|date|listing|पेशी|तारीख|सुनवाई)/.test(low)) return Jarvis.openAddHearing(q);
        if (/(reminder|remind|याद|रिमाइंडर)/.test(low)) return Jarvis.openAddReminder(q);
        if (/(task|work|काम|कार्य)/.test(low)) {
          const title = U.titleCase(U.clean(q.replace(/^.*?\b(add|new|create|task|काम|कार्य)\b/i, '').replace(/[.?!]+$/, ''))) || 'Chamber task';
          return Jarvis.reply([{ text: hiMode ? 'कार्य जोड़ने का प्रपत्र तैयार है, ' + addressHi() + '।' : 'The task form is ready, ' + addr() + '.' }],
            [{ label: hiMode ? 'कार्य जोड़ें' : 'Add task', act: 'new-task', prefill: { title } }], { openTask: { title } });
        }
      }
      if (/(remind me|set (a )?reminder|reminder|याद दिलाओ|रिमाइंडर)/.test(low)) return Jarvis.openAddReminder(q);

      /* generic search across the archive */
      if (/(search|find|locate|dhoondo|ढूंढ|खोज)/i.test(low) && q.split(/\s+/).length >= 2) {
        return Jarvis.docListReply(q.replace(/^(search|find|locate|dhoondo|khojo|ढूंढो|खोजो)\s+/i, ''));
      }

      /* tasks / deadlines / drafts */
      if (/(mark|done|complete|finish|check off|पूरा|संपन्न|हो गया)/.test(low)) {
        const t = bestTask(q);
        if (t) return Jarvis.markTaskDone(t);
      }
      if (/(pending|task|to.?do|chamber work|बकाया|लंबित|कार्य|काम)/.test(low)) return Jarvis.taskSummary();
      if (/(deadline|limitation|due|filing date|समय.?सीमा|परिसीमा|अंतिम तिथि)/.test(low)) return Jarvis.deadlineSummary();
      if (/(draft|drafts|प्रारूप|review)/.test(low)) return Jarvis.draftSummary();

      /* counts */
      if (/(how many|count|kitne|कितने|कुल कितने)/.test(low)) return Jarvis.counts();

      /* import / sync */
      if (/(import|scan|add (my )?files|नई फाइल|फाइलें जोड़|इंपोर्ट|स्कैन)/.test(low)) {
        return Jarvis.reply([{ text: hiMode
          ? 'अवश्य, ' + addressHi() + '। मैं फाइल चयनकर्ता खोल रहा हूँ। PDF और Word दस्तावेज़ चुनें — मैं उन्हें पढ़कर न्यायालय, मामले और प्रकार के अनुसार स्वयं व्यवस्थित कर दूँगा।'
          : 'Of course, ' + addr() + '. I am opening the file picker. Select the PDF and Word documents; I shall read them and file each one by court, case and type without further instruction.' }],
        [{ label: 'Choose files', act: 'import-files' }, { label: 'Choose a folder', act: 'import-folder' }], { triggerImport: true });
      }
      if (/(e.?courts|drive|google drive|sync|सिंक|ई.?कोर्ट|ड्राइव)/.test(low)) {
        return Jarvis.reply([{ text: hiMode
          ? 'ई-कोर्ट्स और गूगल ड्राइव से मामला-सूची आयात की जा सकती है। मैं फ़ाइल चयनकर्ता खोलता हूँ — वहाँ गूगल ड्राइव चुनें और ई-कोर्ट्स द्वारा निर्यातित CSV अथवा दस्तावेज़ चुनें। मैं उन्हें मुख्य रजिस्टर में मिला दूँगा और तिथियाँ स्वयं अद्यतन रखूँगा।'
          : 'e-Courts exports and your Google Drive backups can be brought straight in. I shall open the picker; choose Google Drive, then the e-Courts CSV or backup folder. I will merge the case data into the master register and keep the dates current.' }],
        [{ label: 'Import e-Courts data', act: 'import-ecourts', drive: true }, { label: 'Open archive', act: 'documents' }]);
      }

      /* navigation */
      if (/(open|go to|show me).*(document|archive|files)|(दस्तावेज़|संग्रह|फाइलें).*(खोलो|दिखाओ)/.test(low) && !TYPE_WORDS.test(low.replace(/documents?|फाइलें|संग्रह/g, ''))) {
        return Jarvis.reply([{ text: hiMode ? 'संग्रह प्रस्तुत है, ' + addressHi() + '।' : 'The archive is before you, ' + addr() + '.' }], [{ label: 'Open archive', act: 'documents' }], { navigate: 'documents' });
      }
      if (/(open|go to|show).*(matter|matters|register|case list)|(मामले|रजिस्टर).*(खोलो|दिखाओ)/.test(low)) {
        return Jarvis.reply([{ text: hiMode ? 'मामला रजिस्टर प्रस्तुत है, ' + addressHi() + '।' : 'The register is before you, ' + addr() + '.' }], [{ label: 'Open register', act: 'matters' }], { navigate: 'matters' });
      }
      if (/(open|go to|show).*(diary|calendar|cause)|(डायरी|कैलेंडर).*(खोलो|दिखाओ)/.test(low)) {
        return Jarvis.reply([{ text: hiMode ? 'डायरी प्रस्तुत है, ' + addressHi() + '।' : 'Your diary, ' + addr() + '.' }], [{ label: 'Open diary', act: 'diary' }], { navigate: 'diary' });
      }
      if (/(settings|setup|सेटिंग|सेटअप).*(open|खोलो|दिखाओ)|open settings/.test(low)) {
        return Jarvis.reply([{ text: hiMode ? 'सेटअप प्रस्तुत है।' : 'Setup is before you.' }], [{ label: 'Setup', act: 'settings' }], { navigate: 'settings' });
      }

      /* sample data */
      if (/(clear|remove|delete).*(sample|demo)|(सैंपल|नमूना).*(हटाओ|साफ)/.test(low)) {
        return Jarvis.reply([{ text: hiMode ? 'क्या मैं सभी नमूना प्रविष्टियाँ हटा दूँ? यह क्रिया पुष्टि के बाद ही होगी।' : 'Shall I clear all sample entries from the chamber? I shall not act without your confirmation.' }],
          [{ label: 'Clear sample data', act: 'clear-samples', confirm: true }, { label: 'Keep them', act: 'noop' }]);
      }

      /* matter status / next date */
      const matter = Docs.revMatter(q);
      if (matter && /(next date|next hearing|when|kab|अगली तारीख|अगली पेशी|तारीख|कब|date)/i.test(low)) return Jarvis.nextDateFor(matter);
      if (matter && !TYPE_WORDS.test(low)) return Jarvis.caseProfile(matter);

      /* matter fallback: any known matter named in query */
      if (matter) return Jarvis.caseProfile(matter);

      /* document fallback; then a graceful answer */
      const docHit = Docs.bestMatch(q);
      if (docHit) return Jarvis.docSearchReply(q);
      return Jarvis.fallback(q);
      } finally {
        I._autoHi = false;
      }
    },

    fallback(q) {
      const act = [{ label: 'Brief me', act: 'brief' }, { label: 'Open diary', act: 'diary' }, { label: 'Open matters', act: 'matters' }];
      if (I.fullHindi()) {
        return Jarvis.reply([{ text: 'क्षमा करें, ' + addressHi() + ' — मैं वह आदेश ठीक से नहीं समझ सका। आप मामले का नाम, तिथि अथवा दस्तावेज़ का प्रकार बताकर पुनः कह सकते हैं। मैं सुन रहा हूँ।', lang: 'hi' }], act);
      }
      return Jarvis.reply([{ text: 'I confess I did not quite follow that, ' + addr() + '. Name the matter, the date, or the paper, and I shall act. Alternatively, ask me for your briefing — I am listening.' }], act);
    },

    markTaskDone(t) {
      const m = Repo.matter(t.matterId);
      if (I.fullHindi()) return Jarvis.reply([{ lang: 'hi', text: 'कार्य पूर्ण के रूप में अंकित, ' + addressHi() + ': ' + (t.titleHi || t.title) + '.' }], [{ label: 'मामला खोलें', act: 'open-matter', id: t.matterId }], { doneTask: t.id });
      return Jarvis.reply([{ text: 'Marked as done, ' + addr() + ': **' + t.title + '**' + (m ? ' in the ' + shortLabel(m.title) + ' matter' : '') + '. One less thing to carry.' }],
        [{ label: 'Open matter', act: 'open-matter', id: t.matterId }], { doneTask: t.id });
    },

    /* ---------------- suggestions ---------------- */
    suggestions() {
      const st = Jarvis.stats();
      const out = [];
      if (I.fullHindi()) {
        out.push({ label: 'आज का ब्रीफिंग', act: 'brief' });
        if (st.tomorrowList.length) out.push({ label: 'कल की सूची', act: 'tomorrow' });
        if (st.drafts.length) out.push({ label: 'प्रारूप समीक्षा', act: 'drafts' });
        out.push({ label: 'लंबित कार्य', act: 'tasks' });
        return out;
      }
      out.push({ label: 'Brief me', act: 'brief' });
      if (st.tomorrowList.length) out.push({ label: "Tomorrow's cause list", act: 'tomorrow' });
      if (st.drafts.length) out.push({ label: 'Drafts to review', act: 'drafts' });
      out.push({ label: 'Pending work', act: 'tasks' });
      return out;
    },

    stageLine() {
      const st = Jarvis.stats();
      const tmr = st.tomorrowList.length;
      const drafts = st.drafts.length;
      if (I.fullHindi()) {
        return tmr
          ? 'कल ' + tmr + ' मामले सूचीबद्ध हैं' + (drafts ? '; ' + drafts + ' प्रारूप आपकी समीक्षा की प्रतीक्षा में हैं' : '') + '।'
          : 'कल कोई सुनवाई नहीं है' + (drafts ? '; ' + drafts + ' प्रारूप समीक्षा हेतु लंबित हैं' : '') + '।';
      }
      return tmr
        ? 'You have ' + n(tmr, 'matter') + ' listed tomorrow' + (drafts ? ', and ' + n(drafts, 'draft') + ' awaiting your review' : '') + '.'
        : 'Tomorrow is unlisted' + (drafts ? '; ' + n(drafts, 'draft') + ' await your review' : '') + '.';
    },

    parseWhen
  };

  /* ---------------- helpers ---------------- */
  function n(count, singular, plural) {
    if (I.fullHindi()) return count + ' ' + singular;
    return count + ' ' + (count === 1 ? singular : (plural || singular + 's'));
  }
  function Utils(arr) {
    return U.sortBy(arr || [], h => (h.date + ' ' + (h.time || '00:00')), 1);
  }
  function nextHearingOf(m) {
    const today = U.todayISO();
    const list = Repo.data.hearings.filter(h => h.matterId === m.id && h.date >= today).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    if (list.length) return list[0];
    if (m.nextHearing && m.nextHearing >= today) return { date: m.nextHearing, time: m.nextTime, court: m.nextCourt || m.court, purpose: m.nextPurpose };
    return null;
  }
  function uniqueCourts(list) {
    return U.unique(list.map(h => (h.court || (Repo.matter(h.matterId) || {}).court || '')).map(c => c.trim()).filter(Boolean));
  }
  function carryLines(list) {
    const out = [];
    list.forEach(h => {
      const m = Repo.matter(h.matterId);
      if (!m) return;
      const docs = Repo.docsFor(m.id);
      const important = docs.filter(d => /Plaint|Petition|Reply|Rejoinder|Written Statement|Evidence|Application|Order/.test(d.type)).slice(0, 2);
      out.push(shortLabel(m.title) + (important.length ? ' (' + important.map(d => d.name).join('; ') + ')' : ''));
    });
    return out;
  }
  function prepFor(list) {
    const out = [];
    list.forEach(h => {
      const m = Repo.matter(h.matterId);
      if (!m) return;
      Repo.tasksFor(m.id).filter(t => !t.done).slice(0, 2).forEach(t => out.push(t.title));
      Repo.docsFor(m.id).filter(d => d.status === 'in-progress').forEach(d => out.push('final review of ' + d.name));
    });
    return U.unique(out);
  }
  function shortLabel(title) {
    const t = String(title || '').replace(/\s+v\.?\s+.*$/i, '').replace(/\s+बनाम\s+.*$/, '');
    const parts = U.clean(t).split(' ');
    return parts.length > 3 ? parts.slice(0, 3).join(' ') : t;
  }
  function bestTask(q) {
    const open = Repo.openTasks();
    let best = null, bestScore = 0;
    open.forEach(t => {
      let s = LJ.scoreText(q, t.title || '');
      const m = Repo.matter(t.matterId);
      if (m) s += LJ.scoreText(q, m.title || '') * 0.7 + LJ.scoreText(q, m.client || '') * 0.7;
      s += LJ.scoreText(q, t.titleHi || '');
      if (s > bestScore) { bestScore = s; best = t; }
    });
    return bestScore >= 5 ? best : (open.length === 1 ? open[0] : null);
  }
  function hindiDocLine(d, m) {
    const type = I.typeHi(d.type) || 'दस्तावेज़';
    const court = d.courtHi || (m && m.courtHi) || '';
    const title = (m && m.titleHi) || d.caseTitleHi || d.caseTitle || '';
    if (/प्लेट|plaint|वादपत्र/i.test(type)) {
      return 'यह दस्तावेज़ हिंदी में है — ' + (court ? court + ' में ' : '') + 'प्रस्तुत ' + type + (title ? ', मामला ' + title : '') + '। इसका सारांश: ' + (d.excerpt ? d.excerpt.slice(0, 140) : 'वाद पत्र दाखिल है।');
    }
    if (/जवाब|reply/i.test(type)) {
      return 'यह हिंदी में प्रस्तुत जवाब है' + (title ? ' — ' + title : '') + (court ? ', ' + court : '') + '। मैं इसे खोल सकता हूँ, यदि आप आज्ञा दें।';
    }
    return 'यह दस्तावेज़ हिंदी में है — ' + type + (title ? ' · ' + title : '') + (court ? ' · ' + court : '') + '।';
  }

  /* ---------------- date parsing (EN + HI + Hinglish) ---------------- */
  function parseWhen(text) {
    const t = ' ' + String(text || '').toLowerCase() + ' ';
    const today = U.todayISO();
    let iso = null, time = null;
    const tm = t.match(/\b(?:at|से|बजे)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|बजे)?\b/);
    if (tm && +tm[1] <= 24) {
      let h = +tm[1];
      if (/pm/.test(tm[3] || '') && h < 12) h += 12;
      if (/am/.test(tm[3] || '') && h === 12) h = 0;
      time = String(h).padStart(2, '0') + ':' + (tm[2] || '00');
    }
    if (/\btoday\b|\baaj\b|आज/.test(t)) iso = today;
    else if (/\btomorrow\b|\bkal\b|कल(?!\s+परसों)/.test(t)) iso = U.isoOf(U.addDays(today, 1));
    else if (/day after tomorrow|parso|परसों/.test(t)) iso = U.isoOf(U.addDays(today, 2));
    else if (/next week|agle hafte|अगले सप्ताह/.test(t)) iso = U.isoOf(U.addDays(today, 7));

    if (!iso) {
      const m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b(?:[\s,]+(\d{4}))?/);
      if (m) {
        const mo = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 }[m[2]];
        let yr = m[3] ? +m[3] : new Date().getFullYear();
        let dt = new Date(yr, mo, +m[1]);
        if (!m[3] && dt < U.startOfDay(new Date())) dt = new Date(yr + 1, mo, +m[1]);
        iso = U.isoOf(dt);
      }
    }
    if (!iso) {
      const hiNames = { 'जनवरी': 0, 'फरवरी': 1, 'फ़रवरी': 1, 'मार्च': 2, 'अप्रैल': 3, 'मई': 4, 'जून': 5, 'जुलाई': 6, 'अगस्त': 7, 'सितंबर': 8, 'सितम्बर': 8, 'अक्टूबर': 9, 'अक्तूबर': 9, 'नवंबर': 10, 'नवम्बर': 10, 'दिसंबर': 11, 'दिसम्बर': 11 };
      for (const name in hiNames) {
        const m = t.match(new RegExp('(\\d{1,2})\\s*' + name + '\\s*(\\d{4})?'));
        if (m) {
          let yr = m[2] ? +m[2] : new Date().getFullYear();
          let dt = new Date(yr, hiNames[name], +m[1]);
          if (!m[2] && dt < U.startOfDay(new Date())) dt = new Date(yr + 1, hiNames[name], +m[1]);
          iso = U.isoOf(dt);
          break;
        }
      }
    }
    if (!iso) {
      const m = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
      if (m) {
        let d = +m[1], mo = +m[2] - 1;
        if (mo > 11) { const tmp = d; d = mo + 1; mo = tmp - 1; }
        let yr = m[3] ? +m[3] : new Date().getFullYear();
        if (yr < 100) yr += 2000;
        let dt = new Date(yr, mo, d);
        if (!m[3] && dt < U.startOfDay(new Date())) dt = new Date(yr + 1, mo, d);
        iso = U.isoOf(dt);
      }
    }
    if (!iso) {
      const days = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, रविवार: 0, सोमवार: 1, मंगलवार: 2, बुधवार: 3, गुरुवार: 4, शुक्रवार: 5, शनिवार: 6 };
      for (const name in days) {
        if (t.includes(name)) {
          const todayD = new Date();
          let diff = (days[name] - todayD.getDay() + 7) % 7;
          if (diff === 0) diff = 7;
          if (/next|अगले/.test(t)) diff += 0;
          iso = U.isoOf(U.addDays(todayD, diff));
          break;
        }
      }
    }
    if (!iso) return null;
    return { iso, time };
  }

  window.LJ.Jarvis = Jarvis;
})();
