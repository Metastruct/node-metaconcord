FROM node:22-alpine

RUN apk add --no-cache bash font-noto ffmpeg

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
RUN yarn install && yarn cache clean

COPY . .

WORKDIR /app/config
RUN for f in *.example.json; do \
  cp "$f" "${f/.example.json/.json}"; \
  done

# hack, remove config after building so we can mount it
# todo: handle empty config in the app
WORKDIR /app
RUN yarn build && rm -rf ./config

EXPOSE 20122

CMD [ "yarn", "start" ]
