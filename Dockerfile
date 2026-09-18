FROM node:22-alpine

RUN apk add --no-cache bash font-noto ffmpeg python3 make g++

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

# hack, remove build config so production config can be mounted at /app/dist/config
# todo: handle empty config in the app
WORKDIR /app
RUN yarn test:fluxer && yarn build && rm -rf ./config

EXPOSE 20122

CMD [ "yarn", "start" ]
