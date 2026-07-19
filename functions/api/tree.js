// GET /api/tree
// 返回私有仓库的完整文件树（含 version 指纹，用于图谱缓存判断是否需要更新）
export async function onRequestGet(context) {
  const { env } = context;
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  const token = env.GITHUB_TOKEN;

  if (!owner || !repo || !token) {
    return json({ error: '缺少环境变量 GITHUB_OWNER / GITHUB_REPO / GITHUB_TOKEN，请在 Cloudflare Pages 项目设置中添加' }, 500);
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'obsidian-viewer',
  };

  try {
    const refRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      { headers }
    );
    if (!refRes.ok) {
      return json({ error: `获取分支信息失败 (${refRes.status})，请检查仓库名/分支名/Token 权限` }, refRes.status);
    }
    const refData = await refRes.json();
    const commitSha = refData.object.sha;

    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`,
      { headers }
    );
    if (!treeRes.ok) {
      return json({ error: `获取文件树失败 (${treeRes.status})` }, treeRes.status);
    }
    const treeData = await treeRes.json();

    const files = (treeData.tree || [])
      .filter((item) => item.type === 'blob')
      .map((item) => ({ path: item.path, sha: item.sha }));

    return json({ version: commitSha, repo: `${owner}/${repo}`, files });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
