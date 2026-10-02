# 第三方组件与复用说明

本表记录本地 0.6.0 开发/打包环境。当前仓库仅提供文档与许可原文，没有分发表内应用或第三方二进制。维护者的 MIT 许可不改变这些组件的许可。

| 组件及固定版本 | 来源与许可 | 本地用途及原文 |
| --- | --- | --- |
| video-mosaic 0.2.0，提交 `4f34810f41f38776a560a293c54a98057e178863` | [GonzaloFuentes28/video-mosaic](https://github.com/GonzaloFuentes28/video-mosaic/tree/4f34810f41f38776a560a293c54a98057e178863)，MIT，Copyright (c) 2026 Gonzalo Fuentes | 复用拼接与辅助模块，原文件未修改；[原许可](licenses/video-mosaic-MIT.txt) |
| FFmpeg / ffprobe 8.1.2 Gyan essentials | [构建来源](https://www.gyan.dev/ffmpeg/builds/)，该实际构建为 GPLv3+；[确切提交](https://github.com/FFmpeg/FFmpeg/commit/38b88335f9) | 元数据、在线合并与预览；[许可](licenses/FFmpeg-Gyan-GPL.txt)、[构建信息](licenses/FFmpeg-Gyan-BUILD.txt) |
| yt-dlp 2026.08.19 Windows `yt-dlp.exe` | [固定发布](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19)。其源代码为 Unlicense，但 PyInstaller 打包的 Windows 二进制整体为 GPLv3+，不能把 exe 仅标为 Unlicense | [实际 exe 内嵌声明](licenses/yt-dlp-Windows-THIRD_PARTY_LICENSES.txt)、[上游区分说明](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/README.md#licensing) |
| PyAV 19.0.0 | [PyAV](https://github.com/PyAV-Org/PyAV/tree/v19.0.0)，Python 项目为 BSD-3-Clause；轮子内 FFmpeg 和编解码 DLL 单独核对 | 解码和实际帧时间；[许可](licenses/PyAV-BSD-3-Clause.txt) |
| Pillow 12.3.0 | [Pillow](https://github.com/python-pillow/Pillow)，Pillow/HPND；其扩展依赖见原文 | 图像、文字与拼接；[许可](licenses/Pillow-LICENSE.txt) |
| Python 3.12.6 | [Python](https://www.python.org/downloads/release/python-3126/)，PSF 及随附历史许可 | 工作程序运行时；[许可](licenses/Python-LICENSE.txt) |
| PyInstaller 6.22.3 | [PyInstaller](https://github.com/pyinstaller/pyinstaller)，GPL-2.0-or-later 带 bootloader exception | 打包工作程序；例外范围按[许可原文](licenses/PyInstaller-COPYING.txt)，不能忽略其他库的许可 |
| Electron 44.5.1 | [Electron](https://github.com/electron/electron)，MIT；Chromium 等依赖另有声明 | 桌面壳；[许可](licenses/Electron-MIT.txt)，将来二进制发布还需随附 Electron 实际 `LICENSES.chromium.html` |
| React / React DOM 19.3.0 | [React](https://github.com/facebook/react)，MIT | 界面；[React](licenses/React-MIT.txt)、[React DOM](licenses/React-DOM-MIT.txt) |
| Ant Design 6.6.5 | [Ant Design](https://github.com/ant-design/ant-design)，MIT，依赖各自许可 | 通用控件；[许可](licenses/Ant-Design-MIT.txt) |

## 实际复用

上游 video-mosaic 保留原作者和 MIT 原文，本项目独立实现桌面界面、队列、时间选择、永久截图、目录策略和故事板扩展。复用拼接模块及辅助文件，不调用上游命令行自动清理截图的流程。本项目自己的 MIT 与上游 MIT 可以同时保留，不能删掉 Gonzalo Fuentes 的声明。

## 原生库与二进制边界

PyAV 的实际轮子报告 FFmpeg **9.0.2**，它与单独调用的 Gyan FFmpeg **8.1.2** 不同。其 FFmpeg DLL 的运行时许可字符串报告 LGPLv3+，但轮子还含 libx264/libx265；这些库的许可、准确构建配置和对应源材料仍需逐一核对。不能仅凭 PyAV 的 BSD 或运行时字符串认定整个工作程序都是 BSD/LGPL。

许可文本已保留 [GPLv3](licenses/GPLv3.txt) 与 [LGPLv3](licenses/LGPLv3.txt)。只放上游主页或许可文件不足以完成 GPL/LGPL 二进制分发义务；未来发布须提供实际二进制匹配的对应源代码、依赖和必要构建材料，并核对 LGPL 的替换/重新链接要求，见 [二进制发布准备](docs/二进制发布准备.md)。

没有第三方视频、截图或个人 Cookie 随本次文档发布。
