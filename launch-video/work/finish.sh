#!/usr/bin/env bash
# Adds the soundtrack (with loudness normalisation) and makes the smaller web version. Run from launch-video/.
set -euo pipefail
mkdir -p out
ffmpeg -y -v error -i work/video_silent.mp4 -i work/audio_mix.wav -filter_complex "[1:a]loudnorm=I=-16:TP=-1.5:LRA=11[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart out/dengue-buster-launch-92s.mp4
ffmpeg -y -v error -i out/dengue-buster-launch-92s.mp4 -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -c:a aac -b:a 128k \
  -movflags +faststart out/dengue-buster-launch-92s-web.mp4
