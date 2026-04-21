# Custom JS runner image. Pre-installs a small curated set of pure-JS packages
# so user code can `require()` / `import` them inside the no-network sandbox.
#
# NODE_PATH points node's module resolver at the pre-installed modules; that
# means `require('lodash')` works from any working directory without any
# package.json at runtime.
FROM node:20-alpine
WORKDIR /preinstalled
COPY package.json .
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
ENV NODE_PATH=/preinstalled/node_modules
