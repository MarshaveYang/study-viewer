(() => {
  'use strict';

  // ============ 状态 ============
  let files = [];        // [{path, sha}]
  let vaultVersion = null;
  let currentPath = null;

  // ============ DOM ============
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const docTitle = $('doc-title');
  const noteContent = $('note-content');
  const fileTreeEl = $('file-tree');
  const searchInput = $('search-input');
  const sidebarStatus = $('sidebar-status');

  // ============ 设置（本地存储） ============
  const DEFAULT_SETTINGS = { theme: 'paper', fontSize: 17, width: 640 };
  function loadSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('viewerSettings') || '{}') };
    } catch { return { ...DEFAULT_SETTINGS }; }
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

  $('font-size-range').addEventListener('input', (e) => {
    settings.fontSize = Number(e.target.value); applySettings(); saveSettings(settings);
  });
  $('width-range').addEventListener('input', (e) => {
    settings.width = Number(e.target.value); applySettings(); saveSettings(settings);
  });
  document.querySelectorAll('.swatch').forEach(btn => {
    btn.addEventListener('click', () => { settings.theme = btn.dataset.theme; applySettings(); saveSettings(settings); });
  });

  // ============ 顶部/侧边栏交互 ============
  $('btn-menu').addEventListener('click', () => body.classList.toggle('sidebar-open'));
  $('sidebar-backdrop').addEventListener('click', () => body.classList.remove('sidebar-open'));
  $('btn-settings').addEventListener('click', () => body.classList.toggle('settings-open'));
  $('btn-close-settings').addEventListener('click', () => body.classList.remove('settings-open'));
  $('btn-refresh').addEventListener('click', () => loadVault(true));

  function closeSidebarIfMobile() {
    if (window.innerWidth < 860) body.classList.remove('sidebar-open');
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
      renderTree();
      sidebarStatus.textContent = files.filter(f => f.path.endsWith('.md')).length + ' 篇笔记';
    } catch (err) {
      sidebarStatus.textContent = '加载失败，请检查网络';
    }
  }

  // ============ 侧边栏文件树渲染 ============
  function buildTreeStructure(paths) {
    const root = {};
    paths.forEach((f) => {
      const parts = f.path.split('/');
      let node = root;
      parts.forEach((part, i) => {
        if (i === parts.length - 1) {
          node.__files = node.__files || [];
          node.__files.push({ name: part, path: f.path });
        } else {
          node[part] = node[part] || {};
          node = node[part];
        }
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
      details.appendChild(summary);
      renderTreeNode(node[folder], details, depth + 1);
      container.appendChild(details);
    });
    if (node.__files) {
      node.__files
        .filter(f => f.name.endsWith('.md'))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
        .forEach((f) => {
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

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    fileTreeEl.innerHTML = '';
    if (!q) { renderTree(); return; }
    const matches = files
      .filter(f => f.path.endsWith('.md') && f.path.toLowerCase().includes(q))
      .sort((a, b) => a.path.localeCompare(b.path, 'zh'));
    matches.forEach((f) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.textContent = f.path.replace(/\.md$/, '');
      item.dataset.path = f.path;
      item.addEventListener('click', () => { openNote(f.path); closeSidebarIfMobile(); });
      fileTreeEl.appendChild(item);
    });
  });

  // ============ 链接解析 ============
  function findFileByLinkTarget(rawTarget) {
    let t = rawTarget.trim();
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

  function isImagePath(p) {
    return /\.(png|jpe?g|gif|svg|webp)$/i.test(p);
  }

  // 将 Obsidian 双链 [[Note]] / [[Note|别名]] / ![[image.png]] 转换成标准 Markdown
  function transformWikilinks(md) {
    return md.replace(/(!)?\[\[([^\]]+)\]\]/g, (match, bang, inner) => {
      const isEmbed = !!bang;
      let [targetPart, alias] = inner.split('|');
      targetPart = targetPart.trim();
      const cleanTarget = targetPart.split('#')[0].trim();
      const label = (alias || targetPart.split('#').pop() || cleanTarget.split('/').pop()).trim();
      const resolved = findFileByLinkTarget(cleanTarget);

      if (isEmbed && resolved && isImagePath(resolved)) {
        return `![${label}](/api/file?path=${encodeURIComponent(resolved)})`;
      }
      if (resolved) {
        return `[${label}](#wikilink:${encodeURIComponent(resolved)})`;
      }
      return `<span class="broken-link" title="未找到笔记：${escapeHtml(cleanTarget)}">${escapeHtml(label)}</span>`;
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function stripFrontmatter(md) {
    const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!m) return { body: md, title: null };
    const fm = m[1];
    const titleMatch = fm.match(/^title:\s*(.+)$/m);
    return { body: md.slice(m[0].length), title: titleMatch ? titleMatch[1].trim().replace(/^["']|["']$/g, '') : null };
  }

  // ============ 打开笔记 ============
  async function openNote(path) {
    noteContent.innerHTML = '<p class="muted">加载中…</p>';
    docTitle.textContent = path.split('/').pop().replace(/\.md$/, '');
    currentPath = path;
    highlightActiveFile(path);

    try {
      const res = await fetch('/api/file?path=' + encodeURIComponent(path));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const raw = await res.text();
      const { body: mdBody, title } = stripFrontmatter(raw);
      if (title) docTitle.textContent = title;

      const transformed = transformWikilinks(mdBody);
      noteContent.innerHTML = marked.parse(transformed, { breaks: true });

      // 修正相对路径图片（非 wikilink 的标准 markdown 图片）
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
      noteContent.innerHTML = `<p class="muted">加载失败：${escapeHtml(String(err))}</p>`;
    }
  }

  function resolveRelative(currentNotePath, relPath) {
    if (relPath.startsWith('/')) return findFileByLinkTarget(relPath.slice(1));
    const dir = currentNotePath.split('/').slice(0, -1);
    const parts = relPath.split('/');
    parts.forEach(p => {
      if (p === '..') dir.pop();
      else if (p !== '.') dir.push(p);
    });
    const joined = dir.join('/');
    const exact = files.find(f => f.path === joined);
    return exact ? exact.path : findFileByLinkTarget(relPath.split('/').pop());
  }

  function highlightActiveFile(path) {
    document.querySelectorAll('.file-item').forEach(el => {
      el.classList.toggle('active', el.dataset.path === path);
    });
  }

  // 点击正文中的链接
  noteContent.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#wikilink:')) {
      e.preventDefault();
      openNote(decodeURIComponent(href.replace('#wikilink:', '')));
    } else if (/^https?:\/\//.test(href)) {
      a.target = '_blank'; a.rel = 'noopener';
    } else if (href.endsWith('.md') || href.includes('.md#')) {
      e.preventDefault();
      const resolved = resolveRelative(currentPath || '', decodeURIComponent(href.split('#')[0]));
      if (resolved) openNote(resolved);
    }
  });

  // ============ 关系图谱 ============
  let graphBuilt = false;
  let simulation = null;
  let selectedNodeId = null;

  $('btn-graph').addEventListener('click', openGraph);
  $('btn-close-graph').addEventListener('click', () => body.classList.remove('graph-open'));

  async function openGraph() {
    body.classList.add('graph-open');
    if (!graphBuilt) {
      $('graph-status').textContent = '正在构建关系图谱…';
      const data = await buildGraphData();
      renderGraph(data);
      graphBuilt = true;
    }
  }

  async function buildGraphData() {
    const cacheKey = 'graphCache_' + vaultVersion;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* fall through */ }
    }

    const mdFiles = files.filter(f => f.path.endsWith('.md'));
    const nodes = mdFiles.map(f => ({ id: f.path, name: f.path.split('/').pop().replace(/\.md$/, '') }));
    const edgeKeys = new Set();
    const edges = [];

    let done = 0;
    const concurrency = 6;
    let idx = 0;

    async function worker() {
      while (idx < mdFiles.length) {
        const i = idx++;
        const f = mdFiles[i];
        try {
          const res = await fetch('/api/file?path=' + encodeURIComponent(f.path));
          const text = await res.text();
          const matches = [...text.matchAll(/!?\[\[([^\]]+)\]\]/g)];
          matches.forEach((m) => {
            const targetRaw = m[1].split('|')[0].split('#')[0].trim();
            const resolved = findFileByLinkTarget(targetRaw);
            if (resolved && resolved.endsWith('.md') && resolved !== f.path) {
              const key = f.path + '=>' + resolved;
              if (!edgeKeys.has(key)) { edgeKeys.add(key); edges.push({ source: f.path, target: resolved }); }
            }
          });
        } catch { /* 忽略单个文件失败 */ }
        done++;
        $('graph-status').textContent = `正在构建关系图谱… (${done}/${mdFiles.length})`;
      }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));
    const data = { nodes, edges };
    try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* 超出配额忽略 */ }
    return data;
  }

  let zoomBehavior = null;
  let svgSel = null, gSel = null;

  function renderGraph(data) {
    $('graph-status').textContent = `${data.nodes.length} 篇笔记 · ${data.edges.length} 条链接`;
    const svgEl = $('graph-svg');
    const width = svgEl.clientWidth || window.innerWidth;
    const height = svgEl.clientHeight || (window.innerHeight - 52);

    svgSel = d3.select(svgEl);
    svgSel.selectAll('*').remove();
    svgSel.attr('viewBox', [0, 0, width, height]);

    gSel = svgSel.append('g');

    zoomBehavior = d3.zoom().scaleExtent([0.15, 6]).on('zoom', (event) => {
      gSel.attr('transform', event.transform);
    });
    svgSel.call(zoomBehavior);

    const linkSel = gSel.append('g').selectAll('line')
      .data(data.edges).join('line').attr('class', 'link');

    const nodeSel = gSel.append('g').selectAll('circle')
      .data(data.nodes).join('circle')
      .attr('class', 'node')
      .attr('r', 5.5)
      .call(dragBehavior());

    const labelSel = gSel.append('g').selectAll('text')
      .data(data.nodes).join('text')
      .attr('class', 'node-label')
      .text(d => d.name)
      .attr('dx', 8).attr('dy', 3);

    nodeSel.on('click', (event, d) => {
      event.stopPropagation();
      selectNode(d.id, nodeSel, linkSel, labelSel, data);
    });
    svgSel.on('click', () => clearSelection(nodeSel, linkSel, labelSel));

    simulation = d3.forceSimulation(data.nodes)
      .force('link', d3.forceLink(data.edges).id(d => d.id).distance(55).strength(0.5))
      .force('charge', d3.forceManyBody().strength(-130))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(20))
      .on('tick', () => {
        linkSel.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
               .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
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

  function selectNode(id, nodeSel, linkSel, labelSel, data) {
    selectedNodeId = id;
    const neighborIds = new Set([id]);
    data.edges.forEach(e => {
      const s = e.source.id || e.source, t = e.target.id || e.target;
      if (s === id) neighborIds.add(t);
      if (t === id) neighborIds.add(s);
    });
    nodeSel.classed('dim', d => !neighborIds.has(d.id)).classed('selected', d => d.id === id);
    labelSel.classed('dim', d => !neighborIds.has(d.id));
    linkSel.classed('dim', e => (e.source.id || e.source) !== id && (e.target.id || e.target) !== id)
           .classed('highlight', e => (e.source.id || e.source) === id || (e.target.id || e.target) === id);

    const node = data.nodes.find(n => n.id === id);
    $('graph-tooltip-name').textContent = node ? node.name : '';
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
    if (selectedNodeId) {
      body.classList.remove('graph-open');
      openNote(selectedNodeId);
    }
  });

  $('btn-zoom-in').addEventListener('click', () => svgSel && svgSel.transition().duration(200).call(zoomBehavior.scaleBy, 1.35));
  $('btn-zoom-out').addEventListener('click', () => svgSel && svgSel.transition().duration(200).call(zoomBehavior.scaleBy, 0.74));
  $('btn-zoom-reset').addEventListener('click', () => svgSel && svgSel.transition().duration(250).call(zoomBehavior.transform, d3.zoomIdentity));

  // ============ 初始化 ============
  applySettings();
  loadVault(false).then(() => {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash && files.some(f => f.path === hash)) openNote(hash);
  });
})();
