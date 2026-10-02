# 第三方组件与复用说明

本表对应 0.6.1 发布包。维护者的 MIT 不改变第三方许可；原文随安装包提供，对应源材料与程序放在同一 Release。

| 组件 | 来源与许可 | 用途与原文 |
| --- | --- | --- |
| video-mosaic 0.2.0，提交 4f34810f41f38776a560a293c54a98057e178863 | [GonzaloFuentes28/video-mosaic](https://github.com/GonzaloFuentes28/video-mosaic/tree/4f34810f41f38776a560a293c54a98057e178863)，MIT，Copyright (c) 2026 Gonzalo Fuentes | 复用拼接与辅助模块，原文件未修改；[许可](licenses/video-mosaic-MIT.txt) |
| FFmpeg / ffprobe 9.0.2 + x264/x265/zimg | [FFmpeg](https://ffmpeg.org/)，本项目构建为 GPLv3+，zimg 为 WTFPL；GCC 运行库带运行库例外 | 元数据、合并、预览和 HDR；固定源码、配置和构建脚本见[二进制源材料](docs/二进制发布准备.md) |
| yt-dlp 2026.08.19 | [固定版本](https://github.com/yt-dlp/yt-dlp/tree/2026.08.19)，Unlicense；本项目用 CPython 自行构建最小程序，certifi 2026.7.22 为 MPL-2.0，PyInstaller bootloader 带例外 | 在线解析和下载；安装目录 resources/licenses/decoder 保留原声明；官方 Windows 下载版本的整体许可与此构建不同 |
| PyAV 19.0.0 | [PyAV](https://github.com/PyAV-Org/PyAV/tree/v19.0.0)，BSD-3-Clause；原生 DLL 单独许可 | 解码与帧时间；[许可](licenses/PyAV-BSD-3-Clause.txt) |
| PyAV 内 FFmpeg 9.0.2、x264、x265 等 | [固定原生构建 9.0.2-1](https://github.com/PyAV-Org/pyav-ffmpeg/tree/9.0.2-1)；包含 LGPL/GPL 及其他许可 | 组合工作程序按 GPLv3+ 条件提供对应源码、配方与补丁；原始 MIT/BSD 声明保留 |
| Pillow 12.3.0 | [Pillow](https://github.com/python-pillow/Pillow)，MIT-CMU/HPND，原生依赖另有许可 | 图片与文字；[含原生依赖的完整许可](licenses/Pillow-LICENSE.txt) |
| Python 3.12.6 | [Python](https://www.python.org/downloads/release/python-3126/)，PSF 与历史许可；SSL 等依赖各自许可 | 处理程序；[许可](licenses/Python-LICENSE.txt) |
| PyInstaller 6.22.3 | [PyInstaller](https://github.com/pyinstaller/pyinstaller)，GPL-2.0-or-later 带 bootloader exception | 打包；[原文](licenses/PyInstaller-COPYING.txt) |
| Electron 44.5.1 / Chromium | [Electron](https://github.com/electron/electron)，MIT；Chromium 等独立许可 | 桌面壳；[MIT](licenses/Electron-MIT.txt)，安装根目录附 LICENSES.chromium.html |
| React / React DOM 19.3.0 | [React](https://github.com/facebook/react)，MIT | [React](licenses/React-MIT.txt)、[React DOM](licenses/React-DOM-MIT.txt) |
| Ant Design 6.6.5 及生产依赖 | [Ant Design](https://github.com/ant-design/ant-design)，各自许可 | [Ant Design](licenses/Ant-Design-MIT.txt)；安装包 resources/licenses/npm 与 npm-components.json 覆盖实际递归依赖 |

历史 0.6.0 开发包曾使用 Gyan FFmpeg 8.1.2 和官方 Windows yt-dlp.exe。licenses 中相应历史构建声明留作记录，它们不是本次 0.6.1 随附工具。

上游 video-mosaic 的 Gonzalo Fuentes 版权和 MIT 原文保持不变。本项目独立实现桌面界面、队列、时间选择、目录策略和故事板扩展，不调用上游命令行自动清理截图的流程。

项目代码可以 MIT 许可；完整安装包不能仅标为 MIT。[二进制源材料](docs/二进制发布准备.md) 说明各部分重建与源代码获取方法。
