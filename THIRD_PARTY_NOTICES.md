# Third-party notices

What motionmaxxing includes or runs that others made, and under which licence. A section is added the day its
code arrives.

## Included code

Portions of this software are licensed under the MIT License with their own copyright notice, reproduced in
`licenses/third-party-MIT.txt`.

| Part | Licence | Notes |
|---|---|---|
| `plugin/skills/motion-design/` (motion design principles) | MIT, Copyright (c) 2025 LottieFiles | Its `LICENSE` sits in the folder. |
| `plugin/skills/watch/` (video understanding) | MIT, Copyright (c) 2026 subh05sus | From github.com/subh05sus/video-understanding-skill. |

## Tools the editor runs (not shipped here)

| Tool | Licence | Notes |
|---|---|---|
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and the Whisper large-v3-turbo weights | MIT | Local transcription on the Mac's GPU. The model downloads once, checked by sha256. |
| [FFmpeg](https://ffmpeg.org) | LGPL/GPL, depending on the build | Installed by the user (Homebrew); called as a program. |
| [Remotion](https://www.remotion.dev/license) | Remotion License | Free for individuals and for companies of up to 3 people. Bigger companies need a Remotion company licence. |
| [HyperFrames](https://github.com/heygen-com/hyperframes) | Apache-2.0 | The motion clips' renderer, installed from npm. |
| [GSAP](https://gsap.com/standard-license) | GSAP Standard License | Free, commercial use included. |
| [Robust Video Matting](https://github.com/PeterL1n/RobustVideoMatting) (mobilenetv3 weights) | GPL-3.0 | The cutout behind the speaker. Downloaded on first use, checked by sha256, run with onnxruntime; never shipped here. |
| [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) face detector | MIT | Finds the speaker's head for zooms and placements. Downloaded once, checked by sha256. |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Unlicense | Fetches public videos for a teardown or a quote clip. |
| [Puppeteer](https://github.com/puppeteer/puppeteer) and Google Chrome | Apache-2.0 / Chrome's terms | The demo recorder drives the user's installed Chrome with its own profile. |
| Pexels, Pixabay, Wikimedia Commons | Each item's own licence | Stock b-roll on request; every item's author, licence and page are kept in the edit's `credits.json`. |
