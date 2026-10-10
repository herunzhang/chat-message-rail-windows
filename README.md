# Chat Message Rail for Windows

为 Windows 桌面版普通 Chat 页面临时启用原生风格的提问导航条。项目复用应用已经安装的 Message Rail 组件和样式，不修改可执行文件、`resources.asar`、安装目录或账号数据。

> 非官方实验项目。当前仅验证 **OpenAI Codex/ChatGPT Windows 26.1002.7124.0**。应用更新后，脚本会因版本保护而停止注入，直到适配器完成复核。

## 功能

- 普通 Chat 中达到 4 条用户消息后显示左侧导航条。
- 点击项目平滑跳转；滚动时高亮当前问题。
- 悬停显示提问与部分回答，使用应用原生 Markdown 预览。
- 支持本地收藏、折叠与展开。
- 使用 `MutationObserver` 自动跟随新消息和 Chat 切换。
- 在最新消息位置后台补齐历史，正文不发生上下跳动。
- 预览完成后保存在本次应用运行期间的内存缓存中。
- 完全退出应用后注入自动消失。

## 安装与使用

要求：Windows 10/11、Windows PowerShell 5.1，以及兼容版本的 Codex/ChatGPT 桌面应用。不需要安装 Node.js。

1. 下载并解压发布包；不要直接在压缩包内运行。
2. 保存工作，并完全退出正在运行的桌面应用，包括托盘图标。
3. 双击 `Start-ChatMessageRail.bat`。
4. 阅读终端中的安全说明，输入大写 `ENABLE`。
5. 打开一个至少包含 4 条用户消息的普通 Chat。

脚本会优先自动查找 Microsoft Store 或常见目录中的桌面应用。无法识别时，只会要求手动填写 `Codex.exe` 或 `ChatGPT.exe` 的完整路径。

临时移除导航条可双击 `Stop-ChatMessageRail.bat`。若要关闭调试端口，必须完全退出桌面应用；之后正常启动即恢复官方原状。

也可在 PowerShell 中指定端口或程序路径：

```powershell
.\Invoke-Rail.ps1 -Mode Enable -Port 9322
.\Invoke-Rail.ps1 -Mode Enable -AppPath 'C:\path\to\ChatGPT.exe'
.\Invoke-Rail.ps1 -Mode Disable -Port 9322
```

## 工作方式

启动脚本只连接 `127.0.0.1` 上的 Chromium DevTools Protocol。注入代码从当前页面只读识别普通 Chat 的消息列表、滚动容器和虚拟化定位接口，然后加载本机应用已有的 Message Rail React 组件与 CSS。

进入停留在最新消息的 Chat 时，适配器会调用 Chat 自身用于内容搜索的后台历史补全入口。应用的虚拟列表负责保持视口，适配器不会通过滚动到顶部来加载历史。较早项目的预览沿用原生 `onPreviewItem` 悬停流程；同一版本的消息预览在一次应用会话中只准备一次。

## 隐私与安全边界

- 启动器禁用 HTTP 代理和重定向，只接受 `127.0.0.1` 上由 `ChatGPT` 或 `Codex` 进程拥有的监听端口。
- 页面适配器不包含 `fetch`、XHR、WebSocket 或第三方网络请求。
- 不上传聊天内容，不读取 Cookie 或访问令牌。
- 收藏仅把会话 ID 和消息 ID 写入应用 localStorage，键名为 `chat-message-rail.bookmarks.v1`；不保存提问或回答正文。
- 预览正文只存在于当前页面内存中，停止脚本或退出应用后清空。
- CDP 端口打开期间，本机同一用户下的其他程序可能控制该应用。使用完成后请完全退出桌面应用。

详见 [SECURITY.md](SECURITY.md)。

## 兼容性与限制

- 适配器依赖当前版本的内部模块名、导出和 React 数据结构。它会检查已知入口资源；版本不匹配时停止，而不是猜测。
- Work/Codex thread 已有官方 Message Rail，本项目只挂载到普通 Chat。
- 普通 Chat 没有与 Work 完全相同的历史摘要存储，因此进入 Chat 时需要先在后台补齐导航项目。悬停仍只为对应项目显示预览。
- 如果进入 Chat 时正在阅读中间位置，脚本不会自动补齐历史，以免干扰当前阅读位置。回到最新消息后重新进入该 Chat 即可。
- 应用完全退出后需要再次通过启动脚本启用。

## 故障排查

**没有出现导航条**

- 确认当前是普通 Chat，并至少有 4 条用户消息。
- 检查终端是否显示版本不兼容或找不到应用路径。
- 完全退出应用后重新运行启动脚本。

**只有最近几项**

- 回到最新消息，再切换到其他 Chat 后返回，等待后台历史补全。

**关闭启动窗口后功能仍在**

- 这是正常行为。注入运行在桌面应用页面中；双击停止脚本或完全退出应用即可移除。

## 开发与验证

仓库不包含应用资源或构建依赖。静态检查：

```powershell
node --check .\native-message-rail.js

$errors = $null
$tokens = $null
[void][System.Management.Automation.Language.Parser]::ParseFile(
  (Join-Path $PWD 'Invoke-Rail.ps1'),
  [ref]$tokens,
  [ref]$errors
)
$errors
```

实机验证应覆盖：4 条阈值、点击跳转、当前项高亮、新消息自动更新、折叠/展开、历史补全期间视口不移动、同一预览不重复加载、停止后恢复原样。

## 许可与第三方代码

本仓库原创代码采用 [MIT License](LICENSE)。项目不会分发桌面应用的代码或资源；运行时引用的已安装资源不受本仓库许可证覆盖。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

## English quick start

This unofficial, version-specific Windows adapter adds the installed app's native-style Message Rail to ordinary Chat pages without modifying application files.

1. Extract the release archive.
2. Fully exit the desktop app, including its tray icon.
3. Run `Start-ChatMessageRail.bat` and type `ENABLE` after reviewing the safety notice.
4. Open an ordinary Chat containing at least four user messages.

Run `Stop-ChatMessageRail.bat` to remove the injected UI. Fully exit the desktop app to close the local DevTools port. See the Chinese sections above and [SECURITY.md](SECURITY.md) for compatibility and security details.
