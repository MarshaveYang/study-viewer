# Obsidian 笔记阅读器（study.dumm.top）

一个只读的手机友好 Obsidian 仓库阅读器：浏览笔记、调节字号/背景，查看双链关系图谱。
新增笔记的方式：直接在 GitHub 网页上把 Obsidian 文件夹拖进去上传即可，本工具会实时读取最新内容。

架构很简单：**没有构建步骤**，纯 HTML/CSS/JS + 2 个 Cloudflare Pages Functions（作为访问私有仓库的安全代理）。

---

## 第一步：建笔记仓库（存放 .md 文件）

1. 用 GitHub Desktop 新建一个仓库，比如叫 `obsidian-vault`，**设为 Private（私有）**。
2. 以后加笔记：直接打开 github.com 上这个仓库网页 → `Add file` → `Upload files` → 把 Obsidian 文件夹里的内容拖进去上传即可（正如你说的方式）。

## 第二步：生成一个 GitHub Token（让阅读器能读到私有仓库）

1. GitHub 右上角头像 → **Settings** → 左侧最下 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**。
2. Repository access 选 **Only select repositories**，选中 `obsidian-vault`。
3. Permissions 里找到 **Contents**，设为 **Read-only**。
4. 生成后复制这个 token（形如 `github_pat_xxxx`），先存到备忘录里，后面要用。

## 第三步：新建阅读器代码仓库并推送

1. 在本机新建一个文件夹，比如 `obsidian-viewer`，把我给你的这几个文件放进去（保持目录结构）：
   ```
   obsidian-viewer/
     index.html
     style.css
     app.js
     functions/
       api/
         tree.js
         file.js
     README.md
   ```
2. 用 GitHub Desktop：`File → Add local repository` 选这个文件夹 → 提示未初始化就点 `create a repository` → 填写仓库名 → `Publish repository`（这个仓库 Public/Private 都行，因为里面没有任何密钥，Token 是配置在 Cloudflare 后台的，不在代码里）。

## 第四步：Cloudflare Pages 部署

1. 打开 Cloudflare Dashboard → **Workers & Pages** → **创建** → **Pages** → **连接到 Git**，选你刚 push 的 `obsidian-viewer` 仓库。
2. 构建设置：
   - Framework preset：`None`
   - Build command：留空
   - Build output directory：`/`
3. 点 **保存并部署**，第一次部署完先不管，因为还没配环境变量，页面会报错，属正常。

## 第五步：配置环境变量（关键一步）

在这个 Pages 项目 → **Settings** → **Environment variables**，添加以下 4 个（Production 和 Preview 都加一遍，或者选 "All environments"）：

| 变量名 | 值 |
|---|---|
| `GITHUB_TOKEN` | 第二步复制的 token（建议点 "Encrypt" 加密存储） |
| `GITHUB_OWNER` | 你的 GitHub 用户名，即 `MarshaveYang` |
| `GITHUB_REPO` | 笔记仓库名，即 `obsidian-vault`（或你实际起的名字） |
| `GITHUB_BRANCH` | 分支名，通常是 `main` |

保存后，回到 **Deployments**，对最新一次部署点 **Retry deployment**（让新的环境变量生效）。

## 第六步：绑定自定义域名

1. 该 Pages 项目 → **Custom domains** → **设置自定义域名** → 输入 `study.dumm.top`。
2. 因为 `dumm.top` 已经在你的 Cloudflare 账号下，一般会自动帮你加好 DNS 记录，几分钟内生效。

完成后访问 `https://study.dumm.top` 即可。

---

## 功能说明

- **左上角图标**：打开/关闭笔记目录（文件夹树），支持搜索框按文件名过滤。
- **右上角 "Aa"**：调节字号（14–24px）、正文版面宽度、三种背景主题（纸白 / 护眼米色 / 深色）。设置保存在浏览器本地，下次自动记住。
- **右上角圆点图标**：打开关系图谱。首次打开会拉取所有笔记内容解析 `[[双链]]` 关系（有进度提示），之后缓存在当前浏览器会话中，直到仓库有新提交才会重新拉取。图谱支持双指缩放/拖动平移，点节点会高亮它的直接关联笔记，再点一次弹出的"打开笔记"按钮即可跳转阅读。
- **刷新图标**：强制重新拉取最新文件列表（比如你刚上传了新笔记）。
- 支持：`[[双链]]`、`[[双链|别名]]`、`![[图片.png]]` 图片嵌入、标准 Markdown 相对路径图片/链接、YAML frontmatter 中的 `title` 会作为页面标题显示。
- 找不到目标的双链会显示为灰色不可点击文字，不会报错崩溃。

## 后续可以再加（先不做，保持简单）

- 笔记内嵌入笔记的真正"transclusion"预览（目前 `![[笔记]]` 只做成普通链接）。
- 标签（`#tag`）索引页。
- 全文搜索（目前只搜文件名）。

如果笔记数量后面涨到几百篇，图谱首次构建会变慢（因为要逐个拉取文件内容解析链接），到时候可以告诉我，我给你改成"构建时预生成图谱数据 + push 后 webhook 自动重建"的方案。
