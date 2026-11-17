FROM node:26-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make

COPY package.json package-lock.json ./
RUN npm ci

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
RUN apk add --no-cache font-noto ffmpeg python3 make bash

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /out/ /app/
COPY --from=builder /app/config /app/config

EXPOSE 20122

CMD [ "node", "--run", "start" ]