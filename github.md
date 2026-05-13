好的，一步一步来。

---

## 第一步：准备工作

**1.1 注册 GitHub 账号**

去 [github.com](https://github.com) 注册一个账号（如果还没有的话）。

**1.2 安装 Git**

打开终端，检查是否已安装：
```bash
git --version
```
如果没有，去 [git-scm.com](https://git-scm.com) 下载安装。macOS 也可以直接运行上面命令，系统会提示你安装。

**1.3 配置 Git 身份**（只需做一次）
```bash
git config --global user.name "你的名字"
git config --global user.email "你的邮箱@example.com"
```

---

## 第二步：准备项目文件

先确保 `node_modules` 不会被上传（那个文件夹很大，不需要上传）。

检查项目根目录是否已有 `.gitignore` 文件：

`.gitignore` 已经配置好了，`node_modules` 和 `.DS_Store` 都会被忽略。

接下来写一个好的 README，让别人知道这个项目是什么、怎么用：

---

## 第三步：在 GitHub 创建仓库

1. 登录 [github.com](https://github.com)
2. 点击右上角 **"+"** → **"New repository"**
3. 填写：
   - Repository name：`guangdong-poker`（或你喜欢的名字）
   - Description：`广东找朋友扑克牌多人在线游戏`
   - 选 **Public**（开源）
   - **不要**勾选 "Add a README file"（我们已经有了）
4. 点击 **"Create repository"**

---

## 第四步：把代码推送到 GitHub

GitHub 创建完仓库后会显示一段命令，在你的项目目录里依次执行：

```bash
# 进入项目目录
cd /Users/chenallen/Downloads/6人伙计游戏

# 初始化 Git 仓库
git init

# 把所有文件加入暂存区
git add .

# 查看哪些文件会被提交（确认 node_modules 没在里面）
git status

# 提交
git commit -m "初始提交：广东找朋友扑克多人在线版"

# 关联远程仓库（把下面的 URL 换成你自己的）
git remote add origin https://github.com/你的用户名/guangdong-poker.git

# 推送到 GitHub
git branch -M main
git push -u origin main
```

---

## 第五步：验证

推送成功后，打开 `https://github.com/你的用户名/guangdong-poker`，应该能看到所有文件和 README 页面。

---

## 后续更新代码

以后每次修改代码后，只需三步：

```bash
git add .
git commit -m "描述这次改了什么"
git push
```

---

**注意**：推送时 GitHub 会要求登录验证。如果提示输入密码，需要用 **Personal Access Token** 而不是账号密码——在 GitHub → Settings → Developer settings → Personal access tokens → Generate new token，勾选 `repo` 权限生成即可。