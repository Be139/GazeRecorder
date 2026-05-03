# 眼动热区验证 PWA 原型

## Direction Guardrail 核查

- 当前实现是否触碰系统性 / 结构性风险：`不触碰`
- 风险出现在哪里：
  - 如果加入跨 APP 后台读屏、自动识别所有内容、OCR / AI 上传，就会变成系统级监测方案。
  - 如果同时接入手环、眼镜、恢复流程和长期数据中心，就会回到多模块支持结构。
- 当前收紧方式：
  - 单一主要载体：`Android 手机浏览器 / PWA`
  - 单一验证对象：`当前受控网页内的眼动热区`
  - 单一闭环：`camera gaze sample -> heatmap -> ROI box -> ROI screenshot`
  - 明确不做：`OCR`、`AI 上传`、`Recovery Card`、`60 秒呼吸`、`Recovery Check`、`跨 APP 截屏`

## 当前交付

- `prototype/index.html`
- `prototype/styles.css`
- `prototype/app.js`
- `prototype/manifest.webmanifest`
- `prototype/service-worker.js`

## 原型功能

1. `Screen 1 / Feed`：打开后先看到多信息页面，用来模拟当前网页内的信息环境。
2. `Screen 2 / WebGazer calibration`：点击 `Start detection` 后启动 WebGazer，显示 camera video、face overlay、face feedback box 和 9 个校准点。
3. `Calibration data`：每个高亮点调用 WebGazer 的 `recordScreenPosition(x, y, "click")`，把当前点作为已知屏幕坐标写入 WebGazer 回归模型。
4. `Screen 3 / Heat capture`：校准完成后，同一个 WebGazer `setGazeListener` 输出 gaze point，热区页把这些点映射到 `12 x 20` 网格。
5. `ROI Screenshot`：自动找到最高热区 cluster，外扩 `24px`，用 html2canvas 截当前页面 ROI，生成预览图和 `Download PNG`。
6. `Simulation fallback`：摄像头不可用时，用 pointer / touch 验证 heatmap 和截图链路，UI 会标明这是 fallback。

## 快速打开

直接打开 `prototype/index.html` 可以用鼠标 / 触摸模拟热区与截图。

摄像头 / WebGazer 需要浏览器安全上下文：`https://` 或 `localhost`。如果只用文件方式打开，前摄权限通常不可用，但 pointer / touch simulation 仍可验证热区和截图链路。

## 推荐验证路线

```text
Android Chrome 打开 HTTPS 页面
-> Start detection
-> WebGazer video / face overlay / face feedback box 显示
-> 看着高亮点完成 9 点 WebGazer calibration
-> 自动进入 heat capture 页面
-> 注视测试画面中的一个区域
-> heatmap 形成热点
-> ROI box 覆盖热点
-> Capture hot region
-> 预览并下载 PNG
```

当前截图只来自本 PWA 的受控页面，不尝试截取其他 APP。
