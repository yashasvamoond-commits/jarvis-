/* ============================================================
   Legal Jarvis — archive view, document viewer, linking
   ============================================================ */
(function () {
  'use strict';
  const U = LJ.Utils;
  const Repo = LJ.Repo;
  const I = LJ.I18N;
  const App = LJ.App;
  const Docs = LJ.Docs;
  const Bridge = LJ.Bridge;
  const S = LJ.Settings;

  const esc = U.esc;
  const TYPE_ORDER = ['Petition', 'Plaint', 'Written Statement', 'Reply', 'Rejoinder', 'Application', 'Affidavit', 'Evidence', 'Notice', 'Order', 'Judgment', 'Vakalatnama', 'Draft', 'Agreement', 'FIR', 'Other'];

  const DocsUI = {
    _preview: null,

    render() {
      const el = App.els.documentsBody;
      if (!el) return;
      const courts = U.unique(Repo.data.documents.map(d => d.court).filter(Boolean)).sort();
      const types = U.unique(Repo.data.documents.map(d => d.type).filter(Boolean));
      const cf = App.els.docCourtFilter, tf = App.els.docTypeFilter;
      if (cf) {
        const cur = App.state.docCourt;
        cf.innerHTML = '<option value="">All courts</option>' + courts.map(c => '<option value="' + esc(c) + '" ' + (cur === c ? 'selected' : '') + '>' + esc(shortCourt(c)) + '</option>').join('');
      }
      if (tf) {
        const cur = App.state.docType;
        const all = TYPE_ORDER.filter(t => types.includes(t)).concat(types.filter(t => !TYPE_ORDER.includes(t)));
        tf.innerHTML = '<option value="">All types</option>' + all.map(c => '<option value="' + esc(c) + '" ' + (cur === c ? 'selected' : '') + '>' + esc(c) + '</option>').join('');
      }
      const stats = Docs.stats();
      document.querySelectorAll('#docGroupToggle button').forEach(b => b.classList.toggle('is-active', b.dataset.group === App.state.docGroup));
      const note = App.els.docStorageNote;
      if (note) note.textContent = stats.total + ' documents · ' + stats.linked + ' linked · ' + stats.drafts + ' drafts' + (stats.unlinked ? ' · ' + stats.unlinked + ' unlinked' : '');

      let docs = Repo.data.documents.slice();
      if (App.state.docSearch) {
        docs = Docs.search(App.state.docSearch);
      }
      if (App.state.docCourt) docs = docs.filter(d => d.court === App.state.docCourt);
      if (App.state.docType) docs = docs.filter(d => d.type === App.state.docType);
      if (App.state.docQuick === 'unlinked') docs = docs.filter(d => !d.matterId);
      if (App.state.docQuick === 'drafts') docs = docs.filter(d => d.status === 'in-progress');

      let html = '';
      html += '<div class="doc-quick">' +
        quickChip('All papers', '', App.state.docQuick) +
        quickChip('Unlinked', 'unlinked', App.state.docQuick) +
        quickChip('Drafts', 'drafts', App.state.docQuick) +
        '<span class="toolbar-spacer"></span>' +
        '<span class="tiny muted">' + (App.state.docSearch ? docs.length + ' results for “' + esc(App.state.docSearch) + '”' : docs.length + ' papers shown') + '</span>' +
        '</div>';

      if (!docs.length) {
        el.innerHTML = html + '<div class="empty"><h3>' + (I.fullHindi() ? 'कोई दस्तावेज़ नहीं' : 'The archive is waiting') + '</h3><p>' +
          (Repo.data.documents.length ? 'No papers match this view, Sir.' : 'Import PDFs or Word files — or a whole folder — and I shall read and file them by court, case and type.') +
          '</p><div class="pill-row" style="justify-content:center"><button class="primary-btn" data-action="import-files">Import documents</button>' +
          '<button class="ghost-btn" data-action="import-folder">Import a folder</button></div></div>';
        return;
      }

      if (App.state.docGroup === 'case' && !App.state.docSearch) {
        const byCourt = {};
        docs.forEach(d => { const c = d.court || 'Unsorted'; (byCourt[c] = byCourt[c] || []).push(d); });
        Object.keys(byCourt).sort().forEach(court => {
          const cd = byCourt[court];
          const byCase = {};
          cd.forEach(d => { const k = d.matterId || ('x:' + (d.caseTitle || 'Unfiled')); (byCase[k] = byCase[k] || []).push(d); });
          html += '<details class="tree-court" open><summary class="tree-court-head"><span class="badge gold">Court</span><h3>' + esc(court) + '</h3><span class="count">' + cd.length + ' papers</span></summary>';
          Object.keys(byCase).sort((a, b) => {
            const da = byCase[a][0], db = byCase[b][0];
            return String(da.caseTitle || '').localeCompare(String(db.caseTitle || ''));
          }).forEach(key => {
            const group = byCase[key];
            const d0 = group[0];
            const m = d0.matterId ? Repo.matter(d0.matterId) : null;
            const byType = {};
            group.forEach(d => { (byType[d.type || 'Other'] = byType[d.type || 'Other'] || []).push(d); });
            html += '<details class="tree-case" open><summary class="tree-case-head"><span class="chev">›</span><strong>' + esc(m ? m.title : (d0.caseTitle || 'Unfiled papers')) + '</strong>' +
              '<small>' + esc(m ? (m.client || '') : (d0.client || '')) + ' · ' + group.length + '</small></summary><div class="tree-docs">';
            TYPE_ORDER.filter(t => byType[t]).concat(Object.keys(byType).filter(t => !TYPE_ORDER.includes(t))).forEach(type => {
              html += '<div class="doc-group-label">' + esc(type) + '</div>';
              byType[type].sort((a, b) => String(Docs.docAge(b)).localeCompare(String(Docs.docAge(a)))).forEach(d => { html += docRow(d, true); });
            });
            html += '</div></details>';
          });
          html += '</details>';
        });
      } else if (App.state.docGroup === 'court' && !App.state.docSearch) {
        const byCourt = {};
        docs.forEach(d => { const c = d.court || 'Unsorted'; (byCourt[c] = byCourt[c] || []).push(d); });
        Object.keys(byCourt).sort().forEach(court => {
          html += '<div class="tree-court"><div class="tree-court-head"><span class="badge gold">Court</span><h3>' + esc(court) + '</h3><span class="count">' + byCourt[court].length + ' papers</span></div><div style="padding:6px 10px 10px">';
          byCourt[court].sort((a, b) => String(Docs.docAge(b)).localeCompare(String(Docs.docAge(a)))).forEach(d => { html += docRow(d); });
          html += '</div></div>';
        });
      } else {
        html += '<div class="card" style="padding:8px 14px">';
        U.sortBy(docs, d => (Docs.docAge(d) + ' ' + (d.addedAt || '')), -1).forEach(d => { html += docRow(d); });
        html += '</div>';
      }
      el.innerHTML = html;
    },

    open(id) {
      const d = Repo.document(id);
      if (!d) { App.toast('That document is no longer in the archive.', 'err'); return; }
      const m = d.matterId ? Repo.matter(d.matterId) : null;
      const sheet = App.openSheet({
        eyebrow: (d.type || 'Document') + (d.status === 'in-progress' ? ' · draft' : d.status === 'filed' ? ' · filed' : ''),
        title: d.name,
        sub: [d.court, m ? m.title : (d.caseTitle || 'Unlinked'), I.date(Docs.docAge(d), { weekday: false })].filter(Boolean).join(' · '),
        wide: true,
        body:
          '<div class="viewer-body">' +
          '<div class="viewer-toolbar" id="pvToolbar">' +
          '<span>' + esc(d.ext ? d.ext.toUpperCase() : 'FILE') + ' · ' + esc(U.bytes(d.size)) + '</span>' +
          '<span class="spacer"></span>' +
          '<button class="ghost-btn small" data-action="open-external" data-id="' + esc(d.id) + '">Open in another app</button>' +
          '<button class="ghost-btn small" data-action="share-doc" data-id="' + esc(d.id) + '">Share</button>' +
          '</div>' +
          '<div id="pvWrap" class="viewer-canvas"><div class="no-preview">Preparing the paper, Sir…</div></div>' +
          '</div>' +
          '<div class="tag-row" style="margin-top:14px">' +
          (d.type ? '<span class="badge gold">' + esc(d.type) + '</span>' : '') +
          (d.hiContent || I.isHindiText(d.name) ? '<span class="badge hi gold">हिंदी</span>' : '') +
          (m ? '<span class="badge cyan">' + esc(m.title) + '</span>' : '<span class="badge red">Unlinked</span>') +
          '<span class="badge">' + esc(d.source === 'sample' ? 'Sample' : d.source === 'shared' ? 'Shared to Jarvis' : 'Imported') + '</span>' +
          '</div>' +
          '<details class="doc-text" style="margin-top:12px"><summary>Extracted text — what I can search</summary><div class="text-view">' + esc((d.text || 'No text could be read from this file. The filename and its folder still make it searchable.').slice(0, 12000)) + '</div></details>',
        foot:
          '<div class="left">' +
          '<button class="ghost-btn" data-action="link-doc" data-id="' + esc(d.id) + '">Link to matter</button>' +
          '<button class="ghost-btn" data-action="delete-doc" data-id="' + esc(d.id) + '">Remove</button>' +
          '</div>' +
          (m ? '<button class="ghost-btn" data-action="open-matter" data-id="' + esc(m.id) + '">Open matter</button>' : '') +
          '<button class="primary-btn" data-action="close-sheet">Done</button>'
      });
      DocsUI._preview = { id, page: 1, pages: d.pages || 1 };
      DocsUI.loadPreview(sheet.root, d);
      return sheet;
    },

    async loadPreview(root, d) {
      const wrap = root.querySelector('#pvWrap');
      if (!wrap) return;
      const fail = msg => { wrap.innerHTML = '<div class="no-preview">' + esc(msg) + '<div class="pill-row" style="justify-content:center;margin-top:14px"><button class="primary-btn" data-action="open-external" data-id="' + esc(d.id) + '">Open in another app</button></div></div>'; };
      try {
        if (d.ext === 'pdf') {
          await DocsUI.loadPdf(root, d, DocsUI._preview.page);
        } else if (d.ext === 'docx' && d.blob) {
          if (window.mammoth) {
            const buf = await Docs.readBlob(d.blob);
            const r = await window.mammoth.convertToHtml({ arrayBuffer: buf });
            wrap.className = 'docx-view';
            wrap.innerHTML = r.value || '<p>Empty document.</p>';
          } else {
            wrap.className = 'text-view';
            wrap.textContent = d.text || 'Preview unavailable.';
          }
        } else if (d.ext === 'doc') {
          wrap.className = 'text-view';
          wrap.textContent = d.text || 'This legacy Word file could not be read. Open it in another app.';
        } else if (/^(png|jpe?g|webp)$/.test(d.ext || '')) {
          let url = null;
          if (d.blob) url = URL.createObjectURL(d.blob);
          else if (Bridge.available && d.relPath) {
            const b64 = await Bridge.readFileBase64(d);
            if (b64) url = 'data:image/' + (d.ext === 'jpg' ? 'jpeg' : d.ext) + ';base64,' + b64;
          }
          if (url) wrap.innerHTML = '<img src="' + url + '" alt="" style="max-width:100%;border-radius:4px">';
          else fail('The image could not be loaded.');
        } else {
          wrap.className = 'text-view';
          wrap.textContent = d.text || 'No preview is available for this format.';
        }
      } catch (e) {
        console.warn('preview error', e);
        fail('I could not render this paper in the chamber. You may open it in another app.');
      }
    },

    async loadPdf(root, d, page) {
      const wrap = root.querySelector('#pvWrap');
      if (!wrap) return;
      wrap.className = 'viewer-canvas';
      DocsUI._preview.page = page;
      if (Bridge.available && d.relPath) {
        wrap.innerHTML = '<div class="no-preview">Turning to page ' + page + '…</div>';
        const url = await Bridge.renderPdf(d, page, 1200);
        if (url) {
          wrap.innerHTML = '<img src="' + url + '" alt="" style="max-width:100%;height:auto;box-shadow:0 10px 40px rgba(0,0,0,.5);background:#fff;border-radius:2px">' +
            DocsUI.pageNav(page, DocsUI._preview.pages, d.id);
        } else {
          wrap.innerHTML = '<div class="no-preview">This PDF could not be rendered, Sir. <div class="pill-row" style="justify-content:center;margin-top:12px"><button class="primary-btn" data-action="open-external" data-id="' + esc(d.id) + '">Open in another app</button></div></div>';
        }
        return;
      }
      if (!d.blob) {
        wrap.innerHTML = '<div class="no-preview">The original file is not available on this tablet. The indexed text remains searchable below.</div>';
        return;
      }
      if (!window.pdfjsLib) {
        wrap.innerHTML = '<div class="no-preview">The PDF reader is unavailable.</div>';
        return;
      }
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
        const buf = await Docs.readBlob(d.blob);
        const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
        DocsUI._preview.pages = pdf.numPages;
        const p = await pdf.getPage(Math.min(page, pdf.numPages));
        const vp = p.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        const ctx = canvas.getContext('2d');
        await p.render({ canvasContext: ctx, viewport: vp }).promise;
        wrap.innerHTML = '';
        wrap.appendChild(canvas);
        wrap.insertAdjacentHTML('beforeend', DocsUI.pageNav(page, pdf.numPages, d.id));
      } catch (e) {
        console.warn(e);
        wrap.innerHTML = '<div class="no-preview">This PDF could not be rendered here.</div>';
      }
    },

    pageNav(page, pages, id) {
      return '<div class="pdf-nav"><button class="ghost-btn small" data-action="pdf-prev" data-id="' + esc(id) + '" ' + (page <= 1 ? 'disabled' : '') + '>‹</button>' +
        '<span class="tiny muted">Page ' + page + ' of ' + pages + '</span>' +
        '<button class="ghost-btn small" data-action="pdf-next" data-id="' + esc(id) + '" ' + (page >= pages ? 'disabled' : '') + '>›</button></div>';
    },

    async openExternal(id) {
      const d = Repo.document(id);
      if (!d) return;
      try {
        if (Bridge.available && d.relPath) { await Bridge.openFile(d); return; }
        if (d.blob) {
          const url = URL.createObjectURL(d.blob);
          window.open(url, '_blank');
          setTimeout(() => URL.revokeObjectURL(url), 30000);
          return;
        }
        App.toast('The original file is not available, Sir.', 'err');
      } catch (e) {
        App.toast('No other app accepted this file.', 'err');
      }
    },

    async share(id) {
      const d = Repo.document(id);
      if (!d) return;
      try { await Bridge.shareFile(d); }
      catch (e) { App.toast('Sharing is not available for this paper.', 'err'); }
    },

    confirmDelete(id) {
      const d = Repo.document(id);
      if (!d) return;
      App.openSheet({
        eyebrow: 'Confirm', title: 'Remove this paper from the archive?',
        sub: d.name, narrow: true,
        body: '<p class="form-note" style="margin-top:0">The archived copy on this tablet will be deleted. ' + (d.status === 'in-progress' ? 'This draft is still marked in progress.' : 'The original source file, if any, is untouched.') + '</p>',
        foot: '<button class="ghost-btn" data-action="close-sheet">Keep it</button>' +
          '<button class="danger-btn" data-action="do-delete-doc" data-id="' + esc(d.id) + '">Remove</button>'
      });
    },

    async doDelete(id) {
      const d = Repo.document(id);
      if (!d) return;
      try { await Bridge.deleteArchiveFile(d); } catch (e) {}
      await Repo.deleteDocument(id);
      App.closeTopSheet();
      App.closeSheet(DocsUI._previewSheet && DocsUI._previewSheet.root, true);
      App.renderAll();
      App.toast('Removed from the archive.', 'ok');
    },

    openLinkDialog(id) {
      const d = Repo.document(id);
      if (!d) return;
      const matters = Repo.data.matters.slice().sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      if (!matters.length) { App.toast('The register is empty. Add a matter first.', 'err'); return; }
      App.openSheet({
        eyebrow: 'Link paper', title: 'File this paper with a matter',
        sub: d.name, narrow: true,
        body: '<div class="form-grid"><div class="field full"><label>Matter</label><select class="input" id="linkMatter">' +
          matters.map(m => '<option value="' + esc(m.id) + '" ' + (d.matterId === m.id ? 'selected' : '') + '>' + esc(m.title) + '</option>').join('') +
          '</select></div></div><p class="form-note">The paper will move into the case folder and inherit its court, client and case title.</p>',
        foot: '<button class="ghost-btn" data-action="close-sheet">Cancel</button>' +
          '<button class="primary-btn" data-action="do-link-doc" data-id="' + esc(d.id) + '">Link paper</button>'
      });
    },

    async link(id, el) {
      const root = el && el.closest('.modal-root');
      const sel = root && root.querySelector('#linkMatter');
      if (!sel) return;
      const d = await Docs.linkToMatter(id, sel.value);
      App.closeTopSheet();
      App.renderAll();
      if (d) App.toast('Filed under ' + (Repo.matter(d.matterId) || {}).title + '.', 'ok');
    },

    quickFilter(kind) {
      App.state.docQuick = kind;
      DocsUI.render();
    }
  };

  function quickChip(label, kind, current) {
    return '<button class="chip' + (current === kind ? ' is-active' : '') + '" data-action="doc-quick" data-kind="' + esc(kind) + '">' + esc(label) + '</button>';
  }

  function docRow(d, inTree) {
    const m = d.matterId ? Repo.matter(d.matterId) : null;
    const draft = d.status === 'in-progress';
    return '<div class="doc-row">' +
      '<span class="ext ' + esc((d.ext || '').toLowerCase()) + '">' + esc((d.ext || 'doc').toUpperCase()) + '</span>' +
      '<button class="doc-name" data-action="open-doc" data-id="' + esc(d.id) + '">' +
      '<strong>' + esc(d.name) + (d.nameHi && d.nameHi !== d.name ? ' <span class="badge hi">' + esc(d.nameHi) + '</span>' : '') + '</strong>' +
      '<small>' + esc(d.type || 'Document') + ' · ' + esc(I.shortDate(Docs.docAge(d))) + (inTree ? '' : ' · ' + esc(d.court || 'Unsorted')) + (d.status === 'filed' ? ' · filed' : draft ? ' · <span style="color:var(--warn)">draft</span>' : '') + (m ? ' · ' + esc(m.title) : ' · <span style="color:var(--muted-2)">unlinked</span>') + '</small></button>' +
      '<div class="doc-tags">' + (d.hiContent || I.isHindiText(d.name) ? '<span class="badge hi">हिं</span>' : '') + (draft ? '<span class="badge gold">Draft</span>' : '') + '</div>' +
      '<div class="doc-menu">' +
      '<button data-action="open-doc" data-id="' + esc(d.id) + '" title="Open">↗</button>' +
      '<button data-action="link-doc" data-id="' + esc(d.id) + '" title="Link to matter">⇄</button>' +
      '<button data-action="share-doc" data-id="' + esc(d.id) + '" title="Share">⤴</button>' +
      '<button data-action="delete-doc" data-id="' + esc(d.id) + '" title="Remove">🗑</button>' +
      '</div></div>';
  }

  function shortCourt(c) {
    return String(c).replace('Rajasthan High Court, Jaipur Bench', 'High Court, Jaipur').replace('District & Sessions Court, Jaipur Metropolitan', 'District & Sessions, Jaipur').slice(0, 44);
  }

  App.openDocSheet = id => DocsUI.open(id);

  const origRun = App.run;
  App.run = function (action, p, el) {
    switch (action) {
      case 'do-delete-doc': return DocsUI.doDelete(p.id);
      case 'do-link-doc': return DocsUI.link(p.id, el);
      case 'open-external': return DocsUI.openExternal(p.id);
      case 'pdf-prev': {
        const st = DocsUI._preview;
        if (st && st.page > 1) {
          const d = Repo.document(st.id);
          const root = el.closest('.modal-root');
          if (d && root) DocsUI.loadPdf(root, d, st.page - 1);
        }
        return;
      }
      case 'pdf-next': {
        const st = DocsUI._preview;
        if (st && st.page < st.pages) {
          const d = Repo.document(st.id);
          const root = el.closest('.modal-root');
          if (d && root) DocsUI.loadPdf(root, d, st.page + 1);
        }
        return;
      }
      case 'doc-quick': return DocsUI.quickFilter(p.kind || '');
    }
    return origRun.call(App, action, p, el);
  };

  LJ.DocsUI = DocsUI;
})();
