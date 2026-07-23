# syntax=docker/dockerfile:1

FROM rust:1.97-bookworm AS builder

WORKDIR /build

COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release --locked


FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && groupadd --gid 10001 walletpair \
    && useradd --uid 10001 --gid walletpair --no-create-home --shell /usr/sbin/nologin walletpair \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chmod=0555 /build/target/release/walletpair-relay /usr/local/bin/walletpair-relay

USER walletpair

ENV WALLETPAIR_RELAY_LISTEN_ADDR=0.0.0.0:3000

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:3000/healthz || exit 1

ENTRYPOINT ["/usr/local/bin/walletpair-relay"]
