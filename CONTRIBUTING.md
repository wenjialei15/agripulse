# 参与 AgriPulse

感谢你帮助完善这个农业物联网实验项目。

## 本地开发

1. Fork 并克隆仓库，创建自己的功能分支。
2. 使用 Python 3.9+，运行 `python -m agripulse`；核心不需要安装依赖。
3. 修改后运行 `python -m unittest discover -s tests -v`。修改前端时请检查桌面和手机布局、空数据、断线、两种来源切换与阈值保存。
4. 提交 PR，说明问题、修改后的行为和验证方式。

保持运行依赖精简；新的协议适配器应与核心隔离。为错误数据、断线、权限和持久化等重要行为补充测试，避免仅验证实现细节。

## 浏览器测试与截图

浏览器测试需要 Node.js 20+，这些依赖只用于开发，不影响 Python 核心的零第三方运行依赖。

```bash
npm ci
npx playwright install chromium
npm test
```

测试自动在本机端口 8765 启动隔离服务，使用 `data/browser-tests.db`，请勿将此路径用于真实数据。测试会修改这个测试库的阈值。

已安装 Microsoft Edge 时，可跳过下载 Chromium，用现有浏览器测试。PowerShell：

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm test
```

测试覆盖两种来源阈值隔离、切换时禁止误编辑、无历史读数设备、CSV 下载及手机布局。
如需重新生成 README 截图，在上述环境中设置 `UPDATE_SCREENSHOTS=1` 后运行测试。PowerShell：

```powershell
$env:UPDATE_SCREENSHOTS = '1'
npm test
Remove-Item Env:UPDATE_SCREENSHOTS
```

截图位于 `docs/images/`，只包含本地模拟数据。提交前打开两张图片检查内容与排版。

## 适合首个贡献的方向

- 为看板增加英文切换并完善可访问性。
- 为不同土壤探头记录标定步骤与匿名示例数据。
- 补充 ESP32 HTTP 上报示例与可复现接线说明。
- 为大数据量 CSV 导出增加分页或流式实现。

设备适配与物联网通信方案请先开 Issue 讨论。不要上传真实 API key、Wi-Fi 密码、精确农场位置或未经允许分享的生产数据。

## 报告问题

请给出 Python 版本、系统、启动命令、预期/实际行为与脱敏后的最小上报内容。安全问题不要附带可利用的真实凭证；先说明受影响的功能与版本。
