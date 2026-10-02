#!/usr/bin/env bash
# Run in MSYS2 UCRT64 with GCC, make, nasm, pkgconf and autotools installed.
# The source archives and checksums are supplied in the release source companion.
set -euo pipefail
build_root="${FRAMEPICK_CODEC_BUILD:-/c/Framepick-codecs-build}"
cd "$build_root"
mkdir -p sources prefix
tar -xf archives/zimg-3.0.6.tar.gz -C sources
tar -xf archives/ffmpeg-9.0.2.tar.xz -C sources
tar -xf archives/x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.bz2 -C sources
tar -xf archives/x265_4.3.tar.gz -C sources
export PATH=/ucrt64/bin:/usr/bin:"$PATH"
export PKG_CONFIG_PATH="$(cygpath -m "$build_root/prefix/lib/pkgconfig")"
map_flag="-ffile-prefix-map=$build_root=. -fdebug-prefix-map=$build_root=."
cd "$build_root/sources/zimg-release-3.0.6"
./autogen.sh
CFLAGS="$map_flag" CXXFLAGS="$map_flag" ./configure --prefix="$build_root/prefix" --enable-static --disable-shared
make -j2
make install
cd "$build_root/sources/x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55"
CFLAGS="$map_flag" ./configure --prefix="$build_root/prefix" --enable-static --disable-cli --disable-opencl
make -j2
make install
cd "$build_root/sources/x265_4.3"
cmake -S source -B framepick-build -G Ninja -DCMAKE_INSTALL_PREFIX="$(cygpath -m "$build_root/prefix")" \
  -DENABLE_SHARED=OFF -DENABLE_CLI=OFF -DHIGH_BIT_DEPTH=ON -DENABLE_HDR10_PLUS=OFF \
  -DCMAKE_C_FLAGS="$map_flag" -DCMAKE_CXX_FLAGS="$map_flag"
cmake --build framepick-build -j2
cmake --install framepick-build
# CMake's implicit MinGW libraries include shared libgcc. Keep the runtime static.
sed -i 's/-lgcc_s//g' "$build_root/prefix/lib/pkgconfig/x265.pc"
cd "$build_root/sources/ffmpeg-9.0.2"
./configure --prefix="$build_root/prefix" --disable-autodetect --disable-shared --enable-static \
  --enable-gpl --enable-version3 --enable-libx264 --enable-libx265 --enable-libzimg --enable-schannel --disable-doc --disable-debug --disable-ffplay \
  --pkg-config-flags="--static" --extra-libs="-lstdc++" \
  --extra-cflags="$map_flag -I$build_root/prefix/include" \
  --extra-cxxflags="$map_flag -I$build_root/prefix/include" \
  --extra-ldflags="-L$build_root/prefix/lib -static -static-libgcc -static-libstdc++"
make -j2 ffmpeg.exe ffprobe.exe
mkdir -p "$build_root/result"
cp ffmpeg.exe ffprobe.exe "$build_root/result/"
cp config.h ffbuild/config.mak "$build_root/result/"
ffmpeg_version=$(./ffmpeg.exe -version)
printf '%s\n' "$ffmpeg_version" > "$build_root/result/ffmpeg-BUILD.txt"
