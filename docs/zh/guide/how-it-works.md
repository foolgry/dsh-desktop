# 工作原理

DSH Desktop 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的轻量 Electron 外壳，只做三件事：

1. **内置 Node 运行时。** 用 Electron 自带的 Node.js 加上官方发布的 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) 包，不在你的系统里安装任何东西。

2. **本地起 `dsh web`。** 启动时在本机回环地址起一个 `dsh web` 服务（默认 3080 端口，被占用则自动用 3081、3082…），只监听 `127.0.0.1`，不对外暴露。

3. **用原生窗口加载。** 一个 BrowserWindow 渲染本地 UI，给你桌面应用般的体验，并有单实例锁——再次启动只会聚焦已有窗口。

::: warning 社区构建
这是非官方的 Electron 外壳加自动打包脚本。DeepSeek 名称和鲸鱼 Logo 为 DeepSeek 商标，此处仅用于标识所打包的上游软件。
:::
