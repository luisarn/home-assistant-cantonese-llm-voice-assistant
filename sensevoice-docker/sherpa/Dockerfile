FROM debian:bookworm-slim

ENV VIRTUAL_ENV=/venv
ENV PATH="/venv/bin:$PATH"

RUN \
    apt-get update \
    && apt-get install -y --no-install-recommends \
    git \
    netcat-traditional \
    python3-pip \
    python3-venv \
    curl \
    bzip2

RUN python3 -m venv /venv
RUN pip install sherpa-onnx websockets soundfile pyopenssl

RUN git clone https://github.com/k2-fsa/sherpa-onnx.git /sherpa-onnx

