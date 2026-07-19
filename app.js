(() => {
  'use strict';

  // ============ 状态 ============
  let files = [];        // [{path, sha}]
  let vaultVersion = null;
  let currentPath = null;
  let linkIndex = {};    // { notePath: [outgoingNotePath, ...] }，持久化到 localStorage

  // ============ DOM ============
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const docTitle = $('doc-title');
  const noteContent = $('note-content');
  const fileTreeEl = $('file-tree');
  const searchInput = $('search-input');
  const sidebarStatus = $('sidebar-status');
  const syncStatusEl = $('sync-status');
  const offlineBadge = $('offline-badge');
  const syncBtn = $('btn-sync-all');

  // ============ 设置（本地存储） ============
  const DEFAULT_SETTINGS = { theme: 'paper', fontSize: 17, width: 640 };
  function loadSettings() {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('viewerSettings') || '{}') }; }
    catch { return { ...DEFAULT_SETTINGS }; }
  }
  function saveSettings(s) { localStorage.setItem('viewerSettings', JSON.stringify(s)); }
  let settings = loadSettings();

  function applySettings() {
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.documentElement.style.setProperty('--font-size', settings.fontSize + 'px');
    document.documentElement.style.setProperty('--content-width', settings.width + 'px');
    $('font-size-range').value = settings.fontSize;
    $('font-size-value').textContent = settings.fontSize + 'px';
    $('width-range').value = settings.width;
    $('width-value').textContent = settings.width + 'px';
    document.querySelectorAll('.swatch').forEach(b => b.classList.toggle('active', b.dataset.theme === settings.theme));
  }
  $('font-size-range').addEventListener('input', (e) => { settings.fontSize = Number(e.target.value); applySettings(); saveSettings(settings); });
  $('width-range').addEventListener('input', (e) => { settings.width = Number(e.target.value); applySettings(); saveSettings(settings); });
  document.querySelectorAll('.swatch').forEach(btn => {
    btn.addEventListener('click', () => { settings.theme = btn.dataset.theme; applySettings(); saveSettings(settings); });
  });

  // ============ 顶部/侧边栏交互 ============
  $('btn-menu').addEventListener('click', () => body.classList.toggle('sidebar-open'));
  $('sidebar-backdrop').addEventListener('click', () => body.classList.remove('sidebar-open'));
  $('btn-settings').addEventListener('click', () => body.classList.toggle('settings-open'));
  $('btn-close-settings').addEventListener('click', () => body.classList.remove('settings-open'));
  $('btn-refresh').addEventListener('click', () => loadVault(true));

  function closeSidebarIfMobile() { if (window.innerWidth < 860) body.classList.remove('sidebar-open'); }

  // ============ 在线/离线状态 ============
  function updateOnlineBadge() {
    offlineBadge.classList.toggle('show', !navigator.onLine);
    if (currentPath) syncBtn.disabled = !navigator.onLine;
  }
  window.addEventListener('online', updateOnlineBadge);
  window.addEventListener('offline', updateOnlineBadge);

  // ============ Service Worker（离线支持） ============
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // ============ "仓库"分组：以笔记所在的顶层文件夹为单位 ============
  // 例如 "八字紫薇/01-基础概念/xxx.md" -> 分组是 "八字紫薇"
  // 根目录下的散落笔记（比如 HOME.md）各自成组，用 '__root__' 作为存储 key
  function folderOf(path) {
    const idx = path.indexOf('/');
    return idx === -1 ? '' : path.slice(0, idx);
  }
  function groupKeyOf(path) { return folderOf(path) || '__root__'; }
  function groupLabelOf(path) { return folderOf(path) || '根目录笔记'; }
  function groupFilesOf(path) {
    const folder = folderOf(path);
    return files.filter(f => f.path.endsWith('.md') && folderOf(f.path) === folder);
  }

  function folderSyncKey(groupKey) { return 'ov_folderSync_' + groupKey; }
  function getFolderSync(groupKey) {
    try { return JSON.parse(localStorage.getItem(folderSyncKey(groupKey)) || 'null'); } catch { return null; }
  }
  function setFolderSync(groupKey) {
    localStorage.setItem(folderSyncKey(groupKey), JSON.stringify({ version: vaultVersion, time: Date.now() }));
  }
  function isFolderCached(folderName) {
    const s = getFolderSync(folderName || '__root__');
    return !!(s && s.version === vaultVersion);
  }

  // ============ 加载文件树 ============
  async function loadVault(force) {
    sidebarStatus.textContent = '加载中…';
    try {
      const res = await fetch('/api/tree' + (force ? ('?t=' + Date.now()) : ''));
      const data = await res.json();
      if (data.error) { sidebarStatus.textContent = '错误：' + data.error; return; }
      files = data.files;
      vaultVersion = data.version;
      linkIndex = loadIndex();
      cleanupOldIndexes();
      renderTree();
      sidebarStatus.textContent = files.filter(f => f.path.endsWith('.md')).length + ' 篇笔记';
      updateGroupStatusDisplay();
    } catch (err) {
      sidebarStatus.textContent = '加载失败（可能离线，尝试使用已缓存内容）';
    }
  }

  // ============ 链接索引持久化 ============
  function indexKey() { return 'ov_linkIndex_' + vaultVersion; }
  function loadIndex() {
    try { return JSON.parse(localStorage.getItem(indexKey()) || '{}'); } catch { return {}; }
  }
  function saveIndex() {
    try { localStorage.setItem(indexKey(), JSON.stringify(linkIndex)); } catch { /* 配额不足，忽略 */ }
  }
  function cleanupOldIndexes() {
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith('ov_linkIndex_') && k !== indexKey()) localStorage.removeItem(k);
    });
  }

  // 当前笔记所在"仓库"（顶层文件夹）的缓存状态，显示在侧边栏底部按钮下方
  function updateGroupStatusDisplay() {
    if (!currentPath) {
      syncBtn.disabled = true;
      syncBtn.textContent = '缓存当前仓库（离线阅读）';
      syncStatusEl.textContent = '';
      return;
    }
    const label = groupLabelOf(currentPath);
    syncBtn.disabled = !navigator.onLine;
    syncBtn.textContent = `缓存「${label}」（离线阅读）`;
    const s = getFolderSync(groupKeyOf(currentPath));
    if (!s) { syncStatusEl.textContent = `「${label}」尚未离线缓存`; return; }
    const fresh = s.version === vaultVersion;
    syncStatusEl.textContent = (fresh ? '✓ ' : '⚠ 有更新，建议重新缓存 · ') + `上次缓存 ${new Date(s.time).toLocaleString('zh-CN', { hour12: false })}`;
  }

  // ============ 侧边栏文件树渲染 ============
  function buildTreeStructure(paths) {
    const root = {};
    paths.forEach((f) => {
      const parts = f.path.split('/');
      let node = root;
      parts.forEach((part, i) => {
        if (i === parts.length - 1) { node.__files = node.__files || []; node.__files.push({ name: part, path: f.path }); }
        else { node[part] = node[part] || {}; node = node[part]; }
      });
    });
    return root;
  }

  function renderTreeNode(node, container, depth) {
    const folders = Object.keys(node).filter(k => k !== '__files').sort((a, b) => a.localeCompare(b, 'zh'));
    folders.forEach((folder) => {
      const details = document.createElement('details');
      details.open = depth < 1;
      const summary = document.createElement('summary');
      summary.textContent = folder;
      if (depth === 0) {
        const tag = document.createElement('span');
        tag.className = 'folder-cached-tag';
        tag.textContent = '（已缓存）';
        tag.style.display = isFolderCached(folder) ? 'inline' : 'none';
        tag.dataset.folder = folder;
        summary.appendChild(tag);
      }
      details.appendChild(summary);
      renderTreeNode(node[folder], details, depth + 1);
      container.appendChild(details);
    });
    if (node.__files) {
      node.__files.filter(f => f.name.endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name, 'zh')).forEach((f) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.textContent = f.name.replace(/\.md$/, '');
        item.dataset.path = f.path;
        item.addEventListener('click', () => { openNote(f.path); closeSidebarIfMobile(); });
        container.appendChild(item);
      });
    }
  }

  function renderTree() {
    fileTreeEl.innerHTML = '';
    const tree = buildTreeStructure(files.filter(f => f.path.endsWith('.md')));
    renderTreeNode(tree, fileTreeEl, 0);
  }

  function refreshFolderCachedTags() {
    document.querySelectorAll('.folder-cached-tag').forEach((tag) => {
      tag.style.display = isFolderCached(tag.dataset.folder) ? 'inline' : 'none';
    });
  }

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    fileTreeEl.innerHTML = '';
    if (!q) { renderTree(); return; }
    files.filter(f => f.path.endsWith('.md') && f.path.toLowerCase().includes(q))
      .sort((a, b) => a.path.localeCompare(b.path, 'zh'))
      .forEach((f) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.textContent = f.path.replace(/\.md$/, '');
        item.dataset.path = f.path;
        item.addEventListener('click', () => { openNote(f.path); closeSidebarIfMobile(); });
        fileTreeEl.appendChild(item);
      });
  });

  // ============ 链接解析工具 ============
  function findFileByLinkTarget(rawTarget) {
    let t = (rawTarget || '').trim();
    if (!t) return null;
    const hasExt = /\.[a-zA-Z0-9]{2,5}$/.test(t);
    const tryPaths = hasExt ? [t] : [t + '.md', t];
    for (const tp of tryPaths) {
      const exact = files.find(f => f.path.toLowerCase() === tp.toLowerCase());
      if (exact) return exact.path;
    }
    const baseTarget = (hasExt ? t : t + '.md').split('/').pop().toLowerCase();
    const baseMatch = files.find(f => f.path.split('/').pop().toLowerCase() === baseTarget);
    return baseMatch ? baseMatch.path : null;
  }
  function isImagePath(p) { return /\.(png|jpe?g|gif|svg|webp)$/i.test(p); }

  // 提取一篇笔记的出链笔记 + 引用的图片（用于索引 / 离线缓存，不做渲染）
  function extractLinks(rawMd) {
    const outgoing = new Set();
    const images = new Set();
    [...rawMd.matchAll(/(!)?\[\[([^\]]+)\]\]/g)].forEach(([, , inner]) => {
      const target = inner.split('|')[0].split('#')[0].trim();
      const resolved = findFileByLinkTarget(target);
      if (!resolved) return;
      if (isImagePath(resolved)) images.add(resolved); else if (resolved.endsWith('.md')) outgoing.add(resolved);
    });
    [...rawMd.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].forEach(([, p]) => {
      if (/^https?:\/\//.test(p)) return;
      const resolved = findFileByLinkTarget(decodeURIComponent(p.split('/').pop()));
      if (resolved && isImagePath(resolved)) images.add(resolved);
    });
    return { outgoing: [...outgoing], images: [...images] };
  }

  // 将 Obsidian 双链转换为可点击的标准 Markdown（渲染专用）
  function transformWikilinks(md) {
    return md.replace(/(!)?\[\[([^\]]+)\]\]/g, (match, bang, inner) => {
      const isEmbed = !!bang;
      let [targetPart, alias] = inner.split('|');
      targetPart = targetPart.trim();
      const cleanTarget = targetPart.split('#')[0].trim();
      const label = (alias || targetPart.split('#').pop() || cleanTarget.split('/').pop()).trim();
      const resolved = findFileByLinkTarget(cleanTarget);
      if (isEmbed && resolved && isImagePath(resolved)) return `![${label}](/api/file?path=${encodeURIComponent(resolved)})`;
      if (resolved) return `[${label}](#wikilink:${encodeURIComponent(resolved)})`;
      return `<span class="broken-link" title="未找到笔记：${escapeHtml(cleanTarget)}">${escapeHtml(label)}</span>`;
    });
  }
  function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function stripFrontmatter(md) {
    const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!m) return { body: md, title: null };
    const titleMatch = m[1].match(/^title:\s*(.+)$/m);
    return { body: md.slice(m[0].length), title: titleMatch ? titleMatch[1].trim().replace(/^["']|["']$/g, '') : null };
  }

  // ============ 打开笔记 ============
  async function openNote(path) {
    noteContent.innerHTML = '<p class="muted">加载中…</p>';
    docTitle.textContent = path.split('/').pop().replace(/\.md$/, '');
    currentPath = path;
    highlightActiveFile(path);
    updateGroupStatusDisplay();

    try {
      const res = await fetch('/api/file?path=' + encodeURIComponent(path));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const raw = await res.text();
      const { body: mdBody, title } = stripFrontmatter(raw);
      if (title) docTitle.textContent = title;

      // 顺带更新链接索引（供关系图谱使用）
      linkIndex[path] = extractLinks(raw).outgoing;
      saveIndex();

      noteContent.innerHTML = marked.parse(transformWikilinks(mdBody), { breaks: true });

      noteContent.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') || '';
        if (!src || src.startsWith('http') || src.startsWith('/api/file')) return;
        const resolved = resolveRelative(path, decodeURIComponent(src));
        if (resolved) img.src = '/api/file?path=' + encodeURIComponent(resolved);
      });

      window.scrollTo(0, 0);
      $('reader').scrollTop = 0;
      history.replaceState(null, '', '#' + encodeURIComponent(path));
    } catch (err) {
      noteContent.innerHTML = `<p class="muted">加载失败：${escapeHtml(String(err))}（可能离线且该笔记尚未缓存）</p>`;
    }
  }

  function resolveRelative(currentNotePath, relPath) {
    if (relPath.startsWith('/')) return findFileByLinkTarget(relPath.slice(1));
    const dir = currentNotePath.split('/').slice(0, -1);
    relPath.split('/').forEach(p => { if (p === '..') dir.pop(); else if (p !== '.') dir.push(p); });
    const joined = dir.join('/');
    const exact = files.find(f => f.path === joined);
    return exact ? exact.path : findFileByLinkTarget(relPath.split('/').pop());
  }

  function highlightActiveFile(path) {
    document.querySelectorAll('.file-item').forEach(el => el.classList.toggle('active', el.dataset.path === path));
  }

  noteContent.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#wikilink:')) { e.preventDefault(); openNote(decodeURIComponent(href.replace('#wikilink:', ''))); }
    else if (/^https?:\/\//.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
    else if (href.endsWith('.md') || href.includes('.md#')) {
      e.preventDefault();
      const resolved = resolveRelative(currentPath || '', decodeURIComponent(href.split('#')[0]));
      if (resolved) openNote(resolved);
    }
  });

  // ============ 建立/补全链接索引（图谱 & 离线缓存共用，按传入的文件列表操作） ============
  async function buildIndexFor(fileList, { fetchImages = false, onProgress } = {}) {
    const allImages = new Set();
    let done = 0, idx = 0;
    const concurrency = 6;

    async function worker() {
      while (idx < fileList.length) {
        const i = idx++;
        const f = fileList[i];
        try {
          const res = await fetch('/api/file?path=' + encodeURIComponent(f.path));
          const text = await res.text();
          const { outgoing, images } = extractLinks(text);
          linkIndex[f.path] = outgoing;
          if (fetchImages) images.forEach(im => allImages.add(im));
        } catch { /* 单篇失败忽略，继续 */ }
        done++;
        if (onProgress) onProgress(done, fileList.length, 'notes');
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    saveIndex();

    if (fetchImages && allImages.size) {
      const imgArr = [...allImages];
      let imgDone = 0, idx2 = 0;
      async function imgWorker() {
        while (idx2 < imgArr.length) {
          const i = idx2++;
          try { await fetch('/api/file?path=' + encodeURIComponent(imgArr[i])); } catch { /* 忽略 */ }
          imgDone++;
          if (onProgress) onProgress(imgDone, imgArr.length, 'images');
        }
      }
      await Promise.all(Array.from({ length: 4 }, imgWorker));
    }
  }

  // ============ 缓存当前仓库（当前笔记所在顶层文件夹，离线阅读） ============
  syncBtn.addEventListener('click', syncCurrentGroup);
  async function syncCurrentGroup() {
    if (!currentPath || !navigator.onLine) return;
    const groupKey = groupKeyOf(currentPath);
    const groupFiles = groupFilesOf(currentPath);
    syncBtn.disabled = true;
    await buildIndexFor(groupFiles, {
      fetchImages: true,
      onProgress: (done, total, phase) => {
        syncStatusEl.textContent = phase === 'notes' ? `缓存笔记中… ${done}/${total}` : `缓存图片中… ${done}/${total}`;
      },
    });
    setFolderSync(groupKey);
    syncBtn.disabled = !navigator.onLine;
    updateGroupStatusDisplay();
    refreshFolderCachedTags();
  }

  // ============ 关系图谱（当前笔记所在的顶层文件夹 = "仓库"） ============
  let simulation = null;
  let zoomBehavior = null, svgSel = null, gSel = null;

  $('btn-graph').addEventListener('click', openGraph);
  $('btn-close-graph').addEventListener('click', () => body.classList.remove('graph-open'));

  async function openGraph() {
    body.classList.add('graph-open');
    if (!currentPath) {
      $('graph-empty').style.display = 'flex';
      $('graph-svg').style.display = 'none';
      $('graph-status').textContent = '';
      return;
    }
    $('graph-empty').style.display = 'none';
    $('graph-svg').style.display = 'block';

    const groupFiles = groupFilesOf(currentPath);
    const missing = groupFiles.filter(f => !linkIndex[f.path]);
    if (missing.length) {
      $('graph-status').textContent = '正在建立关系索引…';
      await buildIndexFor(missing, {
        fetchImages: false,
        onProgress: (done, total) => { $('graph-status').textContent = `正在建立关系索引… ${done}/${total}`; },
      });
    }
    renderFolderGraph(groupFiles, groupLabelOf(currentPath));
  }

  function renderFolderGraph(groupFiles, groupLabel) {
    const groupPathSet = new Set(groupFiles.map(f => f.path));
    const nodes = groupFiles.map(f => ({ id: f.path, name: f.path.split('/').pop().replace(/\.md$/, '') }));
    const edgeKeys = new Set();
    const edges = [];
    groupFiles.forEach((f) => {
      (linkIndex[f.path] || []).forEach((t) => {
        if (t === f.path || !groupPathSet.has(t)) return; // 只保留同一仓库内部的关系
        const key = f.path + '=>' + t;
        if (!edgeKeys.has(key)) { edgeKeys.add(key); edges.push({ source: f.path, target: t }); }
      });
    });
    $('graph-status').textContent = `${groupLabel} · ${nodes.length} 篇笔记 · ${edges.length} 条链接`;

    const svgEl = $('graph-svg');
    const width = svgEl.clientWidth || window.innerWidth;
    const height = svgEl.clientHeight || (window.innerHeight - 52);

    svgSel = d3.select(svgEl);
    svgSel.selectAll('*').remove();
    svgSel.attr('viewBox', [0, 0, width, height]);
    gSel = svgSel.append('g');

    zoomBehavior = d3.zoom().scaleExtent([0.15, 6]).on('zoom', (event) => gSel.attr('transform', event.transform));
    svgSel.call(zoomBehavior);

    const linkSel = gSel.append('g').selectAll('line').data(edges).join('line').attr('class', 'link');
    const nodeSel = gSel.append('g').selectAll('circle').data(nodes).join('circle').attr('class', 'node').attr('r', 5.5).call(dragBehavior());
    const labelSel = gSel.append('g').selectAll('text').data(nodes).join('text').attr('class', 'node-label').text(d => d.name).attr('dx', 8).attr('dy', 3);

    nodeSel.on('click', (event, d) => { event.stopPropagation(); selectNode(d.id, nodeSel, linkSel, labelSel, edges); });
    svgSel.on('click', () => clearSelection(nodeSel, linkSel, labelSel));

    simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id(d => d.id).distance(55).strength(0.5))
      .force('charge', d3.forceManyBody().strength(-130))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(20))
      .on('tick', () => {
        linkSel.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        nodeSel.attr('cx', d => d.x).attr('cy', d => d.y);
        labelSel.attr('x', d => d.x).attr('y', d => d.y);
      });
  }

  function dragBehavior() {
    function started(event) { if (!event.active) simulation.alphaTarget(0.25).restart(); event.subject.fx = event.subject.x; event.subject.fy = event.subject.y; }
    function dragged(event) { event.subject.fx = event.x; event.subject.fy = event.y; }
    function ended(event) { if (!event.active) simulation.alphaTarget(0); event.subject.fx = null; event.subject.fy = null; }
    return d3.drag().on('start', started).on('drag', dragged).on('end', ended);
  }

  let selectedNodeId = null;
  function selectNode(id, nodeSel, linkSel, labelSel, edges) {
    selectedNodeId = id;
    const neighborIds = new Set([id]);
    edges.forEach((e) => {
      const s = e.source.id || e.source, t = e.target.id || e.target;
      if (s === id) neighborIds.add(t);
      if (t === id) neighborIds.add(s);
    });
    nodeSel.classed('dim', d => !neighborIds.has(d.id)).classed('selected', d => d.id === id);
    labelSel.classed('dim', d => !neighborIds.has(d.id));
    linkSel.classed('dim', e => (e.source.id || e.source) !== id && (e.target.id || e.target) !== id)
      .classed('highlight', e => (e.source.id || e.source) === id || (e.target.id || e.target) === id);

    const node = nodeSel.data().find(n => n.id === id);
    $('graph-tooltip-name').textContent = node ? node.name : '';
    $('graph-tooltip').dataset.path = id;
    $('graph-tooltip').classList.add('visible');
  }
  function clearSelection(nodeSel, linkSel, labelSel) {
    selectedNodeId = null;
    nodeSel.classed('dim', false).classed('selected', false);
    labelSel.classed('dim', false);
    linkSel.classed('dim', false).classed('highlight', false);
    $('graph-tooltip').classList.remove('visible');
  }

  $('graph-tooltip-open').addEventListener('click', () => {
    if (selectedNodeId) { body.classList.remove('graph-open'); openNote(selectedNodeId); }
  });
  $('btn-zoom-in').addEventListener('click', () => svgSel && svgSel.transition().duration(200).call(zoomBehavior.scaleBy, 1.35));
  $('btn-zoom-out').addEventListener('click', () => svgSel && svgSel.transition().duration(200).call(zoomBehavior.scaleBy, 0.74));
  $('btn-zoom-reset').addEventListener('click', () => svgSel && svgSel.transition().duration(250).call(zoomBehavior.transform, d3.zoomIdentity));

  // ============ 初始化 ============
  applySettings();
  updateOnlineBadge();
  loadVault(false).then(() => {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash && files.some(f => f.path === hash)) openNote(hash);
  });
})();
