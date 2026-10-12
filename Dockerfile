FROM node:26-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN cd /app/config && \
  for f in *.example.json; do \
    cp "$f" "${f%.example.json}.json"; \
  done

RUN node --run test:fluxer && node --run build && node --run test:fluxer:dist

########################## Stage ##########################

FROM node:26-alpine AS runner
WORKDIR /app
RUN apk add --no-cache font-noto ffmpeg python3 make bash

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/resources ./resources

EXPOSE 20122

CMD [ "node", "--run", "start" ]
