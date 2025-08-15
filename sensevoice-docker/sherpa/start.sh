#!/bin/bash
MODEL_DIR="/models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
TAR_FILE="sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2"
MODEL_PATH="$MODEL_DIR/model.int8.onnx"
TOKENS_PATH="/tokens.txt"
MIN_SIZE_MB=200
MIN_SIZE_BYTES=$((MIN_SIZE_MB * 1024 * 1024))

if [ ! -f "$MODEL_PATH" ] || [ "$(stat -c %s "$MODEL_PATH")" -lt "$MIN_SIZE_BYTES" ]; then
  echo "Model '$MODEL_PATH' not found or is less than ${MIN_SIZE_MB}MB. Downloading..."
  mkdir -p "$MODEL_DIR"
  curl -SL -O https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$TAR_FILE
  tar xvf "$TAR_FILE" -C /models
  rm "$TAR_FILE"
fi

cd /sherpa-onnx
python3 ./python-api-examples/non_streaming_server.py \
  --sense-voice="$MODEL_PATH" \
  --tokens="$TOKENS_PATH" \
  --num-threads="$NUM_THREADS"
