# Trusted episode worker.
#
# Node, ffmpeg, nak, and the TTS runtime are all pinned. Stitched audio is a
# release artifact bound to a manifest revision, so a drifting ffmpeg or model
# version would silently change published output.
#
# ffmpeg must be 7 or newer: under ffmpeg 5 the stitcher's silenceremove pass
# discards every clip and the episode encodes to an empty MP3. Trixie ships
# 7.1, and requireFfmpeg() refuses to stitch on anything older.
ARG NODE_IMAGE=node:22.22.0-trixie-slim

# ── TTS runtime ───────────────────────────────────────────────────────────────
# Built separately so the model download is not invalidated by a change to the
# runtime's apt set, and so pip and the venv toolchain never reach the final
# image.
FROM ${NODE_IMAGE} AS tts

ARG KOKORO_CLI_VERSION=0.4.0

RUN apt-get update && apt-get install --no-install-recommends -y \
      ca-certificates \
      espeak-ng \
      python3 \
      python3-venv \
    && rm -rf /var/lib/apt/lists/*

ENV KOKORO_HOME=/opt/kokoro-data \
    KOKORO_MODEL_DIR=/opt/kokoro-data/models

RUN python3 -m venv /opt/kokoro \
    && /opt/kokoro/bin/pip install --no-cache-dir "kokoro-cli==${KOKORO_CLI_VERSION}" \
    # doctor fails the build rather than letting a broken install surface
    # mid-episode; weights are baked in so a release never waits on a download.
    && /opt/kokoro/bin/kokoro setup \
    && /opt/kokoro/bin/kokoro doctor --json \
    # Root-owned and world-readable: the worker reads the weights and its own
    # dependencies but cannot rewrite either.
    && rm -rf /opt/kokoro/lib/python3.13/site-packages/pip \
              /opt/kokoro/lib/python3.13/site-packages/pip-*.dist-info \
              /opt/kokoro/bin/pip* \
    && chmod -R a+rX /opt/kokoro /opt/kokoro-data

# ── Transcription runtime ─────────────────────────────────────────────────────
# whisper.cpp transcribes every uploaded segment on the VPS; browser-side
# transcription was removed for audit cause. Source and weights are pinned by
# checksum: a drifting model would silently change published transcript
# content. GGML_NATIVE=OFF keeps the binary portable across build and run
# hosts; static libs so the runtime stage copies one file.
FROM ${NODE_IMAGE} AS whisper

ARG WHISPER_COMMIT=371b5a7561823ab2bb32142d2751e35e7534727b
ARG WHISPER_TARBALL_SHA256=89051d8fca516a3ad1f5c2f8f9d2fccb089afbaec338fca3f8731999babc6f81
# small.en, not base.en: base mangled domain speech (names, "Nostr", "npub");
# small is the CPU sweet spot. Pinned by checksum — a drifting model would
# silently change published transcript content.
ARG WHISPER_MODEL_SHA256=c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d

RUN apt-get update && apt-get install --no-install-recommends -y \
      ca-certificates \
      curl \
      cmake \
      build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    curl -fsSL -o /tmp/whisper.tar.gz \
      "https://github.com/ggml-org/whisper.cpp/archive/${WHISPER_COMMIT}.tar.gz"; \
    echo "${WHISPER_TARBALL_SHA256}  /tmp/whisper.tar.gz" | sha256sum -c -; \
    mkdir -p /src/whisper /opt/whisper-model; \
    tar -xzf /tmp/whisper.tar.gz -C /src/whisper --strip-components=1; \
    cmake -S /src/whisper -B /src/whisper/build \
      -DCMAKE_BUILD_TYPE=Release \
      -DGGML_NATIVE=OFF \
      -DBUILD_SHARED_LIBS=OFF \
      -DWHISPER_BUILD_TESTS=OFF; \
    cmake --build /src/whisper/build --target whisper-cli -j"$(nproc)"; \
    install -m 0755 /src/whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli; \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 -o /opt/whisper-model/ggml-small.en.bin \
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"; \
    echo "${WHISPER_MODEL_SHA256}  /opt/whisper-model/ggml-small.en.bin" | sha256sum -c -; \
    chmod 0644 /opt/whisper-model/ggml-small.en.bin

# ── Signer CLI ────────────────────────────────────────────────────────────────
# nak signs Compass events through the authorized NIP-46 session. Pinned by
# release tag and verified by checksum: this binary is on the signing path.
FROM ${NODE_IMAGE} AS nak

ARG NAK_VERSION=v0.20.2
ARG NAK_SHA256_AMD64=424db88043d26d9c2f1cbd2d9bc06582c39526f91f8e5523590439d4257da087
ARG NAK_SHA256_ARM64=ea5d5032e56aee8fea3bc90e53e194fee39f93a3979575e9f1f27f4cffa129f5
ARG TARGETARCH

RUN apt-get update && apt-get install --no-install-recommends -y ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) nak_sha="${NAK_SHA256_AMD64}" ;; \
      arm64) nak_sha="${NAK_SHA256_ARM64}" ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /usr/local/bin/nak \
      "https://github.com/fiatjaf/nak/releases/download/${NAK_VERSION}/nak-${NAK_VERSION}-linux-${TARGETARCH}"; \
    echo "${nak_sha}  /usr/local/bin/nak" | sha256sum -c -; \
    chmod 0755 /usr/local/bin/nak

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE}

# espeak-ng is the phonemizer Kokoro's ONNX pipeline links against, not a speech
# engine. Nothing falls back to it: a failed synthesis aborts the run.
# python3 must stay the same minor version as the tts stage, which the shared
# base image guarantees, because the copied venv links against it.
RUN apt-get update && apt-get install --no-install-recommends -y \
      ffmpeg \
      ca-certificates \
      espeak-ng \
      python3 \
      # libgomp1: whisper-cli's OpenMP runtime is the one lib the static build
      # still resolves at load time.
      libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=tts /opt/kokoro /opt/kokoro
COPY --from=tts /opt/kokoro-data /opt/kokoro-data
COPY --from=whisper /usr/local/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper /opt/whisper-model/ggml-small.en.bin /opt/whisper-model/ggml-small.en.bin
COPY --from=nak /usr/local/bin/nak /usr/local/bin/nak
RUN ln -s /opt/kokoro/bin/kokoro /usr/local/bin/kokoro

# Match the systemd unit's dedicated account so the container and host
# deployments have the same ownership model.
RUN groupadd --system --gid 1001 logbook \
    && useradd --system --uid 1001 --gid logbook --create-home --home-dir /home/logbook logbook

WORKDIR /opt/logbook/scripts
COPY scripts/package.json scripts/package-lock.json ./
# Install as root (writable npm cache), then hand the tree to logbook.
# The worker executes TypeScript through tsx, so dev dependencies are required.
RUN npm ci --no-audit --no-fund \
    && chown -R logbook:logbook /opt/logbook
COPY --chown=logbook:logbook scripts/ ./
COPY --chown=logbook:logbook logbook-pwa/public/data/ /opt/logbook/logbook-pwa/public/data/
USER logbook

ENV NODE_ENV=production \
    HOME=/home/logbook \
    NAK_BIN=/usr/local/bin/nak \
    KOKORO_HOME=/opt/kokoro-data \
    KOKORO_MODEL_DIR=/opt/kokoro-data/models \
    KOKORO_RECORDING_DIR=/tmp/kokoro \
    # phonemizer copies libespeak-ng out of site-packages and dlopens the copy,
    # so its scratch directory has to permit execution. It gets its own mount
    # rather than /tmp, which stays non-executable for downloaded audio.
    KOKORO_TMPDIR=/run/kokoro \
    LOGBOOK_STATIC_DIR=/var/www/logbook \
    LOGBOOK_AUDIO_DIR=/var/www/logbook/audio \
    LOGBOOK_WHISPER_MODEL=/opt/whisper-model/ggml-small.en.bin
CMD ["npm", "run", "watch"]
