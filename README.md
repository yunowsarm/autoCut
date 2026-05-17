# AutoCut Local

本地分段成片工具：输入分段文本，选择按文件名排序的图片文件夹，自动生成带旁白和字幕的视频。

## 功能

- 按换行切分段落，每段匹配一张图片。
- 自动调用 TTS 生成旁白，并按真实音频时长渲染画面。
- 支持字幕开关。
- 支持在页面上选择旁白引擎：曼波配音、讯飞配音、不生成旁白。
- 支持用户上传背景音乐，生成时自动循环播放到视频结束。
- 支持图片动效：推镜、浮动、交替、随机、静止。
- 支持前端调节动效参数：起始缩放、结束缩放、浮动幅度、浮动速度。
- 支持输出比例：21:9、16:9、3:2、4:3、1:1、3:4、2:3、9:16。
- 生成时显示进度条和当前阶段。

## 环境要求

- Node.js 18 或更高版本。
- pnpm / npm 均可。
- 项目会通过 `ffmpeg-static` 使用本地 ffmpeg。

## 安装

```bash
npm install
```

如需单独确保 ffmpeg：

```bash
npm run setup-ffmpeg
```

## 配置

在项目根目录创建或编辑 `.env`。

`.env` 中的 `TTS_PROVIDER` 是页面打开时的默认旁白引擎，生成前仍可在前端下拉框中切换：

```env
TTS_PROVIDER=mambo
MAMBO_TTS_API_KEY=你的API密钥
MAMBO_TTS_API_KEY_PARAM=key
```

```env
MAMBO_TTS_API_KEY_PARAM=apikey
```

可选 TTS provider：

```env
TTS_PROVIDER=mambo
TTS_PROVIDER=xfyun
...
TTS_PROVIDER=none
```

切回讯飞时需要配置：

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

## 启动

```bash
npm start
```

打开：

```text
http://localhost:3000
```

## 使用流程

1. 在文本框中输入文本，每个回车段落会生成一个视频片段。
2. 选择图片文件夹，图片会按文件名自然排序。
3. 可选上传背景音乐，背景音乐会循环播放到视频结束，并可调节音量。
4. 确保图片数量不少于文本段落数量。
5. 选择旁白引擎、视频比例、图片动效、字幕等参数。
6. 点击“生成视频”，等待进度条完成。
7. 点击“下载视频”保存成品。

## 视频比例

前端可选：

- `21:9`
- `16:9`
- `3:2`
- `4:3`
- `1:1`
- `3:4`
- `2:3`
- `9:16`

## 输出目录

生成的视频会放在：

```text
output/
```

临时上传文件会放在：

```text
uploads/
```

这两个目录都已在 `.gitignore` 中忽略。

## 常见问题

### `/api/render` 返回 400

通常是输入或素材问题：

- 没有输入文本。
- 图片数量少于段落数量。
- 上传的文件不是支持的图片格式。

接口返回 JSON 里的 `error` 字段会说明具体原因。

### `/api/render` 返回 502

通常是外部 TTS 服务失败，例如：

- 曼波接口 CDN 回源失败。
- API 密钥参数名不对。
- API 密钥无效或额度不足。
- 本机网络无法访问接口域名。

如果看到 `Mambo TTS request failed: HTTP 502`，多数情况是接口服务端或 CDN 问题，不是本地渲染代码问题。

### 想先不生成旁白

在 `.env` 中设置：

```env
TTS_PROVIDER=none
```

然后重启服务。

## 测试

```bash
node --test
```
