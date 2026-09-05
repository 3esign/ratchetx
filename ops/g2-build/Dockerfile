# Tooling only. Build with: docker build --platform linux/amd64 ops/g2-build
# The resulting image digest must be measured before using it as a release pin.
FROM --platform=linux/amd64 rust@sha256:8aea3a845c48caac4091a8d0e6494d213061f8f014dc2f5a5f1a88a1a8c9f301
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]
USER root
ENV PATH="/opt/g2-sbf/bin:/opt/node/bin:$PATH"
WORKDIR /build

# The build context is ops/g2-build, never the repository or a key directory.
COPY toolchain-lock.json /opt/g2-build/toolchain-lock.json

RUN curl --fail --show-error --location --retry 3 \
      https://static.crates.io/crates/cargo-build-sbf/cargo-build-sbf-4.3.0.crate \
      --output /tmp/g2-sbf.crate && \
    echo '70a89282c9c5b9ae798de4dc3b50c3bf562673190bdadd868f0e2a1fc3ea04ce  /tmp/g2-sbf.crate' | sha256sum --check --strict - && \
    mkdir -p /opt/g2-source && \
    tar --extract --gzip --file /tmp/g2-sbf.crate --directory /opt/g2-source && \
    test -f /opt/g2-source/cargo-build-sbf-4.3.0/Cargo.lock && \
    cargo install --path /opt/g2-source/cargo-build-sbf-4.3.0 --locked \
      --root /opt/g2-sbf --target-dir /tmp/g2-sbf-target && \
    test "$(command -v cargo-build-sbf)" = /opt/g2-sbf/bin/cargo-build-sbf && \
    cargo-build-sbf --version && \
    rm -rf /tmp/g2-sbf-target /opt/g2-source && \
    rm -f /tmp/g2-sbf.crate

RUN curl --fail --show-error --location --retry 3 \
      https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-x64.tar.xz \
      --output /tmp/g2-node.tar.xz && \
    echo '00bbd05e306ea68b6e13e17360d0e2f680b493ef95f2fea1c4296ff7437530bc  /tmp/g2-node.tar.xz' | sha256sum --check --strict - && \
    mkdir -p /opt/node && \
    tar --extract --xz --file /tmp/g2-node.tar.xz --strip-components=1 --directory /opt/node && \
    rm -f /tmp/g2-node.tar.xz

# cargo-build-sbf 4.3.0 unpacks this archive directly into this exact cache.
# Verify the download before extraction; install-only then checks the cache.
RUN curl --fail --show-error --location --retry 3 \
      https://github.com/anza-xyz/platform-tools/releases/download/v1.56/platform-tools-linux-x86_64.tar.bz2 \
      --output /tmp/g2-platform-tools.tar.bz2 && \
    echo 'afdad6e0672942b00d69fc51ebde0d182c9b9ed21e078357fcedb50f921dae2d  /tmp/g2-platform-tools.tar.bz2' | sha256sum --check --strict - && \
    mkdir -p /root/.cache/solana/v1.56/platform-tools && \
    tar --extract --bzip2 --file /tmp/g2-platform-tools.tar.bz2 --directory /root/.cache/solana/v1.56/platform-tools && \
    test -x /root/.cache/solana/v1.56/platform-tools/rust/bin/rustc && \
    test -x /root/.cache/solana/v1.56/platform-tools/llvm/bin/clang && \
    cargo-build-sbf --install-only --tools-version v1.56 && \
    rm -f /tmp/g2-platform-tools.tar.bz2

# Check actual executables; image creation is not program build or SVM evidence.
RUN node -e 'const fs=require("node:fs"), assert=require("node:assert/strict"), cp=require("node:child_process"); const lock=JSON.parse(fs.readFileSync("/opt/g2-build/toolchain-lock.json","utf8")); const run=(exe)=>{const r=cp.spawnSync(exe,["--version"],{encoding:"utf8"}); assert.equal(r.status,0,exe+": "+r.stderr); process.stdout.write(r.stdout); return r.stdout;}; assert.equal(process.platform,"linux"); assert.equal(process.arch,"x64"); assert.equal(process.version,"v"+lock.node.version); assert.equal(process.execPath,"/opt/node/bin/node"); assert.match(run("/usr/local/cargo/bin/rustc"),new RegExp("^rustc "+lock.nativeRust.version.replaceAll(".","\\.")+" ")); assert.match(run("/opt/g2-sbf/bin/cargo-build-sbf"),/^(?:solana-)?cargo-build-sbf 4\.3\.0(?:\s|$)/m); assert.equal(lock.cargoBuildSbf.version,"4.3.0"); assert.equal(lock.platformTools.version,"v1.56"); assert.equal(lock.platformTools.cacheDirectory,"/root/.cache/solana/v1.56/platform-tools"); assert.match(run(lock.platformTools.cacheDirectory+"/rust/bin/rustc"),/^rustc 1\.89\.0(?:-dev)? /); assert.match(run(lock.platformTools.cacheDirectory+"/llvm/bin/clang"),/clang version 20\./); console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch}));'

CMD ["/bin/bash"]
