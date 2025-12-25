FROM zenika/alpine-chrome:with-puppeteer

USER root
RUN set -eux \
  & apk add \
  --no-cache \
  bash 

WORKDIR /app

RUN yarn set version berry
COPY package.json yarn.lock .yarn .yarnrc.yml ./
RUN yarn install
COPY . .
RUN cd ./config && \
  for f in *.example.json; do \
  cp "$f" "${f/.example.json/.json}"; \
  done
  
#todo: remove/replace schema_gen.sh it is so slow..
RUN ./schema_gen.sh
RUN yarn build

#hack, remove config after building so we can mount it
#todo: handle empty config in the app
RUN rm -rf ./config

EXPOSE 20122

CMD [ "yarn", "start" ]
