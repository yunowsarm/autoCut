# AutoCut Desktop

本地小说自动剪辑工具。输入按回车分段的小说文本，选择图片文件夹，程序会按文件名顺序匹配图片，生成带字幕、旁白、可选背景音乐和图片动效的视频。

## 功能

- 按换行切分段落，每段匹配一张图片。
- 支持 Electron 桌面端，直接读取本地图片、音乐和输出目录。
- 保留网页模式，可继续通过 `npm start` 在浏览器中使用。
- 支持 Milora 配音、讯飞长文本配音、无旁白三种模式。
- 支持背景音乐循环混音。
- 支持视频比例：`21:9`、`16:9`、`3:2`、`4:3`、`1:1`、`3:4`、`2:3`、`9:16`。
- 支持图片适配、推镜、浮动、交替、随机和静止动效。
- 生成时显示进度，完成后可打开输出文件夹。

## 环境要求

- Node.js 18 或更高版本。
- Windows 优先支持。
- 项目通过 `ffmpeg-static` 使用本地 ffmpeg；也可以在 `.env` 中设置 `FFMPEG_BIN` 指向本机 ffmpeg。

## 安装

```bash
npm install
```

如需单独检查 ffmpeg：

```bash
npm run setup-ffmpeg
```

## 配置

在项目根目录创建或编辑 `.env`。

选择默认旁白引擎：

```env
TTS_PROVIDER=milora
TTS_PROVIDER=xfyun
TTS_PROVIDER=none
```

Milora 配音：

```env
MILORA_TTS_API_KEY=你的API密钥
MILORA_TTS_API_KEY_PARAM=key
```

讯飞长文本配音：

```env
XFYUN_APP_ID=你的AppId
XFYUN_API_KEY=你的ApiKey
XFYUN_API_SECRET=你的ApiSecret
XFYUN_VCN=x4_qianxue
XFYUN_SPEED=55
XFYUN_VOLUME=50
XFYUN_PITCH=55
XFYUN_SAMPLE_RATE=16000
```

不想生成旁白时：

```env
TTS_PROVIDER=none
```

## 启动桌面端

```bash
npm run desktop
```

桌面端使用流程：

1. 输入小说文本，每个回车段落生成一个视频片段。
2. 选择图片文件夹，图片会按文件名自然排序。
3. 可选背景音乐。
4. 选择输出目录。
5. 选择旁白引擎、视频比例、字幕、动效等参数。
6. 点击“生成视频”。
7. 完成后点击“打开输出文件夹”。

## 启动网页兼容模式

```bash
npm start
```

打开：

```text
http://localhost:3000
```

网页模式会继续使用上传接口，生成的视频默认保存到项目根目录的 `output/`。

## 打包 Windows 桌面应用

```bash
npm run desktop:build
```

打包产物会输出到 `dist/`。

## 测试

```bash
npm test
```
