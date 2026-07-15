// GET /api/file?path=xxx.md
// 通过 GitHub Contents API 以原始内容代理拉取文件（笔记正文 / 图片等资源）
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const path = url.searchParams.get('path');

  if (!path) return new Response('缺少 path 参数', { status: 400 });

  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  const token = env.GITHUB_TOKEN;

  if (!owner || !repo || !token) {
    return new Response('缺少环境变量 GITHUB_OWNER / GITHUB_REPO / GITHUB_TOKEN', { status: 500 });
  }

  try {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;

    const res = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3.raw',
        'User-Agent': 'obsidian-viewer',
      },
    });

    if (!res.ok) {
      return new Response(`GitHub 请求失败 (${res.status}): ${path}`, { status: res.status });
    }

    const buf = await res.arrayBuffer();
    return new Response(buf, {
      headers: {
        'Content-Type': guessContentType(path),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
}

function guessContentType(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const map = {
    md: 'text/plain; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    pdf: 'application/pdf',
  };
  return map[ext] || 'application/octet-stream';
}
