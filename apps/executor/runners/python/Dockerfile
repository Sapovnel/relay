# Custom Python runner image. Pre-installs pure-Python and small native libs
# the sandbox can `import` without needing per-run network access.
#
# We use python:3.12-slim (debian-based) instead of alpine because numpy/sympy
# wheels are widely available for glibc but not musl, so alpine pip would have
# to compile from source.
FROM python:3.12-slim
RUN pip install --no-cache-dir \
    numpy \
    sympy \
    regex \
    more-itertools \
    pyyaml \
  && rm -rf /root/.cache /tmp/*
