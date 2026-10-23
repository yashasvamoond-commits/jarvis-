/* ============================================================
   Legal Jarvis — chamber setup
   ============================================================ */
(function () {
  'use strict';
  const U = LJ.Utils;
  const S = LJ.Settings;
  const Repo = LJ.Repo;
  const I = LJ.I18N;
  const App = LJ.App;
  const Bridge = LJ.Bridge;
  const Docs = LJ.Docs;

  const esc = U.esc;

  const SetupUI = {
    voices: null,

    render() {
      const el = App.els.settingsBody;
      if (!el) return;
      const set = S.all();
      const folders = set.folders || [];
      const totalBytes = Repo.data.documents.reduce((n, d) => n + (d.size || 0), 0);
      const archived = Repo.data.documents.filter(d => d.storage === 'archive').length;
      const sample = Repo.data.matters.filter(m => m.sample).length;
      const platform = Bridge.info && Bridge.info.platform === 'native' ? 'Android · on-device' : 'Browser preview';

      el.innerHTML =
        '<div class="settings-grid">' +

        /* profile */
        '<section class="card settings-card">' +
        '<p class="eyebrow">The chamber</p><h2>Chamber profile</h2>' +
        '<p class="desc">How Jarvis addresses you, and the language of the chamber.</p>' +
        '<form id="profileForm">' +
        field('How shall I address you?', '<input class="input" id="setOwnerName" value="' + esc(set.ownerName || 'Sir') + '" placeholder="Sir">', 'Your name, or simply “Sir”. I shall use it in every briefing.') +
        field('Principal court', '<input class="input" id="setHomeCourt" value="' + esc(set.homeCourt || '') + '" placeholder="Rajasthan High Court, Jaipur Bench">', 'Used as the default when adding a matter.') +
        field('Language', '<select class="input" id="setLangMode">' +
          ['auto', 'en', 'hi'].map(m => '<option value="' + m + '" ' + (set.langMode === m ? 'selected' : '') + '>' +
            (m === 'auto' ? 'Auto — English, with Hindi for Hindi papers' : m === 'en' ? 'English only' : 'हिंदी') + '</option>').join('') +
          '</select>', 'Auto follows your rule: the working language is English; Hindi is used to describe a file whose name or contents are in Hindi.') +
        '<button class="primary-btn" type="submit">Save profile</button>' +
        '</form></section>' +

        /* voice */
        '<section class="card settings-card">' +
        '<p class="eyebrow">Persona</p><h2>The Jarvis voice</h2>' +
        '<p class="desc">Calm, precise, British. The Android engine supplies the timbre; your settings supply the character.</p>' +
        '<div class="setting-field"><label>Voice</label><select class="input" id="setVoice"><option value="">Auto — best British voice installed</option></select>' +
        '<p class="hint" id="voiceHint">Reading the installed voices…</p></div>' +
        '<div class="setting-field"><label>Pace</label><div class="slider-row"><input type="range" id="setRate" min="0.7" max="1.15" step="0.01" value="' + esc(set.speechRate) + '"><b id="rateVal">' + Number(set.speechRate).toFixed(2) + '</b></div>' +
        '<p class="hint">0.94 is measured and unhurried. Above 1.05 begins to sound rushed.</p></div>' +
        '<div class="setting-field"><label>Timbre</label><div class="slider-row"><input type="range" id="setPitch" min="0.6" max="1.2" step="0.01" value="' + esc(set.speechPitch) + '"><b id="pitchVal">' + Number(set.speechPitch).toFixed(2) + '</b></div>' +
        '<p class="hint">A shade below 1.0 lends the voice its butler-like gravity.</p></div>' +
        '<div class="toggle-row"><div class="tlabel"><strong>Speak replies aloud</strong><small>When off, I remain silent and answer in writing.</small></div>' +
        '<label class="switch"><input type="checkbox" id="setAutoSpeak" ' + (set.autoSpeak ? 'checked' : '') + '><span class="track"></span></label></div>' +
        '<div class="toggle-row"><div class="tlabel"><strong>Greet me on opening</strong><small>A short spoken welcome when the chamber opens.</small></div>' +
        '<label class="switch"><input type="checkbox" id="setGreet" ' + (set.greetOnOpen !== false ? 'checked' : '') + '><span class="track"></span></label></div>' +
        '<div class="toggle-row"><div class="tlabel"><strong>Speak the morning briefing automatically</strong><small>Once each day, when you first open the chamber.</small></div>' +
        '<label class="switch"><input type="checkbox" id="setAutoBrief" ' + (set.autoBrief ? 'checked' : '') + '><span class="track"></span></label></div>' +
        '<div class="toggle-row"><div class="tlabel"><strong>Hands-free conversation</strong><small>I reopen the microphone after each reply while the app is open.</small></div>' +
        '<label class="switch"><input type="checkbox" id="setHandsFree" ' + (set.handsFree ? 'checked' : '') + '><span class="track"></span></label></div>' +
        '<div class="pill-row" style="margin-top:12px"><button class="ghost-btn" data-action="preview-voice">Audition this voice</button>' +
        '<button class="primary-btn" data-action="save-voice-settings">Save voice</button></div>' +
        '<p class="form-note">For a truly British Jarvis, install <strong>Google Text-to-Speech</strong> and add the voice pack <strong>English (United Kingdom)</strong> in Android settings, then choose it above. <button class="link-btn" data-action="open-tts-settings">Open speech settings</button></p>' +
        '</section>' +

        /* briefings */
        '<section class="card settings-card">' +
        '<p class="eyebrow">Punctuality</p><h2>Briefings & notifications</h2>' +
        '<p class="desc">I shall arrive before the court does.</p>' +
        '<form id="briefForm" class="form-grid">' +
        field('Morning briefing', '<input class="input" type="time" id="setBriefMorning" value="' + esc(set.briefMorning) + '">') +
        field('Evening briefing', '<input class="input" type="time" id="setBriefEvening" value="' + esc(set.briefEvening) + '">') +
        '</form>' +
        '<div class="toggle-row"><div class="tlabel"><strong>Notifications</strong><small>Deadlines, reminders and both daily briefings, even when the app is closed.</small></div>' +
        '<label class="switch"><input type="checkbox" id="setNotify" ' + (set.notifications ? 'checked' : '') + '><span class="track"></span></label></div>' +
        '<div class="setting-field" style="margin-top:14px"><label>Voice recognition language</label><select class="input" id="setRecogLang">' +
        ['en-IN', 'hi-IN', 'en-GB'].map(l => '<option value="' + l + '" ' + (set.recogLang === l ? 'selected' : '') + '>' + (l === 'en-IN' ? 'English (India) — recommended' : l === 'hi-IN' ? 'हिंदी (India)' : 'English (United Kingdom)') + '</option>').join('') +
        '</select><p class="hint">Spoken commands may mix English and Hindi; English (India) handles both well.</p></div>' +
        '<div class="toggle-row"><div class="tlabel"><strong>Rescan linked folders on opening</strong><small>New PDFs and Word files placed in a linked folder are filed automatically.</small></div>' +
        '<label class="switch"><input type="checkbox" id="setRescan" ' + (set.rescanOnResume ? 'checked' : '') + '><span class="track"></span></label></div>' +
        '<div class="pill-row" style="margin-top:14px">' +
        '<button class="primary-btn" data-action="save-brief-settings">Save briefings</button>' +
        '<button class="ghost-btn" data-action="save-misc">Save recognition</button>' +
        '<button class="ghost-btn" data-action="enable-notifications">Allow notifications</button>' +
        '<button class="ghost-btn" data-action="test-notification">Send a test</button>' +
        '<button class="ghost-btn" data-action="exact-alarm">Allow exact reminders</button>' +
        '</div></section>' +

        /* documents */
        '<section class="card settings-card">' +
        '<p class="eyebrow">Archive</p><h2>Documents & folders</h2>' +
        '<p class="desc">' + Repo.data.documents.length + ' documents indexed · ' + U.bytes(totalBytes) + ' · ' + archived + ' archived internally.</p>' +
        '<div class="setting-field"><label>Linked folders</label>' +
        (folders.length ? folders.map(f => '<div class="list-item-row" style="padding:8px 0"><div class="grow"><strong style="font-size:12px">' + esc(f.name) + '</strong><div class="sub">' + esc(f.treeUri.slice(0, 70)) + (f.treeUri.length > 70 ? '…' : '') + '</div></div>' +
          '<div class="row-actions"><button class="icon-tiny del" title="Unlink" data-action="remove-folder" data-uri="' + esc(f.treeUri) + '">×</button></div></div>').join('') :
          '<p class="hint">No folder is linked. Link your chamber folder once — Jarvis will scan it and file every PDF and Word document, and rescan it each time the app opens.</p>') +
        '</div>' +
        '<div class="pill-row" style="margin-bottom:12px">' +
        '<button class="primary-btn" data-action="add-linked-folder">Link a folder</button>' +
        '<button class="ghost-btn" data-action="rescan-folders">Rescan now</button>' +
        '<button class="ghost-btn" data-action="import-files">Import files</button>' +
        '<button class="ghost-btn" data-action="scan-device">Scan whole tablet</button>' +
        '</div>' +
        '<div class="pill-row">' +
        '<button class="ghost-btn" data-action="open-archive-folder">Open archive folder</button>' +
        '<button class="ghost-btn" data-action="export-archive">Export archive (zip)</button>' +
        '</div>' +
        '<p class="form-note">Documents are copied into a private archive on this tablet, in folders named by court, case and document type. Nothing is uploaded anywhere. If your papers already sit in many folders, use <strong>Scan whole tablet</strong> — Android will ask for one-time “All files access”, after which every PDF and Word document is found and filed.</p>' +
        '</section>' +

        /* ecourts */
        '<section class="card settings-card">' +
        '<p class="eyebrow">Sources</p><h2>e-Courts & Google Drive</h2>' +
        '<p class="desc">Import the case data your e-Courts app exports, straight from Drive.</p>' +
        '<div class="about-lines" style="margin-bottom:14px">' +
        '<div><b>1.</b> In the e-Courts app, export or share your case register as CSV (or keep its backup in Google Drive).</div>' +
        '<div><b>2.</b> Tap below, then choose <b>Google Drive</b> in the Android file picker and select the file.</div>' +
        '<div><b>3.</b> I merge the cases into the master register by CNR and case number, add future dates to the diary, and treat every imported matter exactly like a manual one.</div>' +
        '</div>' +
        '<div class="pill-row"><button class="primary-btn" data-action="import-ecourts">Import e-Courts data</button>' +
        '<button class="ghost-btn" data-action="import-drive">Import documents from Drive</button></div>' +
        '<p class="form-note">No Google password is ever requested. The Android system picker grants me access only to the file you choose, and only for this import.</p>' +
        '</section>' +

        /* data */
        '<section class="card settings-card">' +
        '<p class="eyebrow">Permanence</p><h2>Backup & data</h2>' +
        '<p class="desc">The chamber lives on this tablet. Keep a copy, by all means.</p>' +
        '<div class="pill-row" style="margin-bottom:16px">' +
        '<button class="primary-btn" data-action="export-backup">Export backup</button>' +
        '<button class="ghost-btn" data-action="restore-backup">Restore from backup</button>' +
        '</div>' +
        '<div class="toggle-row"><div class="tlabel"><strong>Sample chamber</strong><small>' + (sample ? sample + ' demonstration records are currently in the register.' : 'No demonstration records remain.') + '</small></div>' +
        '<button class="ghost-btn small" data-action="clear-samples" ' + (sample ? '' : 'disabled') + '>Clear samples</button></div>' +
        '<div class="toggle-row"><div class="tlabel"><strong>Erase all chamber data</strong><small>Matters, dates, tasks, reminders and the document index. Irreversible.</small></div>' +
        '<button class="danger-btn small" data-action="wipe-all">Erase</button></div>' +
        '</section>' +

        /* about */
        '<section class="card settings-card" style="grid-column:1/-1">' +
        '<p class="eyebrow">About</p><h2>Legal Jarvis</h2>' +
        '<div class="about-grid">' +
        '<div class="about-lines">' +
        '<div><b>Version</b> 1.0.0 · chamber edition</div>' +
        '<div><b>Platform</b> ' + esc(platform) + ' · Android 8.0 and above</div>' +
        '<div><b>Storage</b> ' + Repo.data.matters.length + ' matters · ' + Repo.data.documents.length + ' documents · ' + Repo.data.hearings.length + ' dates</div>' +
        '<div><b>Privacy</b> No account, no server, no analytics. Your papers never leave this device unless you share them yourself.</div>' +
        '<div><b>Recognition</b> Speech is recognised by the Android service on your tablet; the archive and the register stay local.</div>' +
        '</div>' +
        '<div class="about-lines">' +
        '<div><b>A note on the voice.</b> The Jarvis of the films is a fictional performance. This chamber uses the finest British English voice available on your tablet, with pitch and pace tuned to a calm, formal aide. For the closest resemblance, install the Google TTS British voice pack.</div>' +
        '<div><b>Commands to try.</b> “Brief me.” · “Next date in the Sharma case.” · “Pull up the latest reply in the Sharma matter.” · “What must I carry tomorrow?” · “Remind me to file the process fee on Monday.”</div>' +
        '<div class="tiny muted">Built for a working chamber in Jaipur. English and हिंदी.</div>' +
        '</div></div>' +
        '</section>' +

        '</div>';

      SetupUI.bind(el);
      SetupUI.loadVoices();
    },

    bind(el) {
      const profile = el.querySelector('#profileForm');
      if (profile) profile.addEventListener('submit', async e => {
        e.preventDefault();
        const lang = el.querySelector('#setLangMode');
        if (lang) S.set('langMode', lang.value);
        await App.saveProfile();
        App.applyLangUI();
        App.renderStage();
      });
      const brief = el.querySelector('#briefForm');
      if (brief) brief.addEventListener('submit', e => { e.preventDefault(); App.saveBriefSettings(); });
      const rate = el.querySelector('#setRate');
      if (rate) {
        rate.addEventListener('input', () => {
          const v = el.querySelector('#rateVal'); if (v) v.textContent = Number(rate.value).toFixed(2);
        });
      }
      const pitch = el.querySelector('#setPitch');
      if (pitch) {
        pitch.addEventListener('input', () => {
          const v = el.querySelector('#pitchVal'); if (v) v.textContent = Number(pitch.value).toFixed(2);
        });
      }
      el.querySelectorAll('.slider-row input[type="range"]').forEach(r => {
        r.addEventListener('change', () => {
          if (r.id === 'setRate') S.set('speechRate', Number(r.value));
          if (r.id === 'setPitch') S.set('speechPitch', Number(r.value));
        });
      });
    },

    async loadVoices() {
      const sel = document.getElementById('setVoice');
      if (!sel) return;
      const all = await Bridge.voices();
      if (!document.body.contains(sel)) return;
      sel.innerHTML = '<option value="">Auto — best British voice installed</option>' + all.map(v => {
        const label = v.name + (v.locale ? ' · ' + v.locale : '') + (v.local === false ? ' · network' : v.local === true ? ' · on-device' : '');
        return '<option value="' + esc(v.name) + '" ' + (S.get('voiceName') === v.name ? 'selected' : '') + '>' + esc(label) + '</option>';
      }).join('');
      const hint = document.getElementById('voiceHint');
      if (hint) {
        const gb = all.filter(v => /en[-_]GB|en-GB/i.test(v.locale || ''));
        const hi = all.filter(v => /^hi/i.test(v.locale || ''));
        hint.textContent = all.length
          ? (gb.length ? gb.length + ' British voice' + (gb.length === 1 ? '' : 's') + ' found' : 'No British voice found — install English (United Kingdom) in Android TTS settings') +
            ' · ' + (hi.length ? hi.length + ' Hindi voice' + (hi.length === 1 ? '' : 's') : 'no Hindi voice installed')
          : 'No native voices detected in this preview. On the tablet, the Android TTS voices will appear here.';
      }
    }
  };

  function field(label, input, hint) {
    return '<div class="setting-field"><label>' + esc(label) + '</label>' + input + (hint ? '<p class="hint">' + esc(hint) + '</p>' : '') + '</div>';
  }

  LJ.SetupUI = SetupUI;

  const origRun = App.run;
  App.run = function (action, p, el) {
    switch (action) {
      case 'remove-folder': {
        const folders = (S.get('folders') || []).filter(f => f.treeUri !== p.uri);
        S.set('folders', folders);
        SetupUI.render();
        App.toast('Folder unlinked.', 'ok');
        return;
      }
      case 'open-tts-settings':
        if (Bridge.available) Bridge.call('openTtsSettings', {}, 10000).catch(() => App.toast('Open Android Settings → System → Languages → Text-to-speech.', 'err'));
        else App.toast('Install the Google Text-to-Speech British voice pack in Android settings.', 'ok');
        return;
      case 'open-archive-folder':
        return Bridge.openArchiveFolder().catch(() => App.toast('Archive folder is available on the tablet.', 'err'));
    }
    return origRun.call(App, action, p, el);
  };
})();
