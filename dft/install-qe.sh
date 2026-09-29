#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
source_cache="$1"
build_dir=/opt/virtualfab/qe-source
install_dir=/opt/virtualfab/qe
mkdir -p "$build_dir" "$install_dir/bin"
tar --exclude='./.git' -C "$source_cache" -cf - . | tar -C "$build_dir" -xf -
# Public source caches may have been checked out with Windows CRLF settings.
find "$build_dir" -type f \( -name configure -o -name '*.sh' -o -name config.guess -o -name config.sub -o -name install-sh \) -exec sed -i 's/\r$//' {} +
cd "$build_dir"
./configure --prefix="$install_dir" --disable-parallel --enable-openmp --with-scalapack=no --with-fox > /opt/virtualfab/qe-configure.log 2>&1
if [ -f external/fox/arch.make ]; then make -C external/fox clean > /opt/virtualfab/fox-clean.log 2>&1; fi
make -j4 pw > /opt/virtualfab/qe-build.log 2>&1
cp PW/src/pw.x "$install_dir/bin/pw.x"
cp License "$install_dir/License"
printf '%s\n' 'QE 7.5, commit 770a0b2d12928a67048e2f3da8d10d057e52179e; MPI disabled; OpenMP enabled; Ubuntu BLAS/LAPACK/FFTW.' > "$install_dir/build-info.txt"
echo 'Quantum ESPRESSO 7.5 built successfully.'
