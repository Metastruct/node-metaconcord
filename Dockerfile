FROM zenika/alpine-chrome:with-puppeteer

USER root
RUN set -eux \
  & apk add \
  --no-cache \
  bash 

WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
RUN yarn install
COPY . .
RUN cd ./config && \
  for f in *.example.json; do \
  cp "$f" "${f/.example.json/.json}"; \
  done
  
RUN yarn build

#hack, remove config after building so we can mount it
#todo: handle empty config in the app
RUN rm -rf ./config

EXPOSE 20122

CMD [ "yarn", "start" ]
