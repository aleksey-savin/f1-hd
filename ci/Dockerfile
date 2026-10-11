# Local runner for ci/run.sh: the same Node as the product images, plus git
# (the brand guard and the repo checks read `git ls-files`).
FROM node:24-alpine
RUN apk add --no-cache bash git tar && corepack enable \
 && git config --system --add safe.directory '*'
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["bash", "/entrypoint.sh"]
