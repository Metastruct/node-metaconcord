FROM node:26-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make

COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY . .

RUN cd /app/config && \
  for f in *.example.json; do \
    mv "$f" "${f%.example.json}.json"; \
  done

RUN mkdir -p /pack /out \
    && npm pack --pack-destination /pack \
    && tar -xzf /pack/*.tgz -C /out --strip-components=1 \
    && rm -rf /pack

########################## Stage ##########################

FROM node:26-alpine AS runner
WORKDIR /app
EXPOSE 20122
RUN apk add --no-cache font-noto ffmpeg python3 make bash

ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV

COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY --from=builder /out/ /app/
COPY --from=builder /app/config /app/config

RUN chown -R node:node ./
USER node

CMD [ "node", "--run", "start" ]
