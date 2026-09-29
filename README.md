# 传感器数据面板

纯原生 HTML/CSS/JS（无任何框架）的传感器数据面板，读取环境光、设备方向、地理位置，
提供实时数值、变化曲线、权限状态展示，并在权限被拒 / 不支持 / 非安全上下文时自动降级。

## 运行

传感器与定位 API 要求安全上下文（HTTPS 或 `localhost`）：

```bash
python3 -m http.server 8080
# 打开 http://localhost:8080
```

直接用 `file://` 或非 localhost 的 HTTP 打开会触发非安全上下文降级（页面会提示并自动使用模拟数据）。

## 功能

- 环境光（Ambient Light Sensor）、设备方向（DeviceOrientation）、地理位置（Geolocation）实时采集
- Canvas 曲线：光照 lux；方向 α/β/γ；位置相对偏移（米，北/东向）
- 权限状态徽章：未知 / 待授权 / 已授权 / 已拒绝 / 已撤销 / 不支持 / 非安全上下文
- 开始、暂停/继续、停止、清空
- 历史数据保存到 IndexedDB（`sensor-panel` 库 `samples` 表），页面展示最近记录与总数

## 权限与降级策略

- 权限申请只在点击「开始」（用户手势）后触发，页面加载时仅查询状态不弹窗
- 权限被拒 / 浏览器不支持 / 非安全上下文：自动切换为模拟数据，并显示手动输入入口
- 手动输入：点击「应用」后该传感器切换为手动模式，数值走同一平滑与绘图管线
- 权限被撤销：通过 Permissions API 的 `onchange` 与 Geolocation 错误回调检测，
  状态徽章更新为「已撤销」并自动切换到模拟数据
- 模拟数据使用固定种子的伪随机游走，同一传感器每次会话数据序列一致

## 平滑处理

- 指数滑动平均（EMA）抑制噪声
- 单步最大跳变限制（maxJump）抑制突变
- 方向角 α 先做 0/360 度解卷绕再平滑，避免跨界跳变

## 文件结构

- `index.html` 页面结构
- `css/style.css` 样式
- `js/app.js` 主流程、状态机、UI 绑定
- `js/sensors.js` 三类传感器适配与权限处理
- `js/chart.js` Canvas 时序曲线
- `js/db.js` IndexedDB 封装
- `js/smoothing.js` EMA / 跳变限制 / 角度解卷绕
- `js/simulator.js` 固定种子模拟数据源

## 备注

- iOS Safari 的设备方向权限（`DeviceOrientationEvent.requestPermission`）撤销后需刷新页面重新授权
- 桌面浏览器若无方向硬件，3 秒无数据自动判定为不支持并降级
